
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    const apiKey = process.env.WAVE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Configuration Wave manquante." },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(request.url);
    const clientReference = searchParams.get("client_reference");

    if (
      !clientReference ||
      !/^BTCBUY_[0-9a-f-]{36}$/i.test(clientReference)
    ) {
      return NextResponse.json(
        { error: "Référence de commande invalide." },
        { status: 400 },
      );
    }

    const { data: purchase, error } = await supabase
      .from("wave_bitcoin_purchases")
      .select(
        "id, amount_xof, payment_status, payout_status, wave_checkout_id",
      )
      .eq("client_reference", clientReference)
      .maybeSingle();

    if (error) {
      console.error("Erreur lecture commande Wave :", error);
      return NextResponse.json(
        { error: "Impossible de consulter la commande." },
        { status: 500 },
      );
    }

    if (!purchase) {
      return NextResponse.json(
        { error: "Commande introuvable." },
        { status: 404 },
      );
    }

    if (!purchase.wave_checkout_id) {
      return NextResponse.json(
        { error: "Session Wave introuvable pour cette commande." },
        { status: 409 },
      );
    }

    const response = await fetch(
      `https://api.wave.com/v1/checkout/sessions/${encodeURIComponent(
        purchase.wave_checkout_id,
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );

    const session = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("Erreur vérification Wave :", {
        status: response.status,
        clientReference,
        response: JSON.stringify(session),
      });

      return NextResponse.json(
        { error: "Impossible de vérifier le paiement auprès de Wave." },
        { status: 502 },
      );
    }

    if (
      session?.id !== purchase.wave_checkout_id ||
      session?.client_reference !== clientReference ||
      String(session?.amount) !== String(purchase.amount_xof) ||
      session?.currency !== "XOF"
    ) {
      console.error("Données de session Wave incohérentes :", {
        clientReference,
      });

      return NextResponse.json(
        { error: "Les informations de paiement ne correspondent pas." },
        { status: 409 },
      );
    }

    let paymentStatus = purchase.payment_status;

    if (session.payment_status === "succeeded") {
      if (purchase.payment_status !== "paid") {
        const { error: updateError } = await supabase
          .from("wave_bitcoin_purchases")
          .update({
            payment_status: "paid",
            updated_at: new Date().toISOString(),
          })
          .eq("id", purchase.id)
          .neq("payment_status", "paid");

        if (updateError) {
          console.error("Erreur mise à jour paiement :", updateError);

          return NextResponse.json(
            { error: "Paiement confirmé, mais mise à jour impossible." },
            { status: 500 },
          );
        }
      }

      paymentStatus = "paid";
    } else if (
      session.payment_status === "cancelled" ||
      session.payment_status === "failed"
    ) {
      paymentStatus = session.payment_status;
    } else {
      paymentStatus = "pending";
    }

    return NextResponse.json(
      {
        clientReference,
        amountXof: purchase.amount_xof,
        paymentStatus,
        payoutStatus: purchase.payout_status,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("Erreur API statut Wave :", error);

    return NextResponse.json(
      { error: "Erreur lors de la vérification du paiement." },
      { status: 500 },
    );
  }
}

