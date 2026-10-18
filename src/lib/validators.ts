import { z } from "zod";
import { SN_NETWORKS, SN_PHONE_PATTERN } from "./bitnob";
import { MAX_FCFA, MIN_FCFA } from "./environment";

// Numéro sénégalais → 9 chiffres (771234567), format attendu par Bitnob.
export function normalizeSnPhone(input: string): string {
  const digits = input.replace(/[\s.\-()]/g, "");
  if (!SN_PHONE_PATTERN.test(digits)) throw new Error("Numéro sénégalais invalide (ex. 77 123 45 67)");
  return digits.replace(/^\+?221/, "");
}

export function maskPhone(phone: string): string {
  return phone.length >= 9 ? `${phone.slice(0, 2)} ••• •• ${phone.slice(-2)}` : "•••";
}

export const amountSchema = z.number().int().min(MIN_FCFA).max(MAX_FCFA);
const amount = amountSchema;

// Adresse Lightning de remboursement (nom@domaine), facultative
export const lightningAddressSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9._+-]{1,64}@([a-z0-9-]+\.)+[a-z]{2,}$/, "Adresse Lightning invalide (ex. moussa@blink.sv)");
const refundAddress = z.union([lightningAddressSchema, z.literal("")]).optional()
  .transform((v) => v || undefined);

export const createTransferSchema = z.object({
  amountFcfa: amount,
  recipientName: z.string().trim().min(2).max(100),
  recipientPhone: z.string().trim().refine((v) => {
    try { normalizeSnPhone(v); return true; } catch { return false; }
  }, "Numéro sénégalais invalide (ex. 77 123 45 67)").transform(normalizeSnPhone),
  recipientNetwork: z.enum(SN_NETWORKS).default("orange"),
  senderName: z.string().trim().min(2).max(100),
  senderCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Code pays ISO à 2 lettres"),
  refundAddress,
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;

// Identifiant de lien : domaine/p/awa et awa@domaine
const RESERVED = new Set(["api", "admin", "app", "pay", "recu", "creer", "recipient", "support", "www", "root", "lnurl", "well-known"]);
export const handleSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,29}$/, "3 à 30 caractères : lettres, chiffres, point, tiret")
  .refine((h) => !RESERVED.has(h), "Cet identifiant est réservé");

const phoneSchema = z.string().trim().refine((v) => {
  try { normalizeSnPhone(v); return true; } catch { return false; }
}, "Numéro sénégalais invalide (ex. 77 123 45 67)").transform(normalizeSnPhone);

export const createRecipientSchema = z.object({
  handle: handleSchema,
  recipientName: z.string().trim().min(2).max(100),
  recipientPhone: phoneSchema,
  recipientNetwork: z.enum(SN_NETWORKS).default("orange"),
});

export const linkTransferSchema = z.object({
  amountFcfa: amount,
  senderName: z.string().trim().min(2).max(100),
  senderCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Code pays ISO à 2 lettres"),
  refundAddress,
});

export const contributionSchema = linkTransferSchema.extend({
  showSender: z.boolean().default(true),
});

export const createPotSchema = z.object({
  title: z.string().trim().min(3, "3 caractères minimum").max(80),
  goalFcfa: z.number().int().min(MIN_FCFA).max(50_000_000),
});
