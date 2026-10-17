// Utilitaires partagés par les écrans (côté client).

export type Quote = {
  amountFcfa: number;
  payoutCostSats: number;
  feeSats: number;
  totalSats: number;
  feeFcfa: number;
  rateBtcXof: number;
  quoteExpiresAt: string;
};

const nf = new Intl.NumberFormat("fr-FR");
export const fcfa = (n: number) => `${nf.format(n)} FCFA`;
export const sats = (n: number) => `${nf.format(n)} sats`;
export const btc = (satsAmount: number) => `${(satsAmount / 1e8).toFixed(8)} BTC`;

export const NETWORKS = [
  { value: "orange", label: "Orange" },
  { value: "wave", label: "Wave" },
  { value: "free", label: "Free" },
  { value: "expresso", label: "Expresso" },
] as const;

export const COUNTRIES = [
  ["SN", "Sénégal"], ["FR", "France"], ["IT", "Italie"], ["ES", "Espagne"], ["US", "États-Unis"],
  ["CI", "Côte d'Ivoire"], ["GH", "Ghana"], ["NG", "Nigeria"], ["CA", "Canada"], ["DE", "Allemagne"],
] as const;

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data as T;
}

export const MIN_FCFA = 500;
export const MAX_FCFA = 500000;
