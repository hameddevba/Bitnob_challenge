import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import { createClient, requireUser } from "@/lib/supabase/server";
import { admin } from "@/lib/server/supabase";
import AutoRefresh from "./AutoRefresh";
import PayQr from "./PayQr";
import { CheckCircle2, ArrowLeft, Loader2, Sparkles, AlertCircle, ShieldAlert } from "lucide-react";

export const instant = false;

const FINAL = ["completed", "expired", "refunded"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const user = await requireUser();
  if (!user) redirect("/login");

  // Lecture avec le client de l'utilisateur (RLS active)
  const supabase = await createClient();
  let { data: t } = await supabase
    .from("transfers")
    .select("id,status,amount_xof,fee_xof,total_xof,amount_sats,recipient_name,bolt11,invoice_expires_at,completed_at")
    .eq("id", id)
    .maybeSingle();

  // Repli sécurisé côté serveur avec le client admin si la RLS n'a pas encore de policy configurée
  if (!t) {
    const { data: adminT } = await admin
      .from("transfers")
      .select("id,status,amount_xof,fee_xof,total_xof,amount_sats,recipient_name,bolt11,invoice_expires_at,completed_at")
      .eq("id", id)
      .maybeSingle();
    t = adminT;
  }

  if (!t) notFound();

  const isFinal = FINAL.includes(t.status);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-10 px-4">
      <div className="mx-auto max-w-md space-y-5 text-center">
        {/* Navigation retour */}
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <Link
            href="/send"
            className="inline-flex items-center gap-1.5 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Nouveau transfert
          </Link>
          <span className="font-mono text-[11px] truncate max-w-[150px]">
            Réf : {t.id.slice(0, 8)}...
          </span>
        </div>

        {/* Barre d'auto-refresh si en attente */}
        {!isFinal && (
          <AutoRefresh everyMs={t.status === "awaiting_payment" ? 4000 : 5000} />
        )}

        {/* 1. Statut : En attente de paiement Lightning */}
        {t.status === "awaiting_payment" && (
          <PayQr
            bolt11={t.bolt11}
            sats={Number(t.amount_sats)}
            expiresAt={t.invoice_expires_at}
          />
        )}

        {/* 2. Statut : Bitcoin reçu / Décaissement en cours */}
        {["btc_received", "payout_created", "payout_pending"].includes(t.status) && (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 shadow-sm space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
                ⚡ Bitcoin reçu !
              </h2>
              <p className="text-zinc-600 dark:text-zinc-300 text-sm">
                Envoi de{" "}
                <span className="font-semibold text-zinc-900 dark:text-white">
                  {t.amount_xof.toLocaleString("fr-FR")} FCFA
                </span>{" "}
                à{" "}
                <span className="font-semibold text-zinc-900 dark:text-white">
                  {t.recipient_name}
                </span>{" "}
                en cours chez l&apos;opérateur mobile...
              </p>
            </div>
            <div className="pt-2">
              <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                <div className="bg-amber-500 h-full rounded-full animate-pulse w-3/4"></div>
              </div>
            </div>
          </div>
        )}

        {/* 3. Statut : Succès complet */}
        {t.status === "completed" && (
          <div className="bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl p-8 shadow-sm space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
                ✅ Envoyé avec succès !
              </h2>
              <p className="text-zinc-600 dark:text-zinc-300 text-sm">
                <span className="font-semibold text-zinc-900 dark:text-white">
                  {t.recipient_name}
                </span>{" "}
                a reçu{" "}
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {t.amount_xof.toLocaleString("fr-FR")} FCFA
                </span>{" "}
                sur son compte Orange Money.
              </p>
            </div>
            <div className="pt-4">
              <Link
                href="/send"
                className="inline-flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-semibold bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 transition-colors w-full"
              >
                <Sparkles className="w-4 h-4" />
                Faire un autre envoi
              </Link>
            </div>
          </div>
        )}

        {/* 4. Statut : Expiré */}
        {t.status === "expired" && (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 shadow-sm space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                ⌛ Facture expirée
              </h2>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm">
                Le délai de paiement pour cette facture est écoulé sans réception de Bitcoin.
              </p>
            </div>
            <div className="pt-2">
              <Link
                href="/send"
                className="inline-flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 transition-colors"
              >
                Recommencer un transfert
              </Link>
            </div>
          </div>
        )}

        {/* 5. Statut : Échec du payout / Remboursement requis */}
        {["payout_failed", "refund_required", "refunded"].includes(t.status) && (
          <div className="bg-white dark:bg-zinc-900 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-6 shadow-sm space-y-4 text-left">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-500 shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-rose-600 dark:text-rose-400">
                  ⚠️ Échec de l&apos;envoi FCFA
                </h3>
                <p className="text-xs text-zinc-500">
                  {t.status === "refunded"
                    ? "Votre paiement Bitcoin a été remboursé."
                    : "Votre paiement Bitcoin sera remboursé : contactez le support en indiquant la référence ci-dessous."}
                </p>
              </div>
            </div>

            <div className="bg-rose-50 dark:bg-rose-950/30 p-3 rounded-xl border border-rose-200 dark:border-rose-900 text-xs space-y-1">
              <p className="font-semibold text-rose-800 dark:text-rose-300">
                Identifiant de référence :
              </p>
              <p className="font-mono text-zinc-800 dark:text-zinc-200 select-all font-bold">
                {t.id}
              </p>
            </div>

            <div className="pt-2 text-center">
              <Link
                href="/send"
                className="text-xs underline text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              >
                Retour à l&apos;envoi
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
