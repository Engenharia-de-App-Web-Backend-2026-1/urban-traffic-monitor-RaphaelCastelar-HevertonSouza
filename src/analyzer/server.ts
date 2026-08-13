import type { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { analyzeTraffic } from './analyzeTraffic.js';
import type { AccidentEvent, AnalysisResult, TrafficReading } from '../shared/contracts.js';
import { grpc, trafficPackage } from '../shared/grpc.js';
import { ALERT_EXCHANGE, connectRabbitMQ } from '../shared/rabbitmq.js';

const grpcPort = process.env.GRPC_PORT ?? '50051';
const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
const { channel } = await connectRabbitMQ(rabbitUrl);

function handleAnalysis(
  call: ServerUnaryCall<TrafficReading, AnalysisResult>,
  callback: sendUnaryData<AnalysisResult>
): void {
  try {
    const reading = call.request;
    const result = analyzeTraffic(reading);

    if (result.accidentDetected) {
      const event: AccidentEvent = {
        ...result,
        type: 'ACCIDENT_DETECTED',
        sensorId: reading.sensorId,
        latitude: reading.latitude,
        longitude: reading.longitude,
        detectedAt: new Date().toISOString()
      };
      channel.publish(ALERT_EXCHANGE, '', Buffer.from(JSON.stringify(event)), {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
        timestamp: Date.now()
      });
      console.log(`Alerta ${event.eventId} publicado para ${event.sensorId}`);
    }

    callback(null, result);
  } catch (error) {
    callback({ code: grpc.status.INTERNAL, message: (error as Error).message });
  }
}

const server = new grpc.Server();
server.addService(trafficPackage.TrafficAnalyzer.service, { analyzeTraffic: handleAnalysis });
server.bindAsync(`0.0.0.0:${grpcPort}`, grpc.ServerCredentials.createInsecure(), (error, port) => {
  if (error) throw error;
  console.log(`Traffic Analyzer gRPC ouvindo na porta ${port}`);
});
