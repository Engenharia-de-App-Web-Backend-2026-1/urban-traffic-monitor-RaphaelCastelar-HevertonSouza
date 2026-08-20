import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeTraffic } from "./usecases/analyzeTraffic.js";
import type { TrafficReading } from "../shared/contracts.js";

const baseReading: TrafficReading = {
  readingId: "reading-1",
  sensorId: "radar-101",
  latitude: -23.55,
  longitude: -46.63,
  averageSpeedKmh: 50,
  vehicleCount: 20,
  occupancyPercent: 30,
  capturedAt: new Date().toISOString(),
};

describe("analyzeTraffic", () => {
  it("classifica fluxo normal", () => {
    assert.equal(analyzeTraffic(baseReading).status, "NORMAL");
  });

  it("classifica congestionamento", () => {
    const result = analyzeTraffic({
      ...baseReading,
      averageSpeedKmh: 15,
      occupancyPercent: 70,
    });
    assert.equal(result.status, "CONGESTED");
    assert.equal(result.accidentDetected, false);
  });

  it("detecta acidente e gera eventId", () => {
    const result = analyzeTraffic({
      ...baseReading,
      averageSpeedKmh: 0,
      occupancyPercent: 95,
    });
    assert.equal(result.status, "ACCIDENT");
    assert.equal(result.severity, "CRITICAL");
    assert.ok(result.eventId);
  });
});
