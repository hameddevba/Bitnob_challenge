import { readFileSync } from "node:fs";
import { Pool, PoolClient } from "pg";

// Supabase : utiliser l'URL « Session pooler » (IPv4).
// TLS vérifié si DATABASE_CA_CERT pointe vers le certificat Supabase
// (Dashboard → Project Settings → Database → SSL Configuration → Download certificate).
// Sans lui, la connexion reste chiffrée mais le serveur n'est pas authentifié : à éviter en production.
function sslConfig() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/supabase\.(co|com)/.test(url)) return undefined;
  const caPath = process.env.DATABASE_CA_CERT;
  if (caPath) return { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true };
  console.warn("DATABASE_CA_CERT absent : certificat Supabase non vérifié (acceptable en sandbox uniquement)");
  return { rejectUnauthorized: false };
}

const g = globalThis as unknown as { __pgPool?: Pool };

export const pool = g.__pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslConfig(), max: 5 });
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
