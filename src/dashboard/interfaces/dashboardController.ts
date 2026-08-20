import type { Channel } from "amqplib";
import express, { type Express } from "express";
import { WebSocket, WebSocketServer } from "ws";
import { ALERT_EXCHANGE } from "../../shared/rabbitmq.js";

export class DashboardController {
  constructor(
    private readonly channel: Channel,
    private readonly instanceId: string,
    private readonly publicDir: string,
  ) {}

  createHttpApp(): Express {
    const app = express();
    app.use(express.static(this.publicDir));
    app.get("/health", (_request, response) =>
      response.json({ status: "UP", service: "dashboard", instanceId: this.instanceId }),
    );
    app.get("/instance", (_request, response) => response.json({ instanceId: this.instanceId }));
    return app;
  }

  attachWebSocketServer(httpServer: ReturnType<Express["listen"]>): void {
    const webSocketServer = new WebSocketServer({ server: httpServer, path: "/alerts" });
    webSocketServer.on("connection", (socket) => {
      socket.send(JSON.stringify({
        type: "CONNECTED",
        instanceId: this.instanceId,
        connectedAt: new Date().toISOString(),
      }));
    });
    void this.consumeAlerts(webSocketServer);
  }

  private async consumeAlerts(webSocketServer: WebSocketServer): Promise<void> {
    const queue = await this.channel.assertQueue("", { exclusive: true, autoDelete: true });
    await this.channel.bindQueue(queue.queue, ALERT_EXCHANGE, "");
    await this.channel.consume(queue.queue, (message) => {
      if (!message) return;
      const event = JSON.parse(message.content.toString());
      const payload = JSON.stringify({ ...event, deliveredBy: this.instanceId });
      let delivered = 0;
      for (const client of webSocketServer.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
          delivered += 1;
        }
      }
      console.log(`${event.eventId} entregue a ${delivered} painel(is) por ${this.instanceId}`);
      this.channel.ack(message);
    });
  }
}