# Urban Traffic Monitor

MVP do cenário de IoT para monitoramento de tráfego urbano. A API recebe telemetria em JSON, conversa com o analisador usando **gRPC/Protocol Buffers**, persiste leituras e análises em **PostgreSQL** e distribui acidentes para todas as centrais ativas com **Transactional Outbox + RabbitMQ Fanout + WebSocket**.

## Arquitetura

```text
Sensor -> HTTP/JSON -> Ingestion API -> gRPC/Protobuf -> Traffic Analyzer
                                                           |
                                            transação PostgreSQL única
                                             /                    \
                                      leitura/análise          outbox
                                                                 |
                                                          Outbox Relay
                                                                 |
                                                        RabbitMQ fanout
                                                        /              \
                                                 Dashboard 1       Dashboard 2
                                                     |                 |
                                                 WebSocket         WebSocket
```

- gRPC reduz o custo de serialização e banda na comunicação interna.
- Leitura, análise e evento de acidente são persistidos atomicamente no PostgreSQL.
- O relay publica eventos pendentes com confirmação do RabbitMQ e marca a outbox depois da confirmação.
- A exchange `fanout` cria uma cópia do alerta para a fila exclusiva de cada instância ativa.
- Cada instância envia o evento aos navegadores que estão conectados a ela.
- O protótipo considera acidente quando a velocidade é menor ou igual a 2 km/h e a ocupação é pelo menos 75%.

## Arquitetura do código

- Cada microsserviço possui um `server.ts` de bootstrap e controllers de protocolo em sua própria pasta `interfaces`.
- A lógica de negócio está isolada em `src/analyzer/usecases/analyzeTraffic.ts` como um Use Case.
- A porta `TrafficAnalysisRepository` mantém o caso de uso independente do PostgreSQL; o adaptador concreto fica em `src/analyzer/infrastructure`.
- Contratos e conexões compartilhadas (gRPC, PostgreSQL e RabbitMQ) residem em `src/shared`; o relay da outbox fica em `src/analyzer/services`.

## Persistência sem dual write

O Analyzer não grava no banco e publica no broker sequencialmente. O adaptador de persistência executa uma única transação local:

1. insere a leitura em `traffic_readings`;
2. insere o resultado em `traffic_analyses`;
3. quando há acidente, insere o evento em `outbox_events`;
4. efetiva tudo com um único `COMMIT`.

Depois, o `OutboxRelay` busca eventos pendentes com `FOR UPDATE SKIP LOCKED`, publica no RabbitMQ usando publisher confirms e atualiza o status para `PUBLISHED`. Se o processo cair após publicar e antes de atualizar a outbox, o evento pode ser reenviado. Por isso a entrega é **pelo menos uma vez** e os dashboards deduplicam pelo `eventId`.

O `readingId` também é a chave de idempotência: repetir a mesma requisição retorna a análise já persistida e não cria outro evento.

## Executar

Requer Docker com Compose:

```bash
docker compose up --build
```

Abra dois painéis, servidos por instâncias diferentes:

- http://localhost:8081 (`central-norte`)
- http://localhost:8082 (`central-sul`)
- RabbitMQ Management: http://localhost:15672 (`guest` / `guest`)
- PostgreSQL: `localhost:5432`, database/user/password `traffic_monitor`/`traffic`/`traffic`

Envie uma leitura que representa acidente:

```bash
curl -X POST http://localhost:3000/api/v1/readings \
  -H 'Content-Type: application/json' \
  -d '{
    "sensorId": "radar-104",
    "latitude": -23.5505,
    "longitude": -46.6333,
    "averageSpeedKmh": 0,
    "vehicleCount": 87,
    "occupancyPercent": 95
  }'
```

Os dois painéis devem receber o mesmo `eventId`, cada um indicando a sua própria instância em `deliveredBy`.

Para conferir a persistência:

```bash
docker compose exec postgres psql -U traffic -d traffic_monitor \
  -c "SELECT reading_id, status, event_id FROM traffic_analyses"

docker compose exec postgres psql -U traffic -d traffic_monitor \
  -c "SELECT id, event_type, status, attempts FROM outbox_events"
```

## Desenvolvimento local

```bash
npm install
npm run build
npm test
```

Os serviços também podem ser iniciados separadamente pelos scripts `start:analyzer`, `start:ingestion` e `start:dashboard`. RabbitMQ precisa estar acessível pela URL configurada em `RABBITMQ_URL`.

Consulte também o `ADR.md` para a justificativa arquitetural e trade-offs (gRPC para RPC interna, RabbitMQ fanout para broadcast, WebSocket para painéis de visualização).

Uma descrição detalhada da persistência, prevenção de dual write, idempotência, concorrência e cenários de falha está em `ARQUITETURA_PERSISTENCIA.md`.

## Endpoints

- `POST /api/v1/readings`: recebe telemetria, persiste a leitura/análise e devolve o resultado.
- `GET /health`: saúde da API ou do dashboard.
- `GET /instance`: identifica a instância do dashboard.
- `WS /alerts`: conexão de alertas em tempo real.

## Relação com os exercícios de aula

Esta implementação integra os conceitos das branches `docker`, `grpc-example`, `exemplo-websocket` e `exercicio-rabbitmq` do repositório de aulas, mantendo Node.js/TypeScript e separando entrada HTTP, integração gRPC e mensageria.

## Limitações e evolução

As filas dos dashboards são exclusivas e representam apenas instâncias ativas, como pede o cenário. A deduplicação dos dashboards é mantida em memória porque essas filas também são efêmeras. Para centrais que precisem recuperar alertas ocorridos enquanto estavam desligadas, use filas duráveis nomeadas por central e uma Inbox persistente por consumidor. Outras evoluções naturais são autenticação dos sensores, TLS, métricas Prometheus e streaming bidirecional em gRPC.
