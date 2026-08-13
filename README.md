# Urban Traffic Monitor

MVP do cenário de IoT para monitoramento de tráfego urbano. A API recebe telemetria em JSON, conversa com o analisador usando **gRPC/Protocol Buffers** e distribui acidentes para todas as centrais ativas com **RabbitMQ Fanout + WebSocket**.

## Arquitetura

```text
Sensor -> HTTP/JSON -> Ingestion API -> gRPC/Protobuf -> Traffic Analyzer
                                                           |
                                                   RabbitMQ fanout
                                                    /             \
                                             Dashboard 1      Dashboard 2
                                                 |                |
                                             WebSocket        WebSocket
```

- gRPC reduz o custo de serialização e banda na comunicação interna.
- A exchange `fanout` cria uma cópia do alerta para a fila exclusiva de cada instância ativa.
- Cada instância envia o evento aos navegadores que estão conectados a ela.
- O protótipo considera acidente quando a velocidade é menor ou igual a 2 km/h e a ocupação é pelo menos 75%.

## Executar

Requer Docker com Compose:

```bash
docker compose up --build
```

Abra dois painéis, servidos por instâncias diferentes:

- http://localhost:8081 (`central-norte`)
- http://localhost:8082 (`central-sul`)
- RabbitMQ Management: http://localhost:15672 (`guest` / `guest`)

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

## Desenvolvimento local

```bash
npm install
npm run build
npm test
```

Os serviços também podem ser iniciados separadamente pelos scripts `start:analyzer`, `start:ingestion` e `start:dashboard`. RabbitMQ precisa estar acessível pela URL configurada em `RABBITMQ_URL`.

## Endpoints

- `POST /api/v1/readings`: recebe telemetria e devolve a análise.
- `GET /health`: saúde da API ou do dashboard.
- `GET /instance`: identifica a instância do dashboard.
- `WS /alerts`: conexão de alertas em tempo real.

## Relação com os exercícios de aula

Esta implementação integra os conceitos das branches `docker`, `grpc-example`, `exemplo-websocket` e `exercicio-rabbitmq` do repositório de aulas, mantendo Node.js/TypeScript e separando entrada HTTP, integração gRPC e mensageria.

## Limitações e evolução

As filas dos dashboards são exclusivas e representam apenas instâncias ativas, como pede o cenário. Para centrais que precisem recuperar alertas ocorridos enquanto estavam desligadas, use filas duráveis nomeadas por central e persistência/idempotência em banco. Outras evoluções naturais são autenticação dos sensores, TLS, deduplicação por janela temporal, métricas Prometheus e streaming bidirecional em gRPC.
