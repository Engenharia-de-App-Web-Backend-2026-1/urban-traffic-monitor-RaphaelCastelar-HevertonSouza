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

## ADR 02: Padrão de Comunicação Interna e Processamento (API ↔ Analyzer / Broadcast)

- **Status:** Aceito
- **Data:** 20/08/2026

### Contexto

Requisitos: (1) RPC rápido e eficiente entre API de ingestão e microsserviço de análise; (2) quando um acidente for detectado, propagar esse evento para todas as instâncias do dashboard.

### Alternativas Consideradas

- Comunicação síncrona HTTP/REST interna
- Redis Pub/Sub
- RabbitMQ (AMQP)
- gRPC

### Decisão

- Usar **gRPC** para a chamada RPC entre a API de ingestão e o `Traffic Analyzer`.
- Usar **RabbitMQ (exchange fanout)** para broadcast de eventos de acidente entre instâncias.

### Justificativa (Trade-offs)

- gRPC: serialização Protobuf (binária) reduz CPU e banda; suportes a deadlines/timeouts e contratos fortemente tipados.
- RabbitMQ fanout: permite que cada instância crie uma fila exclusiva ligada à exchange; garante que cada instância ativa receba o alerta sem conhecimento mútuo.
- Redis Pub/Sub foi descartado por natureza volátil (mensagens perdidas se consumidores estiverem offline). HTTP/REST interno foi descartado por maior overhead.

### Consequências

- **Positivas:** Baixa latência interna; desacoplamento entre recepção e distribuição de alertas; facilidade de escalar instâncias do dashboard.
- **Negativas:** Requer operação de broker (RabbitMQ) em produção; atenção a durabilidade, DLQ e observabilidade.

---

## ADR 03: Adaptação à Clean Architecture

- **Status:** Aceito
- **Data:** 20/08/2026

### Contexto

A introdução de protocolos não-HTTP (gRPC, WebSockets, AMQP) pode poluir as regras de negócio se não forem bem isolados.

### Decisão de Design

1. **Controllers nas interfaces de cada microsserviço:** Os entrypoints HTTP, gRPC, WebSocket e consumidores de filas residem em `src/ingestion/interfaces`, `src/analyzer/interfaces` e `src/dashboard/interfaces`. Eles traduzem protocolos e delegam para Use Cases ou serviços.
2. **Use Cases (regras de negócio) isolados:** A lógica central — por exemplo `analyzeTraffic` — vive numa camada que não conhece bibliotecas de infraestrutura.
3. **Infraestrutura compartilhada em `src/shared`:** Implementações concretas de gRPC/proto e RabbitMQ, além dos contratos compartilhados, ficam em `src/shared`. Serviços específicos de domínio ficam no respectivo diretório `services`.

### Consequências

- Facilita testes unitários da lógica de negócio.
- Permite trocar implementações de infraestrutura sem tocar nos Use Cases.

---

## ADR 04: Persistência e publicação com Transactional Outbox

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
