import { bitnob } from "./bitnob";

// Environnement réel des clés Bitnob (GET /api/whoami → "sandbox" | "production"), mis en cache.
let cached: Promise<string> | null = null;

export function getBitnobEnvironment(): Promise<string> {
  cached ??= bitnob<{ environment?: string }>("GET", "/api/whoami")
    .then((w) => w.environment ?? "inconnu")
    .catch(() => {
      cached = null; // réessayer au prochain rendu
      return "indisponible";
    });
  return cached;
}

// Plafonds partagés serveur / client (variables publiques, non secrètes)
export const MIN_FCFA = Number(process.env.NEXT_PUBLIC_MIN_FCFA ?? 500);
export const MAX_FCFA = Number(process.env.NEXT_PUBLIC_MAX_FCFA ?? 500000);
