// Limitation simple par adresse IP (fenêtre glissante, en mémoire).
// Protège les routes qui créent des cotations / factures chez Bitnob contre le spam.
// Suffisant pour une instance unique (démo) ; en multi-instance, passer par Redis ou la base.

const hits = new Map<string, number[]>();

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export function rateLimit(req: Request, name: string, limit: number, windowMs = 60_000): Response | null {
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    const retry = Math.ceil((windowMs - (now - recent[0])) / 1000);
    return Response.json(
      { error: "Trop de demandes, réessayez dans un instant." },
      { status: 429, headers: { "Retry-After": String(retry) } });
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) hits.clear(); // garde-fou mémoire
  return null;
}
