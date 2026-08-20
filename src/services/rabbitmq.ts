import amqp, { Channel, ChannelModel } from "amqplib";

export const ALERT_EXCHANGE = "traffic.alerts";

export async function connectRabbitMQ(
  url: string,
): Promise<{ connection: ChannelModel; channel: Channel }> {
  let attempt = 0;
  while (true) {
    try {
      const connection = await amqp.connect(url);
      const channel = await connection.createChannel();
      await channel.assertExchange(ALERT_EXCHANGE, "fanout", { durable: true });
      return { connection, channel };
    } catch (error) {
      attempt += 1;
      const delay = Math.min(attempt * 1000, 10000);
      console.error(
        `RabbitMQ indisponível; nova tentativa em ${delay}ms`,
        error,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
