# Arquitetura de Persistência e Consistência de Dados

## 1. Objetivo

Este documento descreve a arquitetura de persistência do **Urban Traffic Monitor** e as práticas adotadas para evitar inconsistências entre PostgreSQL, RabbitMQ e os serviços da aplicação.

O principal problema tratado é o **dual write**: uma mesma operação de negócio precisa alterar dois recursos independentes, como gravar uma análise no banco e publicar um alerta no broker. Como PostgreSQL e RabbitMQ não participam da mesma transação ACID, executar essas duas ações diretamente pode deixar o sistema inconsistente.

Os objetivos da solução são:

- persistir todas as leituras e análises de tráfego;
- não perder a intenção de publicar um alerta de acidente;
- aceitar reprocessamento sem criar novos eventos indevidamente;
- permitir recuperação automática após falhas temporárias;
- manter regras de negócio independentes da tecnologia do banco;
- documentar claramente as garantias e limitações do sistema.

## 2. Problema do dual write

Uma implementação direta poderia executar as seguintes operações:

```text
1. INSERT da análise no PostgreSQL
2. Publicação do alerta no RabbitMQ
```

Essas operações não são atômicas. Alguns cenários possíveis seriam:

| Falha | Consequência |
|---|---|
| Banco confirma, mas RabbitMQ está indisponível | A análise existe, mas o alerta é perdido |
| RabbitMQ confirma, mas o banco falha | Um alerta é exibido sem existir uma análise persistida |
| Processo encerra entre as duas operações | Não é possível determinar com segurança qual operação terminou |
| Cliente repete uma requisição após timeout | A mesma leitura pode gerar análises e alertas duplicados |

Uma transação distribuída com *two-phase commit* poderia coordenar os dois recursos, mas aumentaria o acoplamento, a complexidade operacional e o tempo de bloqueio. Além disso, o RabbitMQ não deve ser tratado como se fizesse parte da transação local do PostgreSQL.

## 3. Solução adotada: Transactional Outbox

Foi adotado o padrão **Transactional Outbox**. A publicação no RabbitMQ é representada inicialmente por um registro na tabela `outbox_events`.

```text
Sensor
  |
  | HTTP/JSON
  v
Ingestion API
  |
  | gRPC/Protobuf
  v
Traffic Analyzer
  |
  | uma única transação PostgreSQL
  +--------------------+--------------------+
  |                    |                    |
  v                    v                    v
traffic_readings  traffic_analyses     outbox_events
                                             |
                                             | polling
                                             v
                                       Outbox Relay
                                             |
                                             | publisher confirm
                                             v
                                      RabbitMQ Fanout
                                        /          \
                                       v            v
                                  Dashboard 1  Dashboard 2
```

Dentro da mesma transação PostgreSQL são executados:

1. `INSERT` da leitura em `traffic_readings`;
2. `INSERT` do resultado em `traffic_analyses`;
3. quando um acidente é detectado, `INSERT` do evento em `outbox_events`;
4. `COMMIT` das três operações.

Se qualquer uma delas falhar, é executado `ROLLBACK`. Portanto, nunca existe uma análise de acidente confirmada no banco sem que a intenção de publicar seu alerta também esteja persistida.

O código dessa fronteira transacional está em `src/analyzer/infrastructure/postgresTrafficAnalysisRepository.ts`.

## 4. Fluxo completo

### 4.1 Recepção e validação

A Ingestion API recebe uma leitura em `POST /api/v1/readings`. Antes de chamar o Analyzer, valida:

- identificadores obrigatórios;
- presença e formato de campos numéricos;
- latitude entre -90 e 90;
- longitude entre -180 e 180;
- ocupação entre 0 e 100%;
- velocidade não negativa;
- quantidade de veículos inteira e não negativa;
- formato da data de captura.

Essa validação antecipa erros para o cliente. As restrições também existem no banco, pois a integridade dos dados não deve depender apenas da camada HTTP.

### 4.2 Análise

O caso de uso `ProcessTrafficReading` executa a regra de classificação e cria um evento quando detecta um acidente. Ele depende da interface `TrafficAnalysisRepository`, e não diretamente do PostgreSQL.

Essa separação segue os princípios de **Clean Architecture** e **Dependency Inversion**:

```text
Controller gRPC
      |
      v
ProcessTrafficReading (caso de uso)
      |
      v
TrafficAnalysisRepository (porta)
      ^
      |
PostgresTrafficAnalysisRepository (adaptador)
```

A regra de negócio pode ser testada sem subir banco ou broker. Também é possível substituir a tecnologia de persistência sem alterar o controller ou a classificação de tráfego.

### 4.3 Persistência atômica

O adaptador PostgreSQL abre uma transação explícita com `BEGIN`. A leitura, a análise e o evento de outbox são tratados como uma única unidade de trabalho.

As propriedades ACID utilizadas são:

- **Atomicidade:** ou todos os registros são confirmados, ou nenhum é;
- **Consistência:** chaves, referências e restrições impedem estados inválidos;
- **Isolamento:** operações concorrentes respeitam as chaves e locks do PostgreSQL;
- **Durabilidade:** depois do `COMMIT`, os registros sobrevivem ao encerramento da aplicação.

### 4.4 Publicação assíncrona

O `OutboxRelay` procura eventos com status `PENDING`, reserva um lote e altera o status para `PROCESSING`. A consulta usa:

```sql
FOR UPDATE SKIP LOCKED
```

Essa estratégia permite executar mais de uma instância do relay. Uma instância ignora registros que já estão sendo processados por outra, reduzindo contenção e evitando que o mesmo registro seja reivindicado simultaneamente.

Depois da reserva, o relay:

1. publica o conteúdo do evento na exchange `traffic.alerts`;
2. aguarda a confirmação do RabbitMQ com `waitForConfirms()`;
3. atualiza o evento para `PUBLISHED`;
4. registra `published_at`.

Se a publicação falhar, o evento volta para `PENDING`, recebe o erro em `last_error` e fica disponível para nova tentativa depois de cinco segundos.

Registros que permanecem em `PROCESSING` por mais de um minuto são considerados abandonados e podem ser reivindicados novamente. Isso trata encerramentos inesperados durante o processamento.

## 5. Idempotência

Idempotência significa que repetir uma operação produz o mesmo resultado observável, sem criar novos efeitos de negócio.

### 5.1 Idempotência da entrada

O campo `readingId` é a chave idempotente da leitura e a chave primária de `traffic_readings`.

Quando uma requisição é repetida com o mesmo `readingId`, o repositório usa:

```sql
ON CONFLICT (reading_id) DO NOTHING
```

Se a leitura já existe, a análise persistida anteriormente é retornada. Não são criados uma nova análise, um novo `eventId` ou um novo registro na outbox.

Para aproveitar essa garantia, sensores ou clientes que repetirem uma requisição após timeout devem reutilizar o mesmo `readingId`.

### 5.2 Idempotência dos eventos

Cada acidente possui um `eventId` único. Esse identificador é usado em três pontos:

- coluna única `traffic_analyses.event_id`;
- chave primária `outbox_events.id`;
- propriedade `messageId` da mensagem RabbitMQ.

Os dashboards mantêm um conjunto limitado de `eventId` já observados e ignoram duplicatas durante a vida da instância.

## 6. Garantia de entrega

A arquitetura oferece entrega **pelo menos uma vez** (*at-least-once*), e não entrega exatamente uma vez.

Existe uma pequena janela em que o RabbitMQ pode confirmar a publicação e o processo encerrar antes de a outbox ser atualizada para `PUBLISHED`. Nesse caso, o evento será enviado novamente quando o relay reiniciar.

Esse comportamento é intencional: em sistemas distribuídos, é mais seguro permitir uma duplicata identificável do que perder definitivamente um alerta. Por isso, consumidores devem usar o `eventId` para serem idempotentes.

## 7. Modelo de dados

### 7.1 `traffic_readings`

Armazena a telemetria recebida do sensor. `reading_id` é a chave primária e impede a duplicação lógica da entrada.

### 7.2 `traffic_analyses`

Armazena a classificação produzida pelo Analyzer. Possui uma relação 1:1 com `traffic_readings` por meio da chave estrangeira `reading_id`.

### 7.3 `outbox_events`

Armazena eventos que precisam ser publicados. Os campos de controle são:

| Campo | Responsabilidade |
|---|---|
| `status` | Indica `PENDING`, `PROCESSING` ou `PUBLISHED` |
| `attempts` | Conta quantas vezes o evento foi reivindicado |
| `available_at` | Controla quando uma nova tentativa pode ocorrer |
| `locked_at` | Permite detectar processamento abandonado |
| `published_at` | Registra a confirmação da publicação |
| `last_error` | Auxilia diagnóstico e observabilidade |
| `payload` | Mantém o evento JSON que será enviado ao broker |

O índice `idx_outbox_pending` acelera a busca periódica por eventos publicáveis.

## 8. Proteções de integridade

O DDL em `database/init.sql` utiliza:

- chaves primárias para identidade e deduplicação;
- chave estrangeira entre análise e leitura;
- `NOT NULL` em atributos obrigatórios;
- `UNIQUE` para o identificador do evento;
- restrições `CHECK` para coordenadas, percentuais, quantidades, status e severidade;
- tipos `TIMESTAMPTZ` para preservar informações temporais com fuso horário;
- `JSONB` para armazenar o evento completo da outbox;
- índice específico para o processamento da outbox.

A combinação de validação na aplicação com constraints no banco aplica **defesa em profundidade**. Mesmo uma futura entrada diferente do endpoint HTTP continuará sujeita às regras estruturais do PostgreSQL.

## 9. Cenários de falha

| Cenário | Comportamento esperado |
|---|---|
| Falha antes do `COMMIT` | PostgreSQL executa rollback; leitura, análise e outbox não são confirmadas |
| RabbitMQ indisponível | O evento permanece na outbox e é reenviado posteriormente |
| Analyzer encerra depois do `COMMIT` | O evento continua persistido e será encontrado após o reinício |
| Relay encerra enquanto publica | O registro `PROCESSING` é recuperado após o tempo de abandono |
| Publicação confirmada, mas update da outbox falha | O evento pode ser duplicado; o consumidor usa `eventId` para deduplicar |
| Cliente repete a leitura com o mesmo `readingId` | A análise anterior é retornada sem criar outro evento |
| Duas instâncias do relay processam simultaneamente | `SKIP LOCKED` distribui os registros sem espera pelo mesmo lote |

## 10. Metodologias e padrões utilizados

- **Clean Architecture:** separa regras de negócio, interfaces e infraestrutura;
- **Dependency Inversion:** o caso de uso depende de uma abstração de repositório;
- **Repository Pattern:** centraliza o acesso e a transação de persistência;
- **Transactional Outbox:** substitui o dual write por uma única transação local;
- **Idempotent Receiver:** usa identificadores estáveis para reconhecer repetições;
- **At-least-once Delivery:** prioriza não perder eventos e aceita duplicatas tratáveis;
- **Retry com atraso:** recupera falhas temporárias sem descartar o evento;
- **Lock com `SKIP LOCKED`:** oferece concorrência segura entre relays;
- **Defesa em profundidade:** combina validação da aplicação e constraints SQL;
- **Observabilidade operacional:** mantém tentativas, datas, status e último erro na outbox;
- **Graceful Shutdown:** interrompe o polling e fecha conexões durante o encerramento normal.

## 11. Decisões que devem ser preservadas

Para não reintroduzir problemas arquiteturais, futuras mudanças devem respeitar estas regras:

1. nenhum caso de uso deve executar `INSERT/UPDATE` e publicar diretamente no RabbitMQ como duas operações independentes;
2. todo evento decorrente de uma alteração persistida deve entrar na outbox na mesma transação;
3. produtores devem manter identificadores estáveis durante retries;
4. consumidores devem considerar que uma mensagem pode chegar mais de uma vez;
5. regras de negócio não devem importar bibliotecas de PostgreSQL, RabbitMQ, Express ou gRPC;
6. novas invariantes também devem ser representadas por constraints no banco quando possível;
7. alterações no esquema devem ser versionadas e revisadas antes da implantação;
8. eventos publicados não devem ser editados, pois representam fatos que já ocorreram;
9. falhas da outbox devem ser monitoradas por `status`, `attempts` e `last_error`;
10. não se deve prometer *exactly-once* sem que todos os efeitos e consumidores realmente ofereçam essa garantia.

## 12. Limitações e evoluções recomendadas

O projeto atual possui algumas limitações conhecidas:

- a deduplicação dos dashboards é mantida em memória;
- as filas de dashboard são exclusivas e efêmeras;
- o DDL é inicializado pelo Docker somente na criação de um volume novo;
- ainda não existe política de descarte ou arquivamento da outbox publicada;
- ainda não existem métricas e alertas operacionais para eventos com muitas tentativas.

Para um ambiente de produção, são recomendadas as seguintes evoluções:

- criar uma **Inbox persistente** por consumidor quando o processamento produzir efeitos duráveis;
- usar filas duráveis nomeadas por central quando dashboards precisarem receber eventos ocorridos enquanto estavam offline;
- introduzir uma ferramenta de migrations, como Flyway, Liquibase ou uma alternativa compatível com Node.js;
- criar política de retenção ou particionamento para leituras antigas e eventos publicados;
- mover eventos com falhas permanentes para uma Dead Letter Queue ou estado `FAILED` após um limite definido;
- monitorar idade do evento pendente, número de tentativas, taxa de publicação e tamanho da outbox;
- configurar credenciais por secrets, TLS e usuário PostgreSQL com privilégio mínimo;
- adicionar testes de integração com PostgreSQL e RabbitMQ reais no pipeline de CI.

## 13. Verificação operacional

Depois de iniciar a aplicação e enviar uma leitura, a persistência pode ser consultada com:

```bash
docker compose exec postgres psql -U traffic -d traffic_monitor \
  -c "SELECT reading_id, sensor_id, captured_at FROM traffic_readings"

docker compose exec postgres psql -U traffic -d traffic_monitor \
  -c "SELECT reading_id, status, severity, event_id FROM traffic_analyses"

docker compose exec postgres psql -U traffic -d traffic_monitor \
  -c "SELECT id, event_type, status, attempts, last_error FROM outbox_events"
```

O comportamento esperado para um acidente é:

1. a leitura aparece em `traffic_readings`;
2. a análise aparece como `ACCIDENT` em `traffic_analyses`;
3. o evento aparece em `outbox_events`;
4. após a confirmação do RabbitMQ, seu status muda para `PUBLISHED`;
5. todos os registros relacionados usam os mesmos `readingId` e `eventId`.

## 14. Referências internas

- DDL: `database/init.sql`
- Caso de uso: `src/analyzer/usecases/processTrafficReading.ts`
- Porta de persistência: `src/analyzer/ports/trafficAnalysisRepository.ts`
- Adaptador PostgreSQL: `src/analyzer/infrastructure/postgresTrafficAnalysisRepository.ts`
- Relay da outbox: `src/analyzer/services/outboxRelay.ts`
- Bootstrap do Analyzer: `src/analyzer/server.ts`
- Deduplicação do dashboard: `src/dashboard/interfaces/dashboardController.ts`
- Decisões arquiteturais: `ADR.md`
