"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, ExternalLink, Zap, Clock, Smartphone } from "lucide-react";

interface PayQrProps {
  bolt11?: string | null;
  sats: number;
  expiresAt: string;
}

export default function PayQr({ bolt11, sats, expiresAt }: PayQrProps) {
  const [copied, setCopied] = useState(false);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  // Compte à rebours avant expiration
  useEffect(() => {
    const target = new Date(expiresAt).getTime();

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((target - now) / 1000));
      setTimeLeft(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleOpenWallet = async () => {
    if (!bolt11) return;

    // 1. Toujours copier automatiquement la facture dans le presse-papier
    await copyToClipboard(bolt11);

    // 2. Tenter le support WebLN (si une extension comme Alby est installée)
    const win = window as unknown as { webln?: { enable: () => Promise<void>; sendPayment: (inv: string) => Promise<unknown> } };
    if (win.webln) {
      try {
        await win.webln.enable();
        await win.webln.sendPayment(bolt11);
        return;
      } catch {
        // Poursuivre vers le lien de protocole standard
      }
    }

    // 3. Tenter d'ouvrir l'URI de protocole lightning:
    try {
      window.location.href = `lightning:${bolt11}`;
    } catch {
      // Ignoré
    }

    // 4. Afficher une notice d'aide claire pour les utilisateurs sur ordinateur
    setWalletNotice(
      "Facture copiée ! Si votre navigateur n'a pas d'application Lightning configurée, scannez le QR code avec votre téléphone ou collez la facture dans votre portefeuille."
    );
    setTimeout(() => setWalletNotice(null), 8000);
  };

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isExpired = timeLeft <= 0;

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6">
      {/* En-tête montant */}
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold text-xs uppercase tracking-wider">
          <Zap className="w-3.5 h-3.5 fill-current" />
          Paiement Lightning
        </div>
        <div className="text-3xl font-extrabold text-zinc-900 dark:text-white">
          {sats.toLocaleString("fr-FR")}{" "}
          <span className="text-xl font-normal text-zinc-500">sats</span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          ≈ {(sats / 1e8).toFixed(8)} BTC
        </p>
      </div>

      {/* QR Code Container avec QRCodeSVG */}
      <div className="flex flex-col items-center justify-center">
        <div className="p-4 bg-white rounded-2xl shadow-inner border border-zinc-200">
          {bolt11 ? (
            <QRCodeSVG
              value={`lightning:${bolt11}`}
              size={240}
              level="M"
              includeMargin={false}
            />
          ) : (
            <div className="w-60 h-60 flex items-center justify-center text-zinc-400 text-sm">
              En attente de la facture...
            </div>
          )}
        </div>

        {/* Compteur d'expiration */}
        <div className="mt-3 flex items-center gap-1.5 text-xs font-medium">
          <Clock className={`w-3.5 h-3.5 ${isExpired ? "text-rose-500" : "text-zinc-500"}`} />
          {isExpired ? (
            <span className="text-rose-500 font-semibold">Facture expirée</span>
          ) : (
            <span className="text-zinc-600 dark:text-zinc-300">
              Expire dans :{" "}
              <span className="font-mono font-bold text-zinc-900 dark:text-white">
                {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Notice d'aide lors du clic */}
      {walletNotice && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-300 text-left flex items-start gap-2">
          <Smartphone className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <p>{walletNotice}</p>
        </div>
      )}

      {/* Actions */}
      {bolt11 && (
        <div className="space-y-3">
          <button
            onClick={handleOpenWallet}
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-semibold bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-white transition-colors shadow-sm text-sm"
          >
            <Zap className="w-4 h-4 fill-current" />
            Ouvrir dans mon portefeuille Lightning
            <ExternalLink className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              onClick={() => copyToClipboard(bolt11)}
              type="button"
              className="w-full flex items-center justify-between gap-2 p-3 text-left rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-xs font-mono"
            >
              <span className="truncate text-zinc-600 dark:text-zinc-300 select-all max-w-[280px]">
                {bolt11}
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 font-sans font-medium text-amber-600 dark:text-amber-400">
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400">Copié !</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copier la facture</span>
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Guide portefeuilles recommandés */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4 text-left space-y-1">
        <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5 text-amber-500" />
          Comment payer :
        </p>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          • <strong>Sur mobile</strong> : Cliquez sur le bouton ou collez la facture dans votre portefeuille (Phoenix, Blink, Strike, Wallet of Satoshi, Zeus).<br />
          • <strong>Sur ordinateur</strong> : Scannez directement le code QR affiché avec la caméra de votre application mobile Lightning.
        </p>
      </div>
    </div>
  );
}
