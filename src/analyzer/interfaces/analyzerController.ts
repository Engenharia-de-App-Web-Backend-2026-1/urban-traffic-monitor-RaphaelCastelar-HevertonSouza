import type { sendUnaryData, Server, ServerUnaryCall } from "@grpc/grpc-js";
import type { AnalysisResult, TrafficReading } from "../../shared/contracts.js";
import { grpc, trafficPackage } from "../../shared/grpc.js";
import { ProcessTrafficReading } from "../usecases/processTrafficReading.js";

export class AnalyzerController {
  constructor(private readonly processTrafficReading: ProcessTrafficReading) {}

  async analyzeTraffic(
    call: ServerUnaryCall<TrafficReading, AnalysisResult>,
    callback: sendUnaryData<AnalysisResult>,
  ): Promise<void> {
    try {
      const result = await this.processTrafficReading.execute(call.request);
      callback(null, result);
    } catch (error) {
      callback({ code: grpc.status.INTERNAL, message: (error as Error).message });
    }
  }

  register(server: Server): void {
    server.addService(trafficPackage.TrafficAnalyzer.service, {
      analyzeTraffic: this.analyzeTraffic.bind(this),
    });
  }
}
