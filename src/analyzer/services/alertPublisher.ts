import type { Channel } from "amqplib";
import type {
  AccidentEvent,
  AnalysisResult,
  TrafficReading,
} from "../../shared/contracts.js";
import { ALERT_EXCHANGE } from "../../shared/rabbitmq.js";

export class AlertPublisher {
  constructor(private readonly channel: Channel) {}

  publishAccident(reading: TrafficReading, result: AnalysisResult): void {
    const event: AccidentEvent = {
      ...result,
      type: "ACCIDENT_DETECTED",
      sensorId: reading.sensorId,
      latitude: reading.latitude,
      longitude: reading.longitude,
      detectedAt: new Date().toISOString(),
    };
    this.channel.publish(ALERT_EXCHANGE, "", Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: "application/json",
      messageId: event.eventId,
      timestamp: Date.now(),
    });
    console.log(`Alerta ${event.eventId} publicado para ${event.sensorId}`);
  }
}