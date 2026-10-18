import { randomUUID } from "node:crypto";
import { createPayoutQuote } from "./bitnob";
import { MAX_FCFA, MIN_FCFA } from "./environment";
import { payoutCostSats } from "./pricing";
import type { RecipientRow } from "./transfers";

// LNURL-pay (LUD-06 / LUD-16). Limite connue : Bitnob ne pose pas de description_hash
// dans ses factures, les portefeuilles qui le vérifient strictement refuseront de payer.

export function lnurlMetadata(r: RecipientRow, host: string): string {
  return JSON.stringify([
    ["text/plain", `Arrive en FCFA sur le ${r.recipient_network} de ${r.recipient_name}`],
    ["text/identifier", `${r.handle}@${host}`],
  ]);
}

// Bornes en sats dérivées des plafonds FCFA, à partir d'une cotation de référence (cache 60 s).
let bounds: { at: number; minSats: number; maxSats: number } | null = null;

export async function sendableBounds(feePercent: number) {
  if (bounds && Date.now() - bounds.at < 60_000) return bounds;
  const ref = 1000;
  const q = await createPayoutQuote({ settlementAmountFcfa: ref, reference: `lnurl-${randomUUID()}` });
  const satsPerFcfa = payoutCostSats(q) / ref;
  bounds = {
    at: Date.now(),
    // +2 % de marge pour que la part nette couvre toujours le minimum FCFA
    minSats: Math.ceil(MIN_FCFA * satsPerFcfa * (1 + feePercent / 100) * 1.02),
    maxSats: Math.floor(MAX_FCFA * satsPerFcfa),
  };
  return bounds;
}

export const lnurlError = (reason: string, status = 400) =>
  Response.json({ status: "ERROR", reason }, { status, headers: { "Access-Control-Allow-Origin": "*" } });

export const lnurlJson = (body: unknown) =>
  Response.json(body, { headers: { "Access-Control-Allow-Origin": "*" } });
