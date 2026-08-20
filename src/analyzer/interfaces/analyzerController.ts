import type { sendUnaryData, Server, ServerUnaryCall } from "@grpc/grpc-js";
import type { AnalysisResult, TrafficReading } from "../../shared/contracts.js";
import { grpc, trafficPackage } from "../../shared/grpc.js";
import { AlertPublisher } from "../services/alertPublisher.js";
import { analyzeTraffic } from "../usecases/analyzeTraffic.js";

export class AnalyzerController {
  constructor(private readonly alertPublisher: AlertPublisher) {}

  analyzeTraffic(
    call: ServerUnaryCall<TrafficReading, AnalysisResult>,
    callback: sendUnaryData<AnalysisResult>,
  ): void {
    try {
      const reading = call.request;
      const result = analyzeTraffic(reading);
      if (result.accidentDetected) {
        this.alertPublisher.publishAccident(reading, result);
      }
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