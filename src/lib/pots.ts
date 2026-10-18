import { randomBytes } from "node:crypto";
import { pool } from "./db";
import type { RecipientRow } from "./transfers";
import { maskPhone } from "./validators";

// Cagnotte familiale : un objectif partagé, chaque contribution est un envoi complet
// vers le mobile money du bénéficiaire. Seuls les envois livrés comptent dans la progression.

export type PotRow = {
  id: string; slug: string; recipient_id: string; title: string; goal_fcfa: string; closed: boolean; created_at: string;
};

export function potSlug(title: string): string {
  const base = title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "cagnotte";
  return `${base.length >= 3 ? base : `${base}-cagnotte`}-${randomBytes(2).toString("hex")}`;
}

export async function createPot(r: RecipientRow, p: { title: string; goalFcfa: number }): Promise<PotRow> {
  const { rows } = await pool.query(
    `INSERT INTO pots(slug, recipient_id, title, goal_fcfa) VALUES ($1,$2,$3,$4) RETURNING *`,
    [potSlug(p.title), r.id, p.title, p.goalFcfa]);
  return rows[0];
}

export async function getPot(slug: string): Promise<(PotRow & { recipient: RecipientRow }) | null> {
  const { rows } = await pool.query(
    `SELECT p.*, row_to_json(r.*) AS recipient FROM pots p JOIN recipients r ON r.id = p.recipient_id WHERE p.slug=$1`,
    [slug.toLowerCase()]);
  return rows[0] ?? null;
}

export async function potProgress(potId: string) {
  const { rows: [sum] } = await pool.query(
    `SELECT coalesce(sum(amount_fcfa),0)::bigint AS raised, count(*)::int AS contributions,
            count(*) FILTER (WHERE payout_status='SIMULATED')::int AS simulated
     FROM transfers WHERE pot_id=$1 AND status='PAYOUT_SUCCESS'`, [potId]);
  const { rows } = await pool.query(
    `SELECT CASE WHEN show_sender THEN sender_name ELSE NULL END AS name, amount_fcfa, updated_at,
            payout_status='SIMULATED' AS simulated
     FROM transfers WHERE pot_id=$1 AND status='PAYOUT_SUCCESS'
     ORDER BY updated_at DESC LIMIT 30`, [potId]);
  return {
    raisedFcfa: Number(sum.raised),
    contributions: sum.contributions,
    simulated: sum.simulated,
    recent: rows.map((c) => ({ name: c.name as string | null, amountFcfa: Number(c.amount_fcfa), at: c.updated_at, simulated: c.simulated })),
  };
}

export function publicPot(p: PotRow & { recipient: RecipientRow }) {
  return {
    slug: p.slug,
    title: p.title,
    goalFcfa: Number(p.goal_fcfa),
    closed: p.closed,
    createdAt: p.created_at,
    recipient: {
      handle: p.recipient.handle,
      name: p.recipient.recipient_name,
      phone: maskPhone(p.recipient.recipient_phone),
      network: p.recipient.recipient_network,
    },
  };
}
