import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    // Protection : aucun retrait sans activation explicite.
    if (process.env.BITNOB_WITHDRAWALS_ENABLED !== "true") {
      return NextResponse.json(
        { error: "Les retraits Bitcoin sont désactivés pour le moment." },
        { status: 503 },
      );
    }

    const clientId = process.env.BITNOB_CLIENT_ID;
    const clientSecret = process.env.BITNOB_CLIENT_SECRET;
    const baseUrl = (
      process.env.BITNOB_BASE_URL || "https://api.bitnob.com"
    ).replace(/\/+$/, "");

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: "Configuration Bitnob manquante." },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => null);
    const clientReference = body?.clientReference;

    if (
      typeof clientReference !== "string" ||
      !/^BTCBUY_[0-9a-f-]{36}$/i.test(clientReference)
    ) {
      return NextResponse.json(
        { error: "Référence de commande invalide." },
        { status: 400 },
      );
    }

    // Charger uniquement les informations nécessaires.
    const { data: purchase, error: lookupError } = await supabase
      .from("wave_bitcoin_purchases")
      .select(
        "id, amount_sats, bitcoin_address, payment_status, payout_status",
      )
      .eq("client_reference", clientReference)
      .maybeSingle();

    if (lookupError) {
      console.error("Erreur lecture commande Bitcoin :", lookupError);
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

    // Un paiement non confirmé ne peut jamais déclencher un retrait.
    if (purchase.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Le paiement Wave n'est pas confirmé." },
        { status: 409 },
      );
    }

    // Ne jamais envoyer une seconde fois une commande déjà prise en charge.
    if (purchase.payout_status !== "not_started") {
      return NextResponse.json({
        success: true,
        message: "Cette commande a déjà été prise en charge.",
        payoutStatus: purchase.payout_status,
      });
    }

    const amountSats = Number(purchase.amount_sats);

    if (
      !Number.isSafeInteger(amountSats) ||
      amountSats <= 0 ||
      !purchase.bitcoin_address
    ) {
      return NextResponse.json(
        { error: "Montant en satoshis ou adresse Bitcoin invalide." },
        { status: 409 },
      );
    }

    // Réserver la commande atomiquement avant l'appel externe.
    // Une seule exécution peut passer de not_started à processing.
    const { data: claimedPurchase, error: claimError } = await supabase
      .from("wave_bitcoin_purchases")
      .update({
        payout_status: "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchase.id)
      .eq("payment_status", "paid")
      .eq("payout_status", "not_started")
      .select("id")
      .maybeSingle();

    if (claimError) {
      console.error("Erreur réservation retrait :", claimError);
      return NextResponse.json(
        { error: "Impossible de réserver le retrait." },
        { status: 500 },
      );
    }

    if (!claimedPurchase) {
      return NextResponse.json(
        { error: "La commande est déjà en cours de traitement." },
        { status: 409 },
      );
    }

    // Même référence à chaque tentative : clé d'idempotence Bitnob.
    const withdrawalReference = clientReference;

    const withdrawalBody = JSON.stringify({
      to_address: purchase.bitcoin_address,
      amount: String(amountSats),
      currency: "BTC",
      chain: "bitcoin",
      reference: withdrawalReference,
      description: `Achat Bitcoin ${clientReference}`,
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const payload = `${clientId}:${timestamp}:${nonce}:${withdrawalBody}`;

    const signature = createHmac("sha256", clientSecret)
      .update(payload)
      .digest("hex");

    let bitnobResponse: Response;

    try {
      bitnobResponse = await fetch(`${baseUrl}/api/withdrawals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Client": clientId,
          "X-Auth-Timestamp": timestamp,
          "X-Auth-Nonce": nonce,
          "X-Auth-Signature": signature,
        },
        body: withdrawalBody,
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      // Un délai dépassé ne prouve pas que Bitnob n'a rien envoyé.
      // On garde processing pour empêcher un nouvel envoi automatique.
      console.error("Résultat du retrait Bitnob incertain :", error);

      return NextResponse.json(
        {
          error:
            "Résultat incertain. Vérifie la transaction chez Bitnob avant toute nouvelle tentative.",
          payoutStatus: "processing",
          clientReference,
        },
        { status: 502 },
      );
    }

    const result = await bitnobResponse.json().catch(() => null);

    if (!bitnobResponse.ok) {
      // Pas de nouvel essai automatique : vérifier d'abord côté Bitnob,
      // notamment en cas de conflit ou de réponse ambiguë.
      console.error("Refus du retrait Bitnob :", {
        httpStatus: bitnobResponse.status,
        clientReference,
        response: result,
      });

      return NextResponse.json(
        {
          error: "Bitnob n'a pas confirmé la demande de retrait.",
          payoutStatus: "processing",
          clientReference,
        },
        { status: 502 },
      );
    }

    const withdrawalId = result?.data?.transaction_id;
    const providerStatus = result?.data?.status;

    if (
      typeof withdrawalId !== "string" ||
      !["pending", "completed", "failed"].includes(providerStatus)
    ) {
      // La demande a peut-être été acceptée : ne pas la relancer.
      console.error("Réponse Bitnob inattendue :", {
        clientReference,
        result,
      });

      return NextResponse.json(
        {
          error:
            "Réponse Bitnob à vérifier avant toute nouvelle tentative.",
          payoutStatus: "processing",
          clientReference,
        },
        { status: 502 },
      );
    }

    const payoutStatus =
      providerStatus === "completed"
        ? "completed"
        : providerStatus === "failed"
          ? "failed"
          : "processing";

    const { error: saveError } = await supabase
      .from("wave_bitcoin_purchases")
      .update({
        bitnob_withdrawal_id: withdrawalId,
        payout_status: payoutStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchase.id);

    if (saveError) {
      // Ne surtout pas renvoyer le retrait automatiquement :
      // Bitnob a déjà répondu avec un identifiant de transaction.
      console.error("Retrait créé mais sauvegarde échouée :", {
        clientReference,
        withdrawalId,
        saveError,
      });

      return NextResponse.json(
        {
          error:
            "Retrait potentiellement créé. Vérifie Bitnob avant toute action.",
          payoutStatus: "processing",
          clientReference,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      clientReference,
      withdrawalId,
      payoutStatus,
    });
  } catch (error) {
    console.error("Erreur route retrait Bitcoin :", error);

    return NextResponse.json(
      { error: "Erreur interne lors du traitement du retrait." },
      { status: 500 },
    );
  }
}
