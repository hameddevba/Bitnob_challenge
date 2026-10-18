
const YADIO_URL = "https://api.yadio.io/exrates/BTC";

type YadioResponse = {
  BTC?: {
    XOF?: number;
  };
  timestamp?: number;
};

export async function getBtcXofRate(): Promise<number> {
  const response = await fetch(YADIO_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Erreur Yadio HTTP ${response.status}`);
  }

  const data = (await response.json()) as YadioResponse;
  const rate = data.BTC?.XOF;

  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("Taux BTC/XOF absent ou invalide dans la réponse Yadio");
  }

  return rate;
}

export function xofToSats(
  amountXof: number,
  btcXofRate: number,
): number {
  if (!Number.isSafeInteger(amountXof) || amountXof <= 0) {
    throw new Error("Le montant en FCFA doit être un entier positif");
  }

  if (!Number.isFinite(btcXofRate) || btcXofRate <= 0) {
    throw new Error("Le taux BTC/XOF est invalide");
  }

  const sats = Math.ceil((amountXof / btcXofRate) * 100_000_000);

  if (!Number.isSafeInteger(sats) || sats <= 0) {
    throw new Error("Le nombre de sats calculé est invalide");
  }

  return sats;
}
