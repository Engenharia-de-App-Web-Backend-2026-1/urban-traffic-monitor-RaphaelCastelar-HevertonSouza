import type { Pool } from "pg";
import type {
  AccidentEvent,
  AnalysisResult,
  TrafficReading,
} from "../../shared/contracts.js";
import type { TrafficAnalysisRepository } from "../ports/trafficAnalysisRepository.js";

export class PostgresTrafficAnalysisRepository
  implements TrafficAnalysisRepository
{
  constructor(private readonly pool: Pool) {}

  async saveOrGet(
    reading: TrafficReading,
    result: AnalysisResult,
    event?: AccidentEvent,
  ): Promise<AnalysisResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO traffic_readings (
          reading_id, sensor_id, latitude, longitude, average_speed_kmh,
          vehicle_count, occupancy_percent, captured_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (reading_id) DO NOTHING
        RETURNING reading_id`,
        [
          reading.readingId,
          reading.sensorId,
          reading.latitude,
          reading.longitude,
          reading.averageSpeedKmh,
          reading.vehicleCount,
          reading.occupancyPercent,
          reading.capturedAt,
        ],
      );

      if (inserted.rowCount === 0) {
        const existing = await client.query<AnalysisRow>(
          `SELECT reading_id, status, accident_detected, event_id, severity, message
             FROM traffic_analyses
            WHERE reading_id = $1`,
          [reading.readingId],
        );
        if (existing.rowCount !== 1) {
          throw new Error(`Analise ausente para a leitura ${reading.readingId}`);
        }
        await client.query("COMMIT");
        return toAnalysisResult(existing.rows[0]);
      }

      await client.query(
        `INSERT INTO traffic_analyses (
          reading_id, status, accident_detected, event_id, severity, message
        ) VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6)`,
        [
          result.readingId,
          result.status,
          result.accidentDetected,
          result.eventId,
          result.severity,
          result.message,
        ],
      );

      if (event) {
        await client.query(
          `INSERT INTO outbox_events (
            id, aggregate_type, aggregate_id, event_type, payload
          ) VALUES ($1, 'TRAFFIC_READING', $2, $3, $4::jsonb)`,
          [event.eventId, reading.readingId, event.type, JSON.stringify(event)],
        );
      }

      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface AnalysisRow {
  reading_id: string;
  status: AnalysisResult["status"];
  accident_detected: boolean;
  event_id: string | null;
  severity: AnalysisResult["severity"];
  message: string;
}

function toAnalysisResult(row: AnalysisRow): AnalysisResult {
  return {
    readingId: row.reading_id,
    status: row.status,
    accidentDetected: row.accident_detected,
    eventId: row.event_id ?? "",
    severity: row.severity,
    message: row.message,
  };
}
