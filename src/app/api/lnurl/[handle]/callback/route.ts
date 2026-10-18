import { rateLimit } from "@/lib/rateLimit";
import { BitnobError } from "@/lib/bitnob";
import { lnurlError, lnurlJson, sendableBounds } from "@/lib/lnurl";
import { getRecipient, publicBaseUrl } from "@/lib/recipients";
import { createLightningAddressTransfer } from "@/lib/transfers";

// GET ?amount=<msat>&comment=… : le portefeuille demande une facture du montant choisi
export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const limited = rateLimit(req, "lnurl-callback", 10);
  if (limited) return limited;
  const { handle } = await params;
  const r = await getRecipient(handle);
  if (!r) return lnurlError("Adresse inconnue", 404);

  const url = new URL(req.url);
  const msat = Number(url.searchParams.get("amount"));
  if (!Number.isInteger(msat) || msat <= 0 || msat % 1000 !== 0) {
    return lnurlError("Montant invalide : un nombre entier de satoshis est attendu");
  }
  const sats = msat / 1000;
  const fee = Number(process.env.SERVICE_FEE_PERCENT ?? 1.5);

  try {
    const { minSats, maxSats } = await sendableBounds(fee);
    if (sats < minSats || sats > maxSats) return lnurlError(`Montant hors limites (${minSats} à ${maxSats} sats)`);

    const senderName = (url.searchParams.get("comment") ?? "").trim().slice(0, 60) || "Expéditeur Lightning";
    const t = await createLightningAddressTransfer(r, sats, senderName);
    return lnurlJson({
      pr: t.invoice.request,
      routes: [],
      successAction: {
        tag: "url",
        description: `Suivre l'envoi vers ${r.recipient_name}`,
        url: `${publicBaseUrl(req)}/pay/${t.id}?token=${t.accessToken}`,
      },
    });
  } catch (e) {
    console.error("lnurl callback", e instanceof BitnobError ? e.body : (e as Error).message);
    return lnurlError("Impossible de créer la facture, réessayez", 502);
  }
}
