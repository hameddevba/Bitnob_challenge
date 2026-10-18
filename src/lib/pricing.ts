import type { Payout } from "./bitnob";

// Montants en satoshis entiers. Les chaînes BTC de Bitnob ("0.0000207925940815")
// sont converties sans passer par des flottants, en arrondissant au sat supérieur.

export function btcStringToSats(btc: string): number {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(btc.trim());
  if (!m) throw new Error(`Montant BTC invalide : ${btc}`);
  const [, int, frac = ""] = m;
  const sats = BigInt(int) * 100_000_000n + BigInt((frac + "00000000").slice(0, 8));
  const roundUp = /[1-9]/.test(frac.slice(8)) ? 1n : 0n;
  return Number(sats + roundUp);
}

// Coût réel du payout : total_amount (montant + frais) si présent, sinon amount + fees.
export function payoutCostSats(q: Pick<Payout, "amount" | "fees" | "total_amount" | "sat_amount">): number {
  if (q.total_amount) return btcStringToSats(q.total_amount);
  const amount = q.amount ? btcStringToSats(q.amount) : Number(q.sat_amount);
  return amount + btcStringToSats(q.fees || "0");
}

export function satsToBtcString(sats: number): string {
  if (!Number.isInteger(sats) || sats < 0) throw new Error(`Montant en sats invalide : ${sats}`);
  const s = String(sats).padStart(9, "0");
  return `${s.slice(0, -8)}.${s.slice(-8)}`;
}

// Part nette envoyée au payout quand l'expéditeur fixe le total en sats (adresse Lightning) :
// total = net + frais, frais = net × feePercent %.
export function netSatsFromTotal(totalSats: number, feePercent: number): number {
  return Math.floor((totalSats * 100) / (100 + feePercent));
}

export type Pricing = {
  amountFcfa: number;     // garanti au bénéficiaire
  payoutCostSats: number; // ce que Bitnob débite pour le payout
  feeSats: number;        // frais de service
  totalSats: number;      // à payer par l'expéditeur
  feeFcfa: number;        // frais de service, en FCFA (affichage)
  rateBtcXof: number;     // XOF pour 1 BTC
  quoteExpiresAt: string;
};

// Total imposé par l'expéditeur : le bénéficiaire reçoit ce que donne la cotation sur la part nette.
export function priceFromSatsQuote(q: Payout, totalSats: number): Pricing {
  const cost = payoutCostSats(q);
  const amountFcfa = Math.floor(Number(q.settlement_amount));
  if (!(cost > 0) || !(amountFcfa > 0)) throw new Error("Cotation sans montant");
  if (cost > totalSats) throw new Error("Cotation plus chère que le montant reçu");
  const feeSats = totalSats - cost;
  const rateBtcXof = Math.round((amountFcfa * 100_000_000) / cost);
  return {
    amountFcfa,
    payoutCostSats: cost,
    feeSats,
    totalSats,
    feeFcfa: Math.ceil((feeSats * rateBtcXof) / 100_000_000),
    rateBtcXof,
    quoteExpiresAt: q.expires_at,
  };
}

export function priceFromQuote(q: Payout, amountFcfa: number, feePercent: number): Pricing {
  if (Number(q.settlement_amount) !== amountFcfa) {
    throw new Error(`Cotation incohérente : ${q.settlement_amount} XOF au lieu de ${amountFcfa}`);
  }
  const cost = payoutCostSats(q);
  if (!(cost > 0)) throw new Error("Cotation sans montant BTC");
  const feeSats = Math.ceil((cost * feePercent) / 100);
  const rateBtcXof = Math.round((amountFcfa * 100_000_000) / cost);
  return {
    amountFcfa,
    payoutCostSats: cost,
    feeSats,
    totalSats: cost + feeSats,
    feeFcfa: Math.ceil((feeSats * rateBtcXof) / 100_000_000),
    rateBtcXof,
    quoteExpiresAt: q.expires_at,
  };
}
