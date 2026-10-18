import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processPayouts } from "@/lib/server/transfers";
import { admin } from "@/lib/server/supabase";


function verifyWorkerSecret(secretHeader: string | null): boolean {
  const expected = process.env.WORKER_SECRET;
  if (!expected) return false;
  if (!secretHeader) return false;

  const a = Buffer.from(secretHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secretHeader = req.headers.get("x-worker-secret");
  if (!verifyWorkerSecret(secretHeader)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    // 1. Expirer les factures dépassées
    const { data: expired } = await admin
      .from("transfers")
      .update({ status: "expired" })
      .eq("status", "awaiting_payment")
      .lt("invoice_expires_at", new Date().toISOString())
      .select("id");

    // 2. Traiter les décaissements en attente
    const payoutResult = await processPayouts();

    return NextResponse.json({
      ok: true,
      expiredCount: expired?.length || 0,
      payouts: payoutResult,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Erreur worker:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
