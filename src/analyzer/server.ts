import { grpc } from "../shared/grpc.js";
import { connectRabbitMQ } from "../shared/rabbitmq.js";
import { AnalyzerController } from "./interfaces/analyzerController.js";
import { AlertPublisher } from "./services/alertPublisher.js";

const grpcPort = process.env.GRPC_PORT ?? "50051";
const rabbitUrl = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";
const { channel } = await connectRabbitMQ(rabbitUrl);
const controller = new AnalyzerController(new AlertPublisher(channel));
const server = new grpc.Server();

controller.register(server);
server.bindAsync(
  `0.0.0.0:${grpcPort}`,
  grpc.ServerCredentials.createInsecure(),
  (error, port) => {
    if (error) throw error;
    console.log(`Traffic Analyzer gRPC ouvindo na porta ${port}`);
  },
);