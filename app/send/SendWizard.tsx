"use client";

import { useState, useTransition } from "react";
import { quoteAction, createTransferAction, type QuoteResult } from "./actions";
import {
  Zap,
  ArrowRight,
  ArrowLeft,
  User,
  Phone,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Coins,
} from "lucide-react";

interface CountryOption {
  code: string;
  name: string;
  flag: string;
  placeholder: string;
  hint: string;
  prefix: string;
  pattern: RegExp;
}

const COUNTRIES: CountryOption[] = [
  {
    code: "SN",
    name: "Sénégal",
    flag: "🇸🇳",
    placeholder: "77 123 45 67",
    hint: "9 chiffres commençant par 77, 78, 76, 70 ou 75",
    prefix: "+221",
    pattern: /^(77|78|76|70|75)\d{7}$/,
  },
  {
    code: "CI",
    name: "Côte d'Ivoire",
    flag: "🇨🇮",
    placeholder: "07 12 34 56 78",
    hint: "10 chiffres commençant par 07, 05 ou 01",
    prefix: "+225",
    pattern: /^(07|05|01)\d{8}$/,
  },
  {
    code: "ML",
    name: "Mali",
    flag: "🇲🇱",
    placeholder: "70 12 34 56",
    hint: "8 chiffres commençant par 7, 8 ou 9",
    prefix: "+223",
    pattern: /^(7|8|9)\d{7}$/,
  },
  {
    code: "BF",
    name: "Burkina Faso",
    flag: "🇧🇫",
    placeholder: "70 12 34 56",
    hint: "8 chiffres commençant par 07, 57, 67 ou 77",
    prefix: "+226",
    pattern: /^(07|57|67|77)\d{6}$/,
  },
];

const QUICK_AMOUNTS = [1000, 2500, 5000, 10000];

type Quote = Extract<QuoteResult, { ok: true }>["quote"];

export default function SendWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form State
  const [amount, setAmount] = useState<string>("5000");
  const [name, setName] = useState<string>("");
  const [country, setCountry] = useState<string>("SN");
  const [phone, setPhone] = useState<string>("");

  // Quote State
  const [quote, setQuote] = useState<Quote | null>(null);

  // Status & Error
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedCountry = COUNTRIES.find((c) => c.code === country) || COUNTRIES[0];

  // 1. Obtenir un devis (Étape 1)
  const handleGetQuote = () => {
    setErrorMsg(null);
    const num = Number(amount);
    if (!num || num <= 0 || !Number.isInteger(num)) {
      setErrorMsg("Veuillez saisir un montant entier valide en FCFA.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await quoteAction(num);
        if (!res.ok) {
          setErrorMsg(res.error);
          setQuote(null);
        } else {
          setQuote(res.quote);
          setStep(2);
        }
      } catch (e) {
        setErrorMsg((e as Error).message || "Erreur lors de la demande de devis.");
      }
    });
  };

  // Vérifier et passer à l'étape 3
  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      setErrorMsg("Le nom du destinataire doit comporter entre 2 et 80 caractères.");
      return;
    }

    const cleanPhone = phone.replace(/\D/g, "");
    if (!selectedCountry.pattern.test(cleanPhone)) {
      setErrorMsg(
        `Numéro Orange Money invalide pour ${selectedCountry.name}. Format attendu : ${selectedCountry.hint}.`
      );
      return;
    }

    setStep(3);
  };

  // 3. Finaliser le transfert (Étape 3)
  const handleConfirmTransfer = () => {
    if (!quote) return;
    setErrorMsg(null);

    startTransition(async () => {
      try {
        const res = await createTransferAction({
          quoteId: quote.quote_id,
          name: name.trim(),
          country: selectedCountry.code,
          phone: phone.replace(/\D/g, ""),
        });

        if (res && !res.ok) {
          setErrorMsg(res.error);
        }
      } catch (e) {
        if ((e as Error)?.message?.includes("NEXT_REDIRECT")) {
          throw e;
        }
        setErrorMsg((e as Error)?.message || "Impossible de créer le transfert.");
      }
    });
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Stepper Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 w-full bg-zinc-200 dark:bg-zinc-800 -z-10" />

          {/* Étape 1 */}
          <div className="flex flex-col items-center gap-1.5 bg-zinc-50 dark:bg-zinc-950 px-2">
            <button
              onClick={() => setStep(1)}
              type="button"
              className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                step === 1
                  ? "bg-amber-500 text-white ring-4 ring-amber-500/20 shadow"
                  : step > 1
                  ? "bg-emerald-500 text-white"
                  : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600"
              }`}
            >
              {step > 1 ? <CheckCircle2 className="w-5 h-5" /> : "1"}
            </button>
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Montant
            </span>
          </div>

          {/* Étape 2 */}
          <div className="flex flex-col items-center gap-1.5 bg-zinc-50 dark:bg-zinc-950 px-2">
            <button
              onClick={() => quote && setStep(2)}
              disabled={!quote}
              type="button"
              className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                step === 2
                  ? "bg-amber-500 text-white ring-4 ring-amber-500/20 shadow"
                  : step > 2
                  ? "bg-emerald-500 text-white"
                  : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600"
              }`}
            >
              {step > 2 ? <CheckCircle2 className="w-5 h-5" /> : "2"}
            </button>
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Destinataire
            </span>
          </div>

          {/* Étape 3 */}
          <div className="flex flex-col items-center gap-1.5 bg-zinc-50 dark:bg-zinc-950 px-2">
            <button
              disabled={step < 3}
              type="button"
              className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                step === 3
                  ? "bg-amber-500 text-white ring-4 ring-amber-500/20 shadow"
                  : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600"
              }`}
            >
              3
            </button>
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Paiement
            </span>
          </div>
        </div>
      </div>

      {/* Alerte d'erreur */}
      {errorMsg && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-start gap-3 text-rose-700 dark:text-rose-300 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-500 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Attention</p>
            <p className="text-xs mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ÉTAPE 1 : MONTANT                                                     */}
      {/* ===================================================================== */}
      {step === 1 && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <Coins className="w-5 h-5 text-amber-500" />
              Montant à envoyer
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Montant en Francs CFA qui sera déboursé vers le compte Orange Money.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Montant en FCFA
            </label>
            <div className="relative">
              <input
                type="number"
                min="500"
                step="100"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setQuote(null);
                }}
                placeholder="Ex : 5000"
                className="w-full text-2xl font-bold rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 py-3.5 px-4 pr-16 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-semibold text-zinc-400 text-sm">
                FCFA
              </span>
            </div>

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setAmount(String(q));
                    setQuote(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    amount === String(q)
                      ? "bg-amber-500 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200"
                  }`}
                >
                  {q.toLocaleString("fr-FR")} F
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleGetQuote}
            disabled={pending || !amount}
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-semibold bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-white transition-all shadow disabled:opacity-50"
          >
            {pending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Calcul du devis...
              </>
            ) : (
              <>
                Continuer
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ÉTAPE 2 : DESTINATAIRE                                                */}
      {/* ===================================================================== */}
      {step === 2 && quote && (
        <form
          onSubmit={handleProceedToReview}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6"
        >
          {/* Résumé du devis */}
          <SummaryCard quote={quote} onRefresh={handleGetQuote} pending={pending} />

          <div className="space-y-1 pt-2">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <User className="w-5 h-5 text-amber-500" />
              Bénéficiaire Orange Money
            </h2>
          </div>

          {/* Sélection du pays */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Pays de destination
            </label>
            <div className="grid grid-cols-2 gap-2">
              {COUNTRIES.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setCountry(c.code)}
                  className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                    country === c.code
                      ? "border-amber-500 bg-amber-500/5 font-semibold text-zinc-900 dark:text-white ring-1 ring-amber-500"
                      : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  <span className="text-xl">{c.flag}</span>
                  <div className="text-xs leading-tight">
                    <div>{c.name}</div>
                    <span className="text-[10px] text-zinc-400">{c.prefix}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Nom */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-zinc-400" />
              Nom complet du destinataire
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex : Aminata Diallo"
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-3.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>

          {/* Téléphone */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-zinc-400" />
              Numéro Orange Money (sans indicatif)
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-zinc-500 font-semibold text-sm">
                <span>{selectedCountry.flag}</span>
                <span>{selectedCountry.prefix}</span>
              </div>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={selectedCountry.placeholder}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-3.5 pl-24 text-sm font-mono text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>
            <p className="text-[11px] text-zinc-400">
              💡 {selectedCountry.hint}
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 px-4 rounded-xl font-medium border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Modifier montant
            </button>
            <button
              type="submit"
              disabled={!name || !phone}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 px-4 rounded-xl font-semibold bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-sm transition-colors shadow disabled:opacity-50"
            >
              Vérifier
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}

      {/* ===================================================================== */}
      {/* ÉTAPE 3 : CONFIRMATION & PAIEMENT                                    */}
      {/* ===================================================================== */}
      {step === 3 && quote && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500 fill-amber-500" />
              Récapitulatif avant paiement
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Vérifiez attentivement les informations du bénéficiaire.
            </p>
          </div>

          {/* Résumé du bénéficiaire */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 text-sm overflow-hidden">
            <div className="p-3.5 bg-zinc-50 dark:bg-zinc-800/40 flex items-center justify-between">
              <span className="text-xs text-zinc-500">Destinataire</span>
              <div className="text-right">
                <div className="font-semibold text-zinc-900 dark:text-white">{name}</div>
                <div className="text-xs text-zinc-500 font-mono">
                  {selectedCountry.flag} {selectedCountry.prefix} {phone.replace(/\D/g, "")}
                </div>
              </div>
            </div>

            <div className="p-3.5 flex items-center justify-between">
              <span className="text-xs text-zinc-500">Mode de réception</span>
              <span className="font-semibold text-orange-600 dark:text-orange-400 text-xs">
                Orange Money ({selectedCountry.name})
              </span>
            </div>

            <div className="p-3.5 flex items-center justify-between">
              <span className="text-xs text-zinc-500">Montant reçu</span>
              <span className="font-bold text-zinc-900 dark:text-white">
                {quote.amount_xof.toLocaleString("fr-FR")} FCFA
              </span>
            </div>

            <div className="p-3.5 flex items-center justify-between text-xs">
              <span className="text-zinc-500">Frais de service inclus</span>
              <span className="text-zinc-600 dark:text-zinc-300">
                {quote.fee_xof.toLocaleString("fr-FR")} FCFA
              </span>
            </div>

            <div className="p-4 bg-amber-500/10 flex items-center justify-between">
              <div>
                <span className="font-bold text-zinc-900 dark:text-white block text-sm">
                  Total à payer en Lightning
                </span>
                <span className="text-[11px] text-zinc-500">
                  Taux garanti pendant 10 minutes
                </span>
              </div>
              <div className="text-right">
                <span className="text-xl font-extrabold text-amber-600 dark:text-amber-400 block font-mono">
                  {quote.amount_sats.toLocaleString("fr-FR")} sats
                </span>
                <span className="text-xs text-zinc-500">
                  ≈ {quote.amount_btc} BTC
                </span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 text-[11px] text-zinc-500">
            ⚠️ Vérifiez bien le numéro : un envoi Orange Money vers un mauvais compte ne peut pas être annulé après réception du Bitcoin.
          </div>

          <div className="space-y-3">
            <button
              onClick={handleConfirmTransfer}
              disabled={pending}
              type="button"
              className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-xl font-bold bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-white transition-all shadow-md disabled:opacity-50 text-base"
            >
              {pending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Génération de la facture Lightning...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5 fill-current" />
                  Valider et payer en Bitcoin
                </>
              )}
            </button>

            <button
              type="button"
              disabled={pending}
              onClick={() => setStep(2)}
              className="w-full py-2.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              Modifier les informations
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  quote,
  onRefresh,
  pending,
}: {
  quote: Quote;
  onRefresh: () => void;
  pending: boolean;
}) {
  return (
    <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2 text-xs">
      <div className="flex items-center justify-between text-zinc-500 border-b border-amber-500/10 pb-1.5">
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
          Devis verrouillé
        </span>
        <button
          onClick={onRefresh}
          type="button"
          disabled={pending}
          className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline"
        >
          <RefreshCw className={`w-3 h-3 ${pending ? "animate-spin" : ""}`} />
          Recalculer
        </button>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-500">Montant :</span>
        <span className="font-semibold">{quote.amount_xof.toLocaleString("fr-FR")} FCFA</span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-500">Frais :</span>
        <span>{quote.fee_xof.toLocaleString("fr-FR")} FCFA</span>
      </div>
      <div className="flex justify-between font-bold text-amber-600 dark:text-amber-400 pt-1 border-t border-amber-500/10">
        <span>Total :</span>
        <span>{quote.amount_sats.toLocaleString("fr-FR")} sats ({quote.amount_btc} BTC)</span>
      </div>
    </div>
  );
}
