
const WAVE_API_URL = "https://api.wave.com/v1/payout";

export interface WavePayoutInput {
  transactionId: string;
  phoneNumber: string;
  amount: number;
  currency: string;
  beneficiaryName?: string;
}

export interface WaveApiResult {
  httpStatus: number;
  ok: boolean;
  rawBody: string;
  data: unknown;
}

export async function createWavePayout(
  input: WavePayoutInput,
): Promise<WaveApiResult> {
  const apiKey = process.env.WAVE_API_KEY;

  if (!apiKey) {
    throw new Error("La variable WAVE_API_KEY est absente.");
  }

  if (!input.transactionId.trim()) {
    throw new Error("La référence de transaction est obligatoire.");
  }

  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error("Le montant doit être un entier positif.");
  }

  const phone = input.phoneNumber.trim();

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error(
      "Le numéro doit être au format international, par exemple +221XXXXXXXXX.",
    );
  }

  const currency = input.currency.trim().toUpperCase();

  if (currency !== "XOF") {
    throw new Error("Les versements Wave sont limités à la devise XOF.");
  }

  const payload = {
    currency,
    receive_amount: String(input.amount),
    mobile: phone,
    ...(input.beneficiaryName?.trim()
      ? { name: input.beneficiaryName.trim() }
      : {}),
    client_reference: input.transactionId,
  };

  const response = await fetch(WAVE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `ECO_WAVE_${input.transactionId}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const rawBody = await response.text();

  let data: unknown = rawBody;

  try {
    data = JSON.parse(rawBody);
  } catch {
    // La réponse brute est conservée même si elle n'est pas du JSON.
  }

  return {
    httpStatus: response.status,
    ok: response.ok,
    rawBody,
    data,
  };
}
