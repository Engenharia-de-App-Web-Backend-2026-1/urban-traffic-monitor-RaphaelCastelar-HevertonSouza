import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectRabbitMQ } from "../shared/rabbitmq.js";
import { DashboardController } from "./interfaces/dashboardController.js";

const port = Number(process.env.DASHBOARD_PORT ?? 8080);
const instanceId = process.env.INSTANCE_ID ?? `dashboard-${process.pid}`;
const rabbitUrl = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";
const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);

const { channel } = await connectRabbitMQ(rabbitUrl);
const controller = new DashboardController(channel, instanceId, publicDir);
const app = controller.createHttpApp();
const httpServer = app.listen(port, () =>
  console.log(`${instanceId} ouvindo na porta ${port}`),
);
controller.attachWebSocketServer(httpServer);