import { randomUUID } from 'node:crypto';
import express from 'express';
import type { AnalysisResult, TrafficReading } from '../shared/contracts.js';
import { grpc, trafficPackage } from '../shared/grpc.js';

const port = Number(process.env.INGESTION_PORT ?? 3000);
const grpcAddress = process.env.GRPC_ADDRESS ?? 'localhost:50051';
const analyzerClient = new trafficPackage.TrafficAnalyzer(
  grpcAddress,
  grpc.credentials.createInsecure()
);
const app = express();
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_request, response) => response.json({ status: 'UP', service: 'ingestion-api' }));

app.post('/api/v1/readings', (request, response) => {
  const validationError = validateReading(request.body);
  if (validationError) {
    response.status(400).json({ error: validationError });
    return;
  }

  const reading: TrafficReading = {
    readingId: request.body.readingId ?? randomUUID(),
    sensorId: request.body.sensorId,
    latitude: Number(request.body.latitude),
    longitude: Number(request.body.longitude),
    averageSpeedKmh: Number(request.body.averageSpeedKmh),
    vehicleCount: Number(request.body.vehicleCount),
    occupancyPercent: Number(request.body.occupancyPercent),
    capturedAt: request.body.capturedAt ?? new Date().toISOString()
  };

  analyzerClient.analyzeTraffic(
    reading,
    { deadline: Date.now() + 3000 },
    (error: Error | null, result: AnalysisResult) => {
      if (error) {
        console.error('Falha ao chamar o analisador', error);
        response.status(503).json({ error: 'Serviço de análise indisponível' });
        return;
      }
      response.status(202).json({ reading, analysis: result });
    }
  );
});

function validateReading(body: Record<string, unknown>): string | null {
  if (!body || typeof body !== 'object') return 'Corpo JSON obrigatório';
  if (typeof body.sensorId !== 'string' || body.sensorId.trim() === '') return 'sensorId é obrigatório';
  const numericFields = ['latitude', 'longitude', 'averageSpeedKmh', 'vehicleCount', 'occupancyPercent'];
  for (const field of numericFields) {
    if (body[field] === undefined || !Number.isFinite(Number(body[field]))) return `${field} deve ser numérico`;
  }
  const occupancy = Number(body.occupancyPercent);
  if (occupancy < 0 || occupancy > 100) return 'occupancyPercent deve estar entre 0 e 100';
  return null;
}

app.listen(port, () => console.log(`API de ingestão ouvindo na porta ${port}`));
