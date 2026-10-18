
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getBtcXofRate, xofToSats } from "@/lib/yadio";

function isValidBitcoinAddress(address: string): boolean {
  return /^(bc1[a-z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(
    address,
  );
}

export async function POST(request: Request) {
  let purchaseId: string | undefined;

  try {
    const apiKey = process.env.WAVE_API_KEY;
    const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/+$/, "");

    if (!apiKey || !appBaseUrl) {
      return NextResponse.json(
        { error: "Configuration Wave ou APP_BASE_URL manquante." },
        { status: 500 },
      );
    }

    const baseUrl = new URL(appBaseUrl);

    if (
      baseUrl.protocol !== "https:" &&
      baseUrl.hostname !== "localhost"
    ) {
      return NextResponse.json(
        { error: "APP_BASE_URL doit utiliser HTTPS." },
        { status: 500 },
      );
    }

    const body = await request.json();

    const amountXof = body.amountXof;
    const bitcoinAddress =
      typeof body.bitcoinAddress === "string"
        ? body.bitcoinAddress.trim()
        : "";

    if (
      typeof amountXof !== "number" ||
      !Number.isSafeInteger(amountXof) ||
      amountXof < 100
    ) {
      return NextResponse.json(
        { error: "Le montant minimum est de 100 FCFA." },
        { status: 400 },
      );
    }

    if (!isValidBitcoinAddress(bitcoinAddress)) {
      return NextResponse.json(
        { error: "Adresse Bitcoin invalide." },
        { status: 400 },
      );
    }

    // 1. Récupérer le taux et figer la quantité de BTC promise.
    let exchangeRate: number;
    let amountSats: number;

    try {
      exchangeRate = await getBtcXofRate();
      amountSats = xofToSats(amountXof, exchangeRate);
    } catch (error) {
      console.error("Erreur de conversion BTC/XOF :", error);

      return NextResponse.json(
        {
          error:
            "Impossible de calculer la conversion Bitcoin actuellement. Réessaie plus tard.",
        },
        { status: 503 },
      );
    }

    const clientReference = `BTCBUY_${randomUUID()}`;

    // 2. Enregistrer la commande et son taux AVANT le paiement.
    const { data: purchase, error: insertError } = await supabase
      .from("wave_bitcoin_purchases")
      .insert({
        amount_xof: amountXof,
        bitcoin_address: bitcoinAddress,
        client_reference: clientReference,
        amount_sats: amountSats,
        exchange_rate: exchangeRate,
        payment_status: "pending",
        payout_status: "not_started",
      })
      .select("id")
      .single();

    if (insertError || !purchase) {
      console.error("Erreur création commande :", insertError);

      return NextResponse.json(
        { error: "Impossible d'enregistrer la commande." },
        { status: 500 },
      );
    }

    purchaseId = purchase.id;

    const successUrl = new URL(
      "/buy-bitcoin/confirmation",
      appBaseUrl,
    );
    successUrl.searchParams.set("client_reference", clientReference);

    const errorUrl = new URL(
      "/buy-bitcoin/confirmation",
      appBaseUrl,
    );
    errorUrl.searchParams.set("client_reference", clientReference);
    errorUrl.searchParams.set("payment", "error");

    // 3. Créer la session de paiement Wave.
    const waveResponse = await fetch(
      "https://api.wave.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: String(amountXof),
          currency: "XOF",
          client_reference: clientReference,
          success_url: successUrl.toString(),
          error_url: errorUrl.toString(),
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );

    const waveData = await waveResponse.json().catch(() => null);

    if (
      !waveResponse.ok ||
      typeof waveData?.wave_launch_url !== "string"
    ) {
      console.error("Échec Wave Checkout :", {
        status: waveResponse.status,
        clientReference,
      });

      await supabase
        .from("wave_bitcoin_purchases")
        .update({
          payment_status: "checkout_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", purchaseId);

      return NextResponse.json(
        { error: "Wave n'a pas pu créer la session de paiement." },
        { status: 502 },
      );
    }

    // 4. Sauvegarder les références Wave.
    const { error: updateError } = await supabase
      .from("wave_bitcoin_purchases")
      .update({
        wave_checkout_id:
          typeof waveData.id === "string" ? waveData.id : null,
        wave_launch_url: waveData.wave_launch_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchaseId);

    if (updateError) {
      console.error("Erreur sauvegarde session Wave :", updateError);

      return NextResponse.json(
        {
          error:
            "Session Wave créée, mais sa sauvegarde a échoué. Ne relance pas le paiement sans vérifier la commande.",
          clientReference,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      checkoutUrl: waveData.wave_launch_url,
      clientReference,
      amountXof,
      amountSats,
      exchangeRate,
    });
  } catch (error) {
    console.error("Erreur checkout :", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "Délai dépassé lors de la création du paiement."
            : "Erreur interne lors de la création du paiement.",
      },
      { status: 500 },
    );
  }
}
