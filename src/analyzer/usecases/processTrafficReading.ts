import type {
  AccidentEvent,
  AnalysisResult,
  TrafficReading,
} from "../../shared/contracts.js";
import type { TrafficAnalysisRepository } from "../ports/trafficAnalysisRepository.js";
import { analyzeTraffic } from "./analyzeTraffic.js";

export class ProcessTrafficReading {
  constructor(private readonly repository: TrafficAnalysisRepository) {}

  async execute(reading: TrafficReading): Promise<AnalysisResult> {
    const result = analyzeTraffic(reading);
    const event = result.accidentDetected
      ? this.createAccidentEvent(reading, result)
      : undefined;

    return this.repository.saveOrGet(reading, result, event);
  }

  private createAccidentEvent(
    reading: TrafficReading,
    result: AnalysisResult,
  ): AccidentEvent {
    return {
      ...result,
      type: "ACCIDENT_DETECTED",
      sensorId: reading.sensorId,
      latitude: reading.latitude,
      longitude: reading.longitude,
      detectedAt: new Date().toISOString(),
    };
  }
}
