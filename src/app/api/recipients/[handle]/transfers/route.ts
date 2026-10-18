import QRCode from "qrcode";
import { BitnobError } from "@/lib/bitnob";
import { getRecipient } from "@/lib/recipients";
import { createLinkTransfer } from "@/lib/transfers";
import { linkTransferSchema } from "@/lib/validators";

// POST : envoi via un lien permanent. Le bénéficiaire est lu en base, jamais envoyé par le client.
export async function POST(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const r = await getRecipient(handle);
  if (!r) return Response.json({ error: "Ce lien n'existe pas" }, { status: 404 });

  const parsed = linkTransferSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Données invalides", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    const t = await createLinkTransfer(r, parsed.data);
    const uri = `lightning:${t.invoice.request}`;
    return Response.json({
      id: t.id, token: t.accessToken, totalSats: t.price.totalSats,
      qr: await QRCode.toDataURL(uri.toUpperCase(), { width: 320, margin: 1 }),
    }, { status: 201 });
  } catch (e) {
    console.error("link transfer", e instanceof BitnobError ? e.body : e);
    return Response.json({ error: "Impossible de créer l'envoi, réessayez." }, { status: 502 });
  }
}
