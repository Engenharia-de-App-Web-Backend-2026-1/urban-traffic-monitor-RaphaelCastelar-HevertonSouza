import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { ALERT_EXCHANGE, connectRabbitMQ } from "../services/rabbitmq.js";

const port = Number(process.env.DASHBOARD_PORT ?? 8080);
const instanceId = process.env.INSTANCE_ID ?? `dashboard-${process.pid}`;
const rabbitUrl =
  process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";
const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);

const app = express();
app.use(express.static(publicDir));
app.get("/health", (_request, response) =>
  response.json({ status: "UP", service: "dashboard", instanceId }),
);
app.get("/instance", (_request, response) => response.json({ instanceId }));

const httpServer = app.listen(port, () =>
  console.log(`${instanceId} ouvindo na porta ${port}`),
);
const webSocketServer = new WebSocketServer({
  server: httpServer,
  path: "/alerts",
});

webSocketServer.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "CONNECTED",
      instanceId,
      connectedAt: new Date().toISOString(),
    }),
  );
});

const { channel } = await connectRabbitMQ(rabbitUrl);
const queue = await channel.assertQueue("", {
  exclusive: true,
  autoDelete: true,
});
await channel.bindQueue(queue.queue, ALERT_EXCHANGE, "");
await channel.consume(queue.queue, (message) => {
  if (!message) return;
  const event = JSON.parse(message.content.toString());
  const payload = JSON.stringify({ ...event, deliveredBy: instanceId });
  let delivered = 0;
  for (const client of webSocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      delivered += 1;
    }
  }
  console.log(
    `${event.eventId} entregue a ${delivered} painel(is) por ${instanceId}`,
  );
  channel.ack(message);
});
