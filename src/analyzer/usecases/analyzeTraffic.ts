import { randomUUID } from "node:crypto";
import type { AnalysisResult, TrafficReading } from "../../shared/contracts.js";

export function analyzeTraffic(reading: TrafficReading): AnalysisResult {
  const accident =
    reading.averageSpeedKmh <= 2 && reading.occupancyPercent >= 75;
  const congested =
    reading.averageSpeedKmh < 20 || reading.occupancyPercent >= 65;

  if (accident) {
    return {
      readingId: reading.readingId,
      status: "ACCIDENT",
      accidentDetected: true,
      eventId: randomUUID(),
      severity: reading.occupancyPercent >= 90 ? "CRITICAL" : "HIGH",
      message: `Possível acidente detectado pelo sensor ${reading.sensorId}`,
    };
  }

  if (congested) {
    return {
      readingId: reading.readingId,
      status: "CONGESTED",
      accidentDetected: false,
      eventId: "",
      severity: "MEDIUM",
      message: `Congestionamento detectado pelo sensor ${reading.sensorId}`,
    };
  }

  return {
    readingId: reading.readingId,
    status: "NORMAL",
    accidentDetected: false,
    eventId: "",
    severity: "NONE",
    message: "Fluxo normal",
  };
}