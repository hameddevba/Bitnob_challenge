import { Pool, PoolClient } from "pg";

// Supabase : utiliser l'URL « Session pooler » (IPv4). Le certificat Supabase n'est pas
// dans le magasin par défaut de Node, d'où rejectUnauthorized: false (à durcir en prod).
const g = globalThis as unknown as { __pgPool?: Pool };

export const pool =
  g.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /supabase\.(co|com)/.test(process.env.DATABASE_URL ?? "") ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
if (process.env.NODE_ENV !== "production") g.__pgPool = pool; // évite les pools multiples en hot reload

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
