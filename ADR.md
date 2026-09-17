# Registro de Decisões Arquiteturais (ADR)

Este documento registra as principais escolhas arquiteturais e tecnológicas tomadas para a resolução do cenário "Ecossistema de IoT para Monitoramento de Tráfego Urbano".

## Cenário Escolhido

**Cenário 4 — Ecossistema de IoT para Monitoramento de Tráfego Urbano**

Breve descrição dos gargalos e desafios:
O sistema precisa processar telemetria de milhares de sensores (semáforos, radares) com baixa latência e encaminhar rapidamente leituras para um microsserviço de análise. Além disso, quando um acidente é detectado, o alerta deve ser propagado imediatamente para todas as instâncias de dashboard ativas.

---

## ADR 01: Padrão de Comunicação Cliente-Servidor (Entrega em Tempo Real aos Painéis)

- **Status:** Aceito
- **Data:** 20/08/2026

### Contexto

Os painéis (dashboards) precisam receber alertas em tempo real, com latência mínima e sem que a API central acabe mantendo estado ou conexões diretas com todas as instâncias.

### Alternativas Consideradas

- Polling HTTP tradicional
- Server-Sent Events (SSE)
- WebSockets

### Decisão

Optamos por **WebSocket** para a entrega em tempo real aos painéis.

### Justificativa (Trade-offs)

- WebSocket oferece baixa latência e é amplamente suportado no navegador, permitindo push de mensagens para painéis conectados.
- SSE foi considerado, mas SSE é unidirecional e oferece menos flexibilidade para futuros requisitos (ex.: mensagens binárias, controle fino do canal).
- Polling foi descartado por overhead e latência.

### Consequências

- **Positivas:** Experiência reativa nos painéis; uso eficiente de banda para alertas pontuais.
- **Negativas / Pontos de Atenção:** Necessidade de gerenciar conexões abertas por instância e escalabilidade por instância (uso de um broker para propagar eventos entre instâncias).

---

## ADR 02: Comunicação interna síncrona (API → Analyzer)

- **Status:** Aceito
- **Data:** 20/08/2026

### Contexto

A API de ingestão precisa enviar uma leitura ao microsserviço de análise, aguardar sua classificação e devolver o resultado ao sensor com baixa latência. Essa interação é requisição/resposta, possui contrato estável e ocorre apenas entre serviços internos.

### Alternativas Consideradas

- Comunicação síncrona HTTP/REST interna
- gRPC
- RabbitMQ (AMQP)

### Decisão

Usar **gRPC unary com Protocol Buffers** entre a API de ingestão e o `Traffic Analyzer`.

### Justificativa (Trade-offs)

- Protobuf fornece um contrato explícito e uma representação binária compacta; gRPC oferece deadline e status padronizados.
- HTTP/REST seria mais simples para inspeção manual, mas repetiria serialização JSON e não aproveitaria o contrato `.proto` da comunicação interna.
- RabbitMQ não foi escolhido para essa interação porque a API precisa da resposta da análise na mesma requisição. O broker é usado somente no fluxo assíncrono de alertas.

### Consequências

- **Positivas:** Contrato fortemente definido, payload compacto e deadline de três segundos na chamada.
- **Negativas / Pontos de Atenção:** A API fica temporalmente acoplada ao Analyzer; se ele estiver indisponível, a API responde `503`. Clientes externos não precisam conhecer gRPC, pois continuam usando HTTP/JSON.

---

## ADR 03: Mensageria e broadcast de alertas (Analyzer → Dashboards)

- **Status:** Aceito
- **Data:** 20/08/2026

### Contexto

Quando um acidente é detectado, todas as instâncias de dashboard que estiverem ativas devem receber uma cópia do alerta. Uma fila única com consumidores concorrentes entregaria cada mensagem a apenas uma instância e, portanto, não atenderia ao broadcast.

### Alternativas Consideradas

- Chamadas HTTP do Analyzer para cada dashboard
- Redis Pub/Sub
- RabbitMQ com uma fila compartilhada
- RabbitMQ com exchange `fanout` e uma fila por instância

### Decisão

Usar **RabbitMQ/AMQP 0-9-1**, com exchange `fanout` durável e uma fila exclusiva, temporária e vinculada à exchange para cada instância ativa do dashboard.

### Justificativa (Trade-offs)

- A exchange `fanout` copia cada alerta para todas as filas vinculadas sem exigir que o produtor conheça as instâncias.
- Uma única fila distribuiria as mensagens entre consumidores, em vez de replicá-las.
- Chamadas HTTP exigiriam descoberta das instâncias e tornariam o Analyzer responsável por falhas individuais.
- Redis Pub/Sub também faria broadcast, mas não oferece acknowledgements e filas com as mesmas garantias do RabbitMQ.

### Consequências

- **Positivas:** Desacoplamento do produtor, escala horizontal dos dashboards e confirmação explícita do consumo por fila.
- **Negativas / Pontos de Atenção:** Exige operar o broker. Como as filas são exclusivas e temporárias, uma central offline não recupera alertas antigos; isso é intencional para o requisito de instâncias ativas.

---

## ADR 04: Adaptação à Clean Architecture

- **Status:** Aceito
- **Data:** 20/08/2026

### Contexto

A introdução de protocolos não-HTTP (gRPC, WebSockets, AMQP) pode poluir as regras de negócio se não forem bem isolados.

### Decisão de Design

1. **Adaptadores de entrada em `interfaces`:** HTTP, gRPC, AMQP e WebSocket ficam nas bordas dos respectivos serviços e traduzem protocolos para os dados da aplicação.
2. **Casos de uso isolados:** `ProcessTrafficReading` orquestra a análise e a persistência, enquanto `analyzeTraffic` contém a regra pura. Nenhum deles importa Express, gRPC, RabbitMQ ou PostgreSQL.
3. **Inversão de dependência:** o caso de uso depende da interface `TrafficAnalysisRepository`, definida em `ports`. A implementação `PostgresTrafficAnalysisRepository` fica em `infrastructure` e é injetada pelo `server.ts`.
4. **Composition roots:** cada `server.ts` instancia os adaptadores e conecta as dependências. Código de conexão e contratos entre serviços ficam em `src/shared`.

### Consequências

- Facilita testes unitários da lógica de negócio.
- Permite trocar implementações de infraestrutura sem tocar nos Use Cases.

---

## ADR 05: Persistência e publicação com Transactional Outbox

- **Status:** Aceito
- **Data:** 15/09/2026

### Contexto

Ao persistir uma análise e publicar um alerta diretamente no RabbitMQ, duas escritas independentes passam a compor a mesma operação de negócio. Uma falha entre elas pode deixar uma análise sem alerta ou publicar um alerta cuja análise não foi gravada. PostgreSQL e RabbitMQ não compartilham uma transação ACID.

### Alternativas consideradas

- Gravar no PostgreSQL e publicar diretamente no RabbitMQ (dual write)
- Transação distribuída/two-phase commit (2PC)
- Transactional Outbox com relay por polling

### Decisão

Usar **Transactional Outbox** no Traffic Analyzer. A leitura, a análise e o evento são inseridos na mesma transação PostgreSQL. Um relay assíncrono reivindica eventos com `FOR UPDATE SKIP LOCKED`, publica usando publisher confirms e, após a confirmação, marca-os como publicados.

O `readingId` é usado como chave de idempotência da entrada, e o `eventId` como chave de deduplicação no consumidor.

### Consequências

- **Positivas:** não há janela capaz de confirmar a análise sem registrar a intenção de publicar; eventos pendentes sobrevivem à indisponibilidade do RabbitMQ; múltiplos relays podem trabalhar sem publicar o mesmo registro simultaneamente.
- **Negativas:** consistência entre banco e broker é eventual; existe pequena latência do polling; uma queda após a confirmação do broker e antes do update da outbox pode gerar duplicata.
- **Garantia:** entrega pelo menos uma vez. Consumidores precisam ser idempotentes.
