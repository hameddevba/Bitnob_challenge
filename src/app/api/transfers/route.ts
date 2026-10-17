import QRCode from "qrcode";
import { BitnobError } from "@/lib/bitnob";
import { createTransfer } from "@/lib/transfers";
import { createTransferSchema } from "@/lib/validators";

// POST : validation du récapitulatif → facture Lightning + QR code
export async function POST(req: Request) {
  const parsed = createTransferSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Données invalides", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    const t = await createTransfer(parsed.data);
    const uri = `lightning:${t.invoice.request}`;
    const qr = await QRCode.toDataURL(uri.toUpperCase(), { width: 320, margin: 1 }); // majuscules = QR plus compact
    return Response.json({
      id: t.id,
      token: t.accessToken,
      amountFcfa: t.price.amountFcfa,
      feeFcfa: t.price.feeFcfa,
      totalSats: t.price.totalSats,
      paymentRequest: t.invoice.request,
      uri,
      qr,
      expiresAt: t.invoice.expires_at,
    }, { status: 201 });
  } catch (e) {
    console.error("create transfer", e instanceof BitnobError ? e.body : e);
    return Response.json({ error: "Impossible de créer le transfert, réessayez." }, { status: 502 });
  }
}
