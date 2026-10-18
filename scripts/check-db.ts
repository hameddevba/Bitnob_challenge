// Vérifie la connexion à Supabase et la présence du schéma. Usage : npm run check:db
import { config } from "dotenv";
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.log("❌ DATABASE_URL vide dans .env.local");
  process.exitCode = 1;
} else {
  const { pool } = await import("../src/lib/db");
  try {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' ORDER BY table_name`);
    const tables = rows.map((r) => r.table_name);
    const expected = ["transfer_events", "transfers", "users", "webhook_receipts"];
    const missing = expected.filter((t) => !tables.includes(t));
    console.log(missing.length ? `❌ Tables manquantes : ${missing.join(", ")}` : `✅ Connexion OK, tables : ${tables.join(", ")}`);
    if (missing.length) process.exitCode = 1;
  } catch (e) {
    console.log(`❌ Connexion impossible : ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
