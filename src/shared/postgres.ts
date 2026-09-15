import { Pool } from "pg";

export async function connectPostgres(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString });
  let attempt = 0;

  while (true) {
    try {
      await pool.query("SELECT 1");
      return pool;
    } catch (error) {
      attempt += 1;
      const delay = Math.min(attempt * 1000, 10000);
      console.error(
        `PostgreSQL indisponivel; nova tentativa em ${delay}ms`,
        error,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
