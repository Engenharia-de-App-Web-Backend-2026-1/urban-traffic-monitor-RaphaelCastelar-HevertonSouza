import type {
  AccidentEvent,
  AnalysisResult,
  TrafficReading,
} from "../../shared/contracts.js";

export interface TrafficAnalysisRepository {
  saveOrGet(
    reading: TrafficReading,
    result: AnalysisResult,
    event?: AccidentEvent,
  ): Promise<AnalysisResult>;
}
