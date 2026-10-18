import { getRecipient, publicBaseUrl, publicRecipient } from "@/lib/recipients";

// GET : informations publiques d'un lien (nom, opérateur, numéro masqué)
export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const r = await getRecipient(handle);
  if (!r) return Response.json({ error: "Ce lien n'existe pas" }, { status: 404 });
  const base = publicBaseUrl(req);
  return Response.json({ ...publicRecipient(r), lightningAddress: `${r.handle}@${new URL(base).host}` });
}
