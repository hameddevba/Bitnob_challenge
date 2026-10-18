
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createWavePayout } from "@/lib/wave";

export async function POST(request: Request) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_TEST_SIMULATION !== "true"
  ) {
    return NextResponse.json(
      { success: false, error: "Le test Wave est désactivé." },
      { status: 403 },
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

    const { data: transaction, error } = await supabase
      .from("transactions")
      .select(
        "id, amount_xof, receiver_phone, receiver_currency, payment_status, payout_status",
      )
      .eq("id", transactionId)
      .maybeSingle();

    if (error) {
      console.error("Erreur de recherche de transaction :", error);
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

    if (transaction.payment_status !== "paid") {
      return NextResponse.json(
        {
          success: false,
          error: "Le paiement doit être confirmé avant le versement.",
        },
        { status: 409 },
      );
    }

    if (transaction.receiver_currency !== "XOF") {
      return NextResponse.json(
        {
          success: false,
          error: "Le versement Wave est disponible uniquement en XOF.",
        },
        { status: 400 },
      );
    }

    if (
      transaction.payout_status === "succeeded" ||
      transaction.payout_status === "processing"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Un versement est déjà réussi ou en cours.",
          payout_status: transaction.payout_status,
        },
        { status: 409 },
      );
    }

    const amount = Number(transaction.amount_xof);

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Montant XOF invalide." },
        { status: 400 },
      );
    }

    const rawPhone = String(transaction.receiver_phone ?? "").trim();

    const normalizedPhone = rawPhone.startsWith("+")
      ? rawPhone
      : `+${rawPhone}`;

    const result = await createWavePayout({
      transactionId: transaction.id,
      phoneNumber: normalizedPhone,
      amount,
      currency: transaction.receiver_currency,
    });

    // On renvoie la réponse Wave sans masquer son corps brut.
    // Aucun statut de versement n'est modifié ici.
    return NextResponse.json({
      success: result.ok,
      transactionId,
      waveHttpStatus: result.httpStatus,
      waveRawBody: result.rawBody,
      waveResponse: result.data,
    });
  } catch (error) {
    console.error("Erreur lors du test Wave :", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erreur inattendue lors de l'appel Wave.",
      },
      { status: 500 },
    );
  }
}

