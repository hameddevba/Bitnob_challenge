
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type BitnobEvent = {
  event?: unknown;
  event_id?: unknown;
  data?: {
    amount?: unknown;
    chain?: unknown;
    reference?: unknown;
    transaction_id?: unknown;
    invoice?: unknown;
    [key: string]: unknown;
  };
};

function verifySignature(rawBody: string, signature: string, secret: string) {
  const expected = createHmac("sha512", secret)
    .update(rawBody)
    .digest();

  if (!/^[a-f0-9]{128}$/i.test(signature)) {
    return false;
  }

  const received = Buffer.from(signature, "hex");

  return (
    received.length === expected.length &&
    timingSafeEqual(received, expected)
  );
}

export async function POST(request: Request) {
  const secret = process.env.BITNOB_WEBHOOK_SECRET;
  const signature = request.headers.get("x-bitnob-signature");

  if (!secret || !signature) {
    return NextResponse.json(
      { success: false, error: "Configuration ou signature manquante." },
      { status: 401 },
    );
  }

  const rawBody = await request.text();

  if (!verifySignature(rawBody, signature, secret)) {
    console.warn("Signature webhook Bitnob invalide.");

    return NextResponse.json(
      { success: false, error: "Signature invalide." },
      { status: 401 },
    );
  }

  let event: BitnobEvent;

  try {
    event = JSON.parse(rawBody) as BitnobEvent;
  } catch {
    return NextResponse.json(
      { success: false, error: "JSON invalide." },
      { status: 400 },
    );
  }

  const eventName =
    typeof event.event === "string" ? event.event : "";

  const eventId =
    typeof event.event_id === "string"
      ? event.event_id
      : request.headers.get("x-bitnob-event-id");

  if (!eventId || !eventName) {
    return NextResponse.json(
      { success: false, error: "Identifiant ou type d'événement manquant." },
      { status: 400 },
    );
  }

  // Les événements de test ne modifient jamais les paiements.
  if (eventName === "webhook.test") {
    console.info("Événement de test Bitnob reçu.");
    return NextResponse.json({ received: true, test: true });
  }

  const data = event.data;
  const reference =
    typeof data?.reference === "string" ? data.reference : "";

  // Notre facture utilise la référence ECO_<UUID Supabase>.
  const transactionId = reference.startsWith("ECO_")
    ? reference.slice(4)
    : "";

  let eventRowId: string | undefined;

  // Enregistrer l'événement pour prévenir les doubles traitements.
  const { data: insertedEvent, error: insertError } = await supabase
    .from("bitnob_webhook_events")
    .insert({
      event_id: eventId,
      event_type: eventName,
      transaction_id: transactionId || null,
      processing_status: "received",
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code !== "23505") {
      console.error("Erreur d'enregistrement du webhook :", insertError);

      return NextResponse.json(
        { success: false, error: "Erreur temporaire." },
        { status: 500 },
      );
    }

    // Événement déjà reçu : ne pas retraiter un événement terminé.
    const { data: existingEvent, error: lookupError } = await supabase
      .from("bitnob_webhook_events")
      .select("id, processing_status")
      .eq("event_id", eventId)
      .single();

    if (lookupError || !existingEvent) {
      return NextResponse.json(
        { success: false, error: "Impossible de vérifier l'événement." },
        { status: 500 },
      );
    }

    if (
      existingEvent.processing_status === "processed" ||
      existingEvent.processing_status === "ignored"
    ) {
      return NextResponse.json({
        received: true,
        duplicate: true,
      });
    }

    eventRowId = existingEvent.id;

    await supabase
      .from("bitnob_webhook_events")
      .update({
        processing_status: "received",
        transaction_id: transactionId || null,
      })
      .eq("id", eventRowId);
  } else {
    eventRowId = insertedEvent.id;
  }

  async function finishEvent(
    status: "processed" | "ignored" | "failed",
  ) {
    if (!eventRowId) return;

    const { error } = await supabase
      .from("bitnob_webhook_events")
      .update({
        processing_status: status,
        processed_at: new Date().toISOString(),
      })
      .eq("id", eventRowId);

    if (error) {
      console.error("Erreur de mise à jour du webhook :", error);
      throw error;
    }
  }

  try {
    // Pour l'instant, seul le paiement Lightning réussi nous intéresse.
    if (eventName !== "transfer.success") {
      await finishEvent("ignored");
      return NextResponse.json({
        received: true,
        ignored: true,
      });
    }

    if (
      data?.chain !== "lightning" ||
      !transactionId ||
      typeof data.amount !== "string" ||
      !/^\d+$/.test(data.amount)
    ) {
      await finishEvent("failed");

      return NextResponse.json(
        { success: false, error: "Données de paiement invalides." },
        { status: 400 },
      );
    }

    const amountSats = Number(data.amount);

    if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
      await finishEvent("failed");

      return NextResponse.json(
        { success: false, error: "Montant en sats invalide." },
        { status: 400 },
      );
    }

    // Retrouver la transaction créée au moment de la génération de facture.
    const { data: transaction, error: transactionError } = await supabase
      .from("transactions")
      .select("id, amount_sats, payment_status")
      .eq("id", transactionId)
      .maybeSingle();

    if (transactionError) {
      console.error("Erreur de recherche de transaction :", transactionError);
      await finishEvent("failed");

      return NextResponse.json(
        { success: false, error: "Erreur de recherche de transaction." },
        { status: 500 },
      );
    }

    if (!transaction) {
      await finishEvent("failed");

      return NextResponse.json(
        { success: false, error: "Transaction ECO introuvable." },
        { status: 404 },
      );
    }

    // Un événement rejoué ne doit pas changer un paiement déjà confirmé.
    if (transaction.payment_status === "paid") {
      await finishEvent("processed");

      return NextResponse.json({
        received: true,
        alreadyPaid: true,
      });
    }

    // Vérifier le montant reçu par rapport à celui de la facture ECO.
    if (
      transaction.amount_sats === null ||
      Number(transaction.amount_sats) !== amountSats
    ) {
      console.error("Montant Bitnob différent du montant attendu.", {
        transactionId,
        receivedSats: amountSats,
        expectedSats: transaction.amount_sats,
      });

      await finishEvent("failed");

      return NextResponse.json(
        { success: false, error: "Le montant reçu ne correspond pas." },
        { status: 400 },
      );
    }

    // Confirmer uniquement le paiement ; aucun retrait Wave ici.
    const { data: updatedTransaction, error: updateError } = await supabase
      .from("transactions")
      .update({
        payment_status: "paid",
        payment_hash:
          typeof data.transaction_id === "string"
            ? data.transaction_id
            : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transaction.id)
      .eq("payment_status", "pending")
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("Erreur de confirmation du paiement :", updateError);
      await finishEvent("failed");

      return NextResponse.json(
        { success: false, error: "Impossible de confirmer le paiement." },
        { status: 500 },
      );
    }

    if (!updatedTransaction) {
      // Une autre exécution a pu confirmer le paiement entre-temps.
      const { data: latestTransaction } = await supabase
        .from("transactions")
        .select("payment_status")
        .eq("id", transaction.id)
        .maybeSingle();

      if (latestTransaction?.payment_status !== "paid") {
        await finishEvent("failed");

        return NextResponse.json(
          { success: false, error: "Le paiement reste à vérifier." },
          { status: 409 },
        );
      }
    }

    await finishEvent("processed");

    console.info("Paiement ECO confirmé :", transaction.id);

    return NextResponse.json({
      received: true,
      payment_status: "paid",
      transactionId: transaction.id,
    });
  } catch (error) {
    console.error("Erreur de traitement du webhook :", error);

    return NextResponse.json(
      { success: false, error: "Erreur de traitement du webhook." },
      { status: 500 },
    );
  }
}
