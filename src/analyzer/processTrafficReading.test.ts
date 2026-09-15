import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AccidentEvent,
  AnalysisResult,
  TrafficReading,
} from "../shared/contracts.js";
import type { TrafficAnalysisRepository } from "./ports/trafficAnalysisRepository.js";
import { ProcessTrafficReading } from "./usecases/processTrafficReading.js";

const baseReading: TrafficReading = {
  readingId: "reading-process-1",
  sensorId: "radar-101",
  latitude: -23.55,
  longitude: -46.63,
  averageSpeedKmh: 50,
  vehicleCount: 20,
  occupancyPercent: 30,
  capturedAt: "2026-09-15T12:00:00.000Z",
};

class RepositorySpy implements TrafficAnalysisRepository {
  calls: Array<{
    reading: TrafficReading;
    result: AnalysisResult;
    event?: AccidentEvent;
  }> = [];

  async saveOrGet(
    reading: TrafficReading,
    result: AnalysisResult,
    event?: AccidentEvent,
  ): Promise<AnalysisResult> {
    this.calls.push({ reading, result, event });
    return result;
  }
}

describe("ProcessTrafficReading", () => {
  it("persiste leitura normal sem criar evento de outbox", async () => {
    const repository = new RepositorySpy();
    const result = await new ProcessTrafficReading(repository).execute(baseReading);

    assert.equal(result.status, "NORMAL");
    assert.equal(repository.calls.length, 1);
    assert.equal(repository.calls[0].event, undefined);
  });

  it("persiste acidente e seu evento na mesma operação do repositório", async () => {
    const repository = new RepositorySpy();
    const result = await new ProcessTrafficReading(repository).execute({
      ...baseReading,
      averageSpeedKmh: 0,
      occupancyPercent: 95,
    });

    const event = repository.calls[0].event;
    assert.equal(result.status, "ACCIDENT");
    assert.equal(event?.type, "ACCIDENT_DETECTED");
    assert.equal(event?.eventId, result.eventId);
    assert.equal(event?.sensorId, baseReading.sensorId);
  });
});
