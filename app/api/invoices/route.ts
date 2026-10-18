
import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getBtcXofRate, xofToSats } from "@/lib/yadio";

const BITNOB_BASE_URL =
  process.env.BITNOB_BASE_URL || "https://api.bitnob.com";

type BitnobInvoiceResponse = {
  success?: boolean;
  message?: string;
  data?: {
    id?: string;
    request?: string;
    amount_sat?: string | number;
    status?: string;
    expires_at?: string;
  };
};

function getBitnobHeaders(body: string) {
  const clientId = process.env.BITNOB_CLIENT_ID;
  const clientSecret = process.env.BITNOB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Identifiants Bitnob absents de .env.local");
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID().replaceAll("-", "");
  const message = `${clientId}:${timestamp}:${nonce}:${body}`;

  const signature = createHmac("sha256", clientSecret)
    .update(message)
    .digest("hex");

  return {
    "Content-Type": "application/json",
    "X-Auth-Client": clientId,
    "X-Auth-Timestamp": timestamp,
    "X-Auth-Nonce": nonce,
    "X-Auth-Signature": signature,
  };
}

export async function POST(request: Request) {
  let transactionId: string | null = null;
  let bitnobRequestStarted = false;

  try {
    const body = (await request.json()) as {
      amountXof?: unknown;
      receiverPhone?: unknown;
      receiverCurrency?: unknown;
    };

    const { amountXof, receiverPhone, receiverCurrency } = body;

    if (
      typeof amountXof !== "number" ||
      !Number.isSafeInteger(amountXof) ||
      amountXof < 100
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Saisis un montant entier d'au moins 100 FCFA.",
        },
        { status: 400 },
      );
    }

    if (
      typeof receiverPhone !== "string" ||
      !/^\+?[0-9\s()-]{8,20}$/.test(receiverPhone.trim()) ||
      receiverPhone.replace(/\D/g, "").length < 8 ||
      receiverPhone.replace(/\D/g, "").length > 15
    ) {
      return NextResponse.json(
        { success: false, error: "Le numéro du bénéficiaire est invalide." },
        { status: 400 },
      );
    }

    if (
      typeof receiverCurrency !== "string" ||
      !/^[A-Za-z]{3}$/.test(receiverCurrency.trim())
    ) {
      return NextResponse.json(
        { success: false, error: "La devise de réception est invalide." },
        { status: 400 },
      );
    }

    const normalizedPhone = receiverPhone.trim();
    const currency = receiverCurrency.trim().toUpperCase();

  if (currency !== "XOF") {
    return NextResponse.json(
      { error: "Les versements Wave sont disponibles uniquement au Sénégal (XOF)." },
      { status: 400 }
    );
  }

    // 1. Enregistrer la transaction AVANT l'appel à Bitnob.
    const { data: transaction, error: insertError } = await supabase
      .from("transactions")
      .insert({
        amount_xof: amountXof,
        receiver_phone: normalizedPhone,
        receiver_currency: currency,
        payment_status: "pending",
        payout_status: "not_started",
      })
      .select("id")
      .single();

    if (insertError || !transaction) {
      console.error("Erreur création transaction Supabase", insertError);

      return NextResponse.json(
        { success: false, error: "Impossible d'enregistrer la transaction." },
        { status: 500 },
      );
    }

    transactionId = transaction.id;

    // 2. Calculer le montant en sats et sauvegarder le taux.
    const rate = await getBtcXofRate();
    const amountSats = xofToSats(amountXof, rate);

    const { error: calculationUpdateError } = await supabase
      .from("transactions")
      .update({
        amount_sats: amountSats,
        exchange_rate: rate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transactionId);

    if (calculationUpdateError) {
      console.error("Erreur mise à jour du calcul", calculationUpdateError);
      throw new Error("Impossible de sauvegarder le calcul de la transaction.");
    }

    // L'identifiant Supabase sert aussi à retrouver la facture côté Bitnob.
    const reference = `ECO_${transactionId}`;

    const invoiceBody = {
      amount: amountSats,
      description: `Conversion de ${amountXof} FCFA`,
      expiry: 1800,
      reference,
    };

    const serializedBody = JSON.stringify(invoiceBody);

    // À partir d'ici, un timeout peut laisser un résultat incertain.
    bitnobRequestStarted = true;

    const response = await fetch(
      `${BITNOB_BASE_URL}/api/lightning/invoices`,
      {
        method: "POST",
        headers: getBitnobHeaders(serializedBody),
        body: serializedBody,
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );

    const responseText = await response.text();

    let result: BitnobInvoiceResponse;

    try {
      result = JSON.parse(responseText) as BitnobInvoiceResponse;
    } catch {
      result = { message: responseText };
    }

    if (!response.ok || !result.success || !result.data?.request) {
      console.error("Erreur création facture Bitnob", {
        status: response.status,
        response: result,
        transactionId,
      });

      // Bitnob a renvoyé une réponse d'échec explicite.
      const { error: statusUpdateError } = await supabase
        .from("transactions")
        .update({
          payment_status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", transactionId);

      if (statusUpdateError) {
        console.error("Erreur mise à jour du statut", statusUpdateError);
      }

      return NextResponse.json(
        {
          success: false,
          transactionId,
          error: "Impossible de créer la facture Lightning.",
        },
        { status: 502 },
      );
    }

    if (!result.data.id) {
      // La facture existe peut-être : on conserve pending pour vérification.
      console.error("Facture Bitnob sans identifiant exploitable", {
        transactionId,
        reference,
      });

      return NextResponse.json(
        {
          success: false,
          transactionId,
          error: "Facture créée ou réponse ambiguë. Vérification nécessaire.",
        },
        { status: 502 },
      );
    }

    // 3. Associer la facture Bitnob à la transaction Supabase.
    const { error: invoiceUpdateError } = await supabase
      .from("transactions")
      .update({
        bitnob_invoice_id: result.data.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transactionId);

    if (invoiceUpdateError) {
      console.error("Facture créée mais association Supabase échouée", {
        transactionId,
        invoiceId: result.data.id,
        reference,
        error: invoiceUpdateError,
      });

      return NextResponse.json(
        {
          success: false,
          transactionId,
          error: "Facture créée, mais synchronisation à vérifier.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      transactionId,
      amountXof,
      rateBtcXof: rate,
      amountSats,
      invoiceId: result.data.id,
      paymentRequest: result.data.request,
      status: result.data.status,
      expiresAt: result.data.expires_at,
    });
  } catch (error) {
    console.error("Erreur API invoices", {
      transactionId,
      message: error instanceof Error ? error.message : "Erreur inconnue",
    });

    // Si l'appel Bitnob n'a pas commencé, l'échec est connu.
    // Après son démarrage, on conserve pending jusqu'à vérification,
    // car un timeout ne prouve pas que Bitnob n'a pas créé la facture.
    if (transactionId && !bitnobRequestStarted) {
      const { error: updateError } = await supabase
        .from("transactions")
        .update({
          payment_status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", transactionId);

      if (updateError) {
        console.error("Erreur mise à jour après échec", updateError);
      }
    }

    return NextResponse.json(
      {
        success: false,
        transactionId,
        error: "Erreur lors de la création de la facture.",
      },
      { status: 500 },
    );
  }
}
