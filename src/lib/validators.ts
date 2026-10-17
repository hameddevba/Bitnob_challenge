import { z } from "zod";
import { SN_NETWORKS, SN_PHONE_PATTERN } from "./bitnob";

// Numéro sénégalais → 9 chiffres (771234567), format attendu par Bitnob.
export function normalizeSnPhone(input: string): string {
  const digits = input.replace(/[\s.\-()]/g, "");
  if (!SN_PHONE_PATTERN.test(digits)) throw new Error("Numéro sénégalais invalide (ex. 77 123 45 67)");
  return digits.replace(/^\+?221/, "");
}

export function maskPhone(phone: string): string {
  return phone.length >= 9 ? `${phone.slice(0, 2)} ••• •• ${phone.slice(-2)}` : "•••";
}

const amount = z.number().int()
  .min(Number(process.env.MIN_FCFA ?? 500))
  .max(Number(process.env.MAX_FCFA ?? 500000));

export const createTransferSchema = z.object({
  amountFcfa: amount,
  recipientName: z.string().trim().min(2).max(100),
  recipientPhone: z.string().trim().refine((v) => {
    try { normalizeSnPhone(v); return true; } catch { return false; }
  }, "Numéro sénégalais invalide (ex. 77 123 45 67)").transform(normalizeSnPhone),
  recipientNetwork: z.enum(SN_NETWORKS).default("orange"),
  senderName: z.string().trim().min(2).max(100),
  senderCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Code pays ISO à 2 lettres"),
  refundAddress: z.string().trim().max(200).optional(),
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
