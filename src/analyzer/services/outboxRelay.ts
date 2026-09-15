import type { ConfirmChannel } from "amqplib";
import type { Pool } from "pg";
import { ALERT_EXCHANGE } from "../../shared/rabbitmq.js";

interface OutboxEvent {
  id: string;
  payload: Record<string, unknown>;
}

export class OutboxRelay {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly pool: Pool,
    private readonly channel: ConfirmChannel,
    private readonly intervalMs = 1000,
    private readonly batchSize = 50,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let events: OutboxEvent[] = [];
    try {
      events = await this.claimBatch();
      if (events.length === 0) return;

      for (const event of events) {
        this.channel.publish(
          ALERT_EXCHANGE,
          "",
          Buffer.from(JSON.stringify(event.payload)),
          {
            persistent: true,
            contentType: "application/json",
            messageId: event.id,
            timestamp: Date.now(),
          },
        );
      }
      await this.channel.waitForConfirms();
      await this.markPublished(events.map(({ id }) => id));
      console.log(`${events.length} evento(s) da outbox publicado(s)`);
    } catch (error) {
      console.error("Falha ao publicar lote da outbox", error);
      if (events.length > 0) {
        await this.release(events.map(({ id }) => id), error).catch((releaseError) =>
          console.error("Falha ao liberar eventos da outbox", releaseError),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async claimBatch(): Promise<OutboxEvent[]> {
    const result = await this.pool.query<OutboxEvent>(
      `WITH candidates AS (
         SELECT id
           FROM outbox_events
          WHERE (status = 'PENDING' AND available_at <= NOW())
             OR (status = 'PROCESSING' AND locked_at < NOW() - INTERVAL '1 minute')
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE outbox_events AS event
          SET status = 'PROCESSING', locked_at = NOW(), attempts = attempts + 1
         FROM candidates
        WHERE event.id = candidates.id
      RETURNING event.id, event.payload`,
      [this.batchSize],
    );
    return result.rows;
  }

  private async markPublished(ids: string[]): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events
          SET status = 'PUBLISHED', published_at = NOW(), locked_at = NULL,
              last_error = NULL
        WHERE id = ANY($1::text[])`,
      [ids],
    );
  }

  private async release(ids: string[], error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.pool.query(
      `UPDATE outbox_events
          SET status = 'PENDING', locked_at = NULL,
              available_at = NOW() + INTERVAL '5 seconds', last_error = $2
        WHERE id = ANY($1::text[])`,
      [ids, message.slice(0, 2000)],
    );
  }
}
