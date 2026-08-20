import { grpc, trafficPackage } from "../shared/grpc.js";
import { createIngestionController } from "./interfaces/ingestionController.js";

const port = Number(process.env.INGESTION_PORT ?? 3000);
const grpcAddress = process.env.GRPC_ADDRESS ?? "localhost:50051";
const analyzerClient = new trafficPackage.TrafficAnalyzer(
  grpcAddress,
  grpc.credentials.createInsecure(),
);

const app = createIngestionController(analyzerClient);
app.listen(port, () => console.log(`API de ingestão ouvindo na porta ${port}`));