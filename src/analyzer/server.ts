import { grpc } from "../shared/grpc.js";
import { connectPostgres } from "../shared/postgres.js";
import { connectRabbitMQ } from "../shared/rabbitmq.js";
import { PostgresTrafficAnalysisRepository } from "./infrastructure/postgresTrafficAnalysisRepository.js";
import { AnalyzerController } from "./interfaces/analyzerController.js";
import { OutboxRelay } from "./services/outboxRelay.js";
import { ProcessTrafficReading } from "./usecases/processTrafficReading.js";

const grpcPort = process.env.GRPC_PORT ?? "50051";
const rabbitUrl = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://traffic:traffic@localhost:5432/traffic_monitor";
const pool = await connectPostgres(databaseUrl);
const { channel } = await connectRabbitMQ(rabbitUrl);
const repository = new PostgresTrafficAnalysisRepository(pool);
const processTrafficReading = new ProcessTrafficReading(repository);
const outboxRelay = new OutboxRelay(pool, channel);
const controller = new AnalyzerController(processTrafficReading);
const server = new grpc.Server();

outboxRelay.start();
controller.register(server);
server.bindAsync(
  `0.0.0.0:${grpcPort}`,
  grpc.ServerCredentials.createInsecure(),
  (error, port) => {
    if (error) throw error;
    console.log(`Traffic Analyzer gRPC ouvindo na porta ${port}`);
  },
);

async function shutdown(): Promise<void> {
  outboxRelay.stop();
  server.tryShutdown(async () => {
    await channel.close();
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
