
import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  // Simulation autorisée uniquement si explicitement activée hors production.
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_TEST_SIMULATION !== "true"
  ) {
    return NextResponse.json(
      { success: false, error: "Simulation désactivée." },
      { status: 403 },
    );
  }

  const secret = process.env.BITNOB_WEBHOOK_SECRET;

  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Secret webhook manquant." },
      { status: 500 },
    );
  }

  try {
    const body = await request.json();
    const transactionId =
      typeof body.transactionId === "string"
        ? body.transactionId.trim()
        : "";

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: "transactionId obligatoire." },
        { status: 400 },
      );
    }

    // Le montant attendu vient de Supabase, jamais du navigateur.
    const { data: transaction, error } = await supabase
      .from("transactions")
      .select("id, amount_sats, payment_status")
      .eq("id", transactionId)
      .maybeSingle();

    if (error) {
      console.error("Erreur de recherche pour la simulation :", error);
      return NextResponse.json(
        { success: false, error: "Impossible de rechercher la transaction." },
        { status: 500 },
      );
    }

    if (!transaction) {
      return NextResponse.json(
        { success: false, error: "Transaction introuvable." },
        { status: 404 },
      );
    }

    if (transaction.payment_status === "paid") {
      return NextResponse.json({
        success: true,
        alreadyPaid: true,
        transactionId,
        message: "Cette transaction est déjà marquée comme payée.",
      });
    }

    if (transaction.payment_status !== "pending") {
      return NextResponse.json(
        {
          success: false,
          error: "La transaction n'est pas en attente de paiement.",
          payment_status: transaction.payment_status,
        },
        { status: 409 },
      );
    }

    const amountSats = Number(transaction.amount_sats);

    if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
      return NextResponse.json(
        { success: false, error: "Montant en sats invalide en base." },
        { status: 400 },
      );
    }

    const payload = {
      event: "transfer.success",
      event_id: `simulation_${randomUUID()}`,
      data: {
        reference: `ECO_${transaction.id}`,
        chain: "lightning",
        amount: String(amountSats),
        transaction_id: `simulation_${randomUUID()}`,
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha512", secret)
      .update(rawBody)
      .digest("hex");

    // Réutilise le webhook existant et ses contrôles de montant/signature.
    const webhookUrl = new URL(
      "/api/webhooks/bitnob",
      new URL(request.url).origin,
    );

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bitnob-signature": signature,
      },
      body: rawBody,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const webhookBody = await webhookResponse.text();

    let webhookResult: unknown = webhookBody;
    try {
      webhookResult = JSON.parse(webhookBody);
    } catch {
      // Conserver le texte brut si le webhook ne renvoie pas du JSON.
    }

    return NextResponse.json(
      {
        success: webhookResponse.ok,
        simulation: true,
        transactionId,
        webhookHttpStatus: webhookResponse.status,
        webhookResponse: webhookResult,
      },
      { status: webhookResponse.ok ? 200 : 502 },
    );
  } catch (error) {
    console.error("Erreur de simulation :", error);

    return NextResponse.json(
      { success: false, error: "Échec de la simulation." },
      { status: 500 },
    );
  }
}

