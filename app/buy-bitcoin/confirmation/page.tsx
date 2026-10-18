
"use client";

import { useEffect, useState } from "react";

type PaymentInfo = {
  clientReference?: string;
  amountXof?: number;
  paymentStatus?: string;
  payoutStatus?: string;
  error?: string;
};

export default function BitcoinConfirmationPage() {
  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("client_reference");

    if (!reference) {
      setInfo({ error: "Référence de commande absente." });
      setLoading(false);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const checkPayment = async () => {
      try {
        const response = await fetch(
          `/api/wave/status?client_reference=${encodeURIComponent(reference)}`,
          { cache: "no-store" },
        );

        const data: PaymentInfo = await response.json();

        if (!active) return;

        setInfo(data);
        setLoading(false);

        if (
          !response.ok ||
          data.paymentStatus === "paid" ||
          data.paymentStatus === "cancelled" ||
          data.paymentStatus === "failed"
        ) {
          if (timer) clearInterval(timer);
        }
      } catch {
        if (active) {
          setInfo({
            error: "Vérification impossible. Réessaie dans un instant.",
          });
          setLoading(false);
        }
      }
    };

    void checkPayment();
    timer = setInterval(() => void checkPayment(), 5000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-2xl border p-8 text-center">
        <h1 className="text-2xl font-bold mb-4">
          Confirmation de ton achat Bitcoin
        </h1>

        {loading && <p>Vérification du paiement Wave…</p>}

        {!loading && info?.error && (
          <p role="alert">{info.error}</p>
        )}

        {info?.paymentStatus === "paid" && (
          <>
            <p className="text-lg font-semibold">
              Paiement Wave confirmé
            </p>
            <p className="mt-3">
              Montant payé : {info.amountXof} FCFA
            </p>
            <p className="mt-3">
              Paiement confirmé. Le transfert Bitcoin reste à traiter.
            </p>
          </>
        )}

        {info?.paymentStatus === "pending" && (
          <p>
            Paiement en attente de confirmation par Wave. Cette page
            se met à jour automatiquement.
          </p>
        )}

        {info?.paymentStatus === "cancelled" && (
          <p>Le paiement Wave a été annulé.</p>
        )}

        {info?.paymentStatus === "failed" && (
          <p>Le paiement Wave a échoué.</p>
        )}

        {info?.clientReference && (
          <p className="mt-6 text-sm break-all opacity-70">
            Référence : {info.clientReference}
          </p>
        )}
      </section>
    </main>
  );
}

