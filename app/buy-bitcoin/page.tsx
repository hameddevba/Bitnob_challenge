
"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "../page.module.css";

type CheckoutResponse = {
  success?: boolean;
  error?: string;
  checkoutUrl?: string;
  wave_launch_url?: string;
  amountSats?: number;
  rateBtcXof?: number;
};

type RateResponse = {
  success?: boolean;
  rateBtcXof?: number;
  error?: string;
};

export default function BuyBitcoinPage() {
  const [amountXof, setAmountXof] = useState("5000");
  const [bitcoinAddress, setBitcoinAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const amount = Number(amountXof);

  const [rateBtcXof, setRateBtcXof] = useState<number | null>(null);
const [rateLoading, setRateLoading] = useState(true);
const [rateError, setRateError] = useState(false);

useEffect(() => {
  let active = true;

  async function loadRate() {
    try {
      const response = await fetch("/api/btc-rate", {
        cache: "no-store",
      });

      const data = (await response.json()) as RateResponse;

      if (!response.ok || !data.success ||
          typeof data.rateBtcXof !== "number" ||
          !Number.isFinite(data.rateBtcXof) ||
          data.rateBtcXof <= 0) {
        throw new Error("Taux indisponible");
      }

      if (active) {
        setRateBtcXof(data.rateBtcXof);
        setRateError(false);
      }
    } catch {
      if (active) {
        setRateError(true);
      }
    } finally {
      if (active) {
        setRateLoading(false);
      }
    }
  }

  void loadRate();

  return () => {
    active = false;
  };
}, []);

const validAmount = Number.isSafeInteger(amount) && amount >= 100;

const estimatedSats =
  validAmount && rateBtcXof !== null
    ? Math.floor((amount / rateBtcXof) * 100_000_000)
    : null;

const formatSats = (sats: number) =>
  new Intl.NumberFormat("fr-FR").format(sats);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!Number.isSafeInteger(amount) || amount < 100) {
      setError("Le montant minimum est de 100 FCFA.");
      return;
    }

    const address = bitcoinAddress.trim();

    // Validation de format uniquement : la validation complète
    // de l'adresse sera également faite côté serveur.
    const validAddress =
      /^(bc1[a-z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(
        address,
      );

    if (!validAddress) {
      setError("Saisis une adresse Bitcoin valide.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/wave/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amountXof: amount,
          bitcoinAddress: address,
          paymentMethod: "wave",
        }),
      });

      const data = (await response.json()) as CheckoutResponse;

      if (!response.ok || data.success === false) {
        throw new Error(
          data.error || "Impossible de créer le paiement Wave.",
        );
      }

      const checkoutUrl = data.checkoutUrl || data.wave_launch_url;

      if (!checkoutUrl) {
        throw new Error(
          "Le serveur n'a pas renvoyé de lien de paiement Wave.",
        );
      }

      // N'autoriser que le domaine officiel du checkout Wave.
      const url = new URL(checkoutUrl);

      if (
        url.protocol !== "https:" ||
        !["pay.wave.com", "checkout.wave.com"].includes(url.hostname)
        ) {
        throw new Error("URL de paiement Wave non reconnue.");
      }

      window.location.assign(url.toString());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur inattendue est survenue.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/">
          <span className={styles.brandIcon}>₿</span>
          <span>SatsCollect</span>
        </a>

        <span className={styles.environment}>
          <span className={styles.dot} />
          Achat de Bitcoin
        </span>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>WAVE → BITCOIN</p>
        <h1>Achetez du Bitcoin avec Wave.</h1>
        <p className={styles.subtitle}>
          Payez en francs CFA et recevez vos bitcoins
          directement à votre adresse Bitcoin.
        </p>
      </section>

      <section className={styles.grid}>
        <div className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.step}>ACHAT</p>
              <h2>Votre commande</h2>
            </div>
            <span className={styles.icon}>₿</span>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <label htmlFor="amountXof">Montant à payer</label>

            <div className={styles.amountField}>
              <input
                id="amountXof"
                type="number"
                min="100"
                step="1"
                required
                value={amountXof}
                onChange={(event) => setAmountXof(event.target.value)}
                placeholder="5000"
              />
              <span>FCFA</span>
            </div>

            <p className={styles.hint}>Montant minimum : 100 FCFA.</p>

            <div className={styles.conversion} aria-live="polite">
                <span>Bitcoin estimé</span>

                <strong>
                    {rateLoading
                    ? "Récupération du taux…"
                    : rateError
                        ? "Estimation indisponible"
                        : estimatedSats !== null && estimatedSats > 0
                        ? `≈ ${formatSats(estimatedSats)} sats`
                        : "Saisis au moins 100 FCFA"}
                </strong>

                {rateBtcXof !== null && !rateError && (
                    <span>
                    Taux indicatif : 1 BTC ={" "}
                    {new Intl.NumberFormat("fr-FR", {
                        maximumFractionDigits: 0,
                    }).format(rateBtcXof)}{" "}
                    FCFA
                    </span>
                )}

                <span>
                    Montant indicatif, susceptible de varier avant validation du paiement.
                </span>
                </div>

            <label htmlFor="bitcoinAddress">
              Adresse Bitcoin de réception
            </label>

            <input
              id="bitcoinAddress"
              type="text"
              autoComplete="off"
              spellCheck={false}
              required
              value={bitcoinAddress}
              onChange={(event) =>
                setBitcoinAddress(event.target.value)
              }
              placeholder="bc1q..."
            />

            <p className={styles.hint}>
              Vérifie soigneusement l'adresse avant de continuer.
              Une transaction Bitcoin confirmée est généralement
              irréversible.
            </p>

            <label>Moyen de paiement</label>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: 16,
                border: "1px solid #d9e0e8",
                borderRadius: 12,
              }}
            >
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: "#159B75",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                W
              </span>

              <div style={{ flex: 1 }}>
                <strong>Wave</strong>
                <p className={styles.hint}>
                  Paiement par checkout Wave
                </p>
              </div>

              <span aria-label="Sélectionné">✓</span>
            </div>

            {error && (
              <div className={styles.error} role="alert">
                <strong>Paiement non démarré</strong>
                <p>{error}</p>
              </div>
            )}

            <button
              className={styles.primaryButton}
              type="submit"
              disabled={loading}
            >
              {loading
                ? "Préparation du paiement…"
                : "Continuer avec Wave"}
              {!loading && <span>→</span>}
            </button>

            <p className={styles.disclaimer}>
              Le retrait Bitcoin sera déclenché uniquement après
              vérification du paiement Wave par notre serveur.
            </p>
          </form>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>SatsCollect · Achat de Bitcoin</span>
        <a href="/">Retour à l'accueil</a>
      </footer>
    </main>
  );
}
