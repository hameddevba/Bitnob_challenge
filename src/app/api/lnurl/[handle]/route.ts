import { lnurlError, lnurlJson, lnurlMetadata, sendableBounds } from "@/lib/lnurl";
import { getRecipient, publicBaseUrl } from "@/lib/recipients";

// GET /.well-known/lnurlp/:handle (réécrit vers ici) — première étape de l'adresse Lightning
export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const r = await getRecipient(handle);
  if (!r) return lnurlError("Adresse inconnue", 404);
  try {
    const base = publicBaseUrl(req);
    const { minSats, maxSats } = await sendableBounds(Number(process.env.SERVICE_FEE_PERCENT ?? 1.5));
    return lnurlJson({
      tag: "payRequest",
      callback: `${base}/api/lnurl/${r.handle}/callback`,
      minSendable: minSats * 1000,
      maxSendable: maxSats * 1000,
      metadata: lnurlMetadata(r, new URL(base).host),
      commentAllowed: 60, // le commentaire sert de nom d'expéditeur
    });
  } catch (e) {
    console.error("lnurl", (e as Error).message);
    return lnurlError("Service momentanément indisponible", 503);
  }
}
