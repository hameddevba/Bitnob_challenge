import { createHash } from "node:crypto";
import { bitnob } from "./bitnob";

// Environnement réel des clés Bitnob (GET /api/whoami → "sandbox" | "live").
// Cache lié aux clés (un changement de clé l'invalide) et limité à 60 s.
let cached: { key: string; at: number; value: Promise<string> } | null = null;

function keyFingerprint() {
  return createHash("sha256")
    .update(`${process.env.BITNOB_CLIENT_ID}:${process.env.BITNOB_CLIENT_SECRET}`).digest("hex");
}

function fetchEnvironment(): Promise<string> {
  return bitnob<{ environment?: string }>("GET", "/api/whoami").then((w) => w.environment ?? "inconnu");
}

export function getBitnobEnvironment(): Promise<string> {
  const key = keyFingerprint();
  if (!cached || cached.key !== key || Date.now() - cached.at > 60_000) {
    const value = fetchEnvironment().catch(() => {
      cached = null; // réessayer au prochain appel
      return "indisponible";
    });
    cached = { key, at: Date.now(), value };
  }
  return cached.value;
}

// Simulation de paiement : seulement si explicitement activée ET si Bitnob confirme le sandbox.
// fresh=true : interroge Bitnob sans cache (obligatoire avant toute action).
export async function isSimulationEnabled(opts: { fresh?: boolean } = {}): Promise<boolean> {
  if (process.env.SANDBOX_SIMULATION !== "true") return false;
  const env = opts.fresh ? await fetchEnvironment().catch(() => "indisponible") : await getBitnobEnvironment();
  return env === "sandbox";
}

// Plafonds partagés serveur / client (variables publiques, non secrètes)
export const MIN_FCFA = Number(process.env.NEXT_PUBLIC_MIN_FCFA ?? 500);
export const MAX_FCFA = Number(process.env.NEXT_PUBLIC_MAX_FCFA ?? 500000);
