import { timingSafeEqual } from "node:crypto";
import { pool } from "./db";
import type { RecipientRow } from "./transfers";
import { maskPhone } from "./validators";

export class HandleTakenError extends Error {}

export async function createRecipient(p: {
  handle: string; recipientName: string; recipientPhone: string; recipientNetwork: string;
}): Promise<RecipientRow> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO recipients(handle, recipient_name, recipient_phone, recipient_network)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [p.handle, p.recipientName, p.recipientPhone, p.recipientNetwork]);
    return rows[0];
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HandleTakenError("Cet identifiant est déjà pris");
    throw e;
  }
}

export async function getRecipient(handle: string): Promise<RecipientRow | null> {
  const { rows } = await pool.query(`SELECT * FROM recipients WHERE handle=$1`, [handle.toLowerCase()]);
  return rows[0] ?? null;
}

// Accès propriétaire (historique, cagnottes) : jeton secret donné une seule fois à la création
export async function getRecipientForOwner(handle: string, token: string | null): Promise<RecipientRow | null> {
  if (!token) return null;
  const r = await getRecipient(handle);
  if (!r) return null;
  const a = Buffer.from((r as RecipientRow & { owner_token: string }).owner_token);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b) ? r : null;
}

export const ownerToken = (r: RecipientRow) => (r as RecipientRow & { owner_token: string }).owner_token;

// Ce que voit un expéditeur : jamais le numéro complet
export function publicRecipient(r: RecipientRow) {
  return {
    handle: r.handle,
    name: r.recipient_name,
    phone: maskPhone(r.recipient_phone),
    network: r.recipient_network,
  };
}

// URL publique (https via ngrok) : APP_URL si https, sinon en-têtes du proxy
export function publicBaseUrl(req: Request): string {
  if (process.env.APP_URL?.startsWith("https://")) return process.env.APP_URL.replace(/\/$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
