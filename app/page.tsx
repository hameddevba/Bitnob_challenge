
"use client";
import styles from "./page.module.css";
import { useState } from "react";

import { QRCodeSVG } from "qrcode.react";

type InvoiceResult = {
  [key: string]: unknown;
};

export default function Home() {
  const [amountXof, setAmountXof] = useState("1000");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [receiverCurrency, setReceiverCurrency] = useState("XOF");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InvoiceResult | null>(null);
  const [copied, setCopied] = useState(false);

  const amountSats = Number(result?.amountSats);

  const [simulationLoading, setSimulationLoading] = useState(false);
  const [simulationResult, setSimulationResult] = useState<unknown>(null);
  const [simulationError, setSimulationError] = useState("");

  const [waveLoading, setWaveLoading] = useState(false);
  const [waveResult, setWaveResult] = useState<{
  httpStatus: number;
  apiHttpStatus?: number;
  ok: boolean;
  rawBody: string;
  data?: unknown;
} | null>(null);
const [waveError, setWaveError] = useState("");

  async function createInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setResult(null);
    setCopied(false);

    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amountXof: Number(amountXof),
          receiverPhone: receiverPhone.trim(),
          receiverCurrency,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Impossible de créer la facture.",
        );
      }

      setResult(data);
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

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copie impossible. Sélectionne le texte manuellement.");
    }
  }


  async function simulatePayment() {
  const transactionId = result?.transactionId;

  if (typeof transactionId !== "string") {
    setSimulationError("Identifiant de transaction introuvable.");
    return;
  }

  setSimulationLoading(true);
  setSimulationError("");
  setSimulationResult(null);
  setWaveResult(null);
  setWaveError("");

  try {
    const response = await fetch("/api/test/simulate-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId }),
    });

    const data = await response.json();
    setSimulationResult({
      httpStatus: response.status,
      ...data,
    });

    if (!response.ok || data.success !== true) {
      setSimulationError(
        typeof data.error === "string"
          ? data.error
          : "La simulation a échoué.",
      );
    }
  } catch (err) {
    setSimulationError(
      err instanceof Error ? err.message : "Erreur de simulation.",
    );
  } finally {
    setSimulationLoading(false);
  }
}

async function testWavePayout() {
  const transactionId = result?.transactionId;

  if (typeof transactionId !== "string") {
    setWaveError("Identifiant de transaction introuvable.");
    return;
  }

  setWaveLoading(true);
  setWaveError("");
  setWaveResult(null);

  try {
    const response = await fetch("/api/payouts/wave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId }),
    });

    const rawBody = await response.text();

    let data: unknown = rawBody;
    try {
      data = JSON.parse(rawBody);
    } catch {
      // On garde la réponse brute si elle n'est pas au format JSON.
    }

    const details =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : {};

    const apiHttpStatus =
      typeof details.waveHttpStatus === "number"
        ? details.waveHttpStatus
        : undefined;

    const waveRawBody =
      typeof details.waveRawBody === "string"
        ? details.waveRawBody
        : rawBody;

    setWaveResult({
      httpStatus: response.status,
      apiHttpStatus,
      ok:
        response.ok &&
        (typeof details.success === "boolean"
          ? details.success
          : false),
      rawBody: waveRawBody,
      data,
    });

    if (!response.ok || details.success !== true) {
      setWaveError(
        typeof details.error === "string"
          ? details.error
          : "Le test Wave a échoué. Consulte la réponse ci-dessous.",
      );
    }
  } catch (err) {
    setWaveError(
      err instanceof Error ? err.message : "Erreur lors de l'appel Wave.",
    );
  } finally {
    setWaveLoading(false);
  }
}

  

const paymentRequest =
  typeof result?.paymentRequest === "string"
    ? result.paymentRequest.trim()
    : "";

const invoiceValue = /^(lnbc|lntb|lnbcrt)/i.test(paymentRequest)
  ? paymentRequest
  : undefined;



  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/">
          <span className={styles.brandIcon}>₿</span>
          <span>Lightning Bridge</span>
        </a>
        <span className={styles.environment}>
          <span className={styles.dot} />
          Environnement de test
        </span>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>CODE & CHAIN DAKAR 2026</p>
        <h1>Du Lightning au mobile money.</h1>
        <p className={styles.subtitle}>
          Crée une facture Lightning, suis son résultat et prépare
          le versement au bénéficiaire.
        </p>
      </section>

      <section className={styles.grid}>
        <div className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.step}>ÉTAPE 01</p>
              <h2>Créer une facture</h2>
            </div>
            <span className={styles.icon}>↗</span>
          </div>

          <form onSubmit={createInvoice} className={styles.form}>
            <label htmlFor="amount">Montant à recevoir</label>
            <div className={styles.amountField}>
              <input
                id="amount"
                type="number"
                min="100"
                step="1"
                required
                value={amountXof}
                onChange={(e) => setAmountXof(e.target.value)}
                placeholder="1000"
              />
              <span>FCFA</span>
            </div>
            <p className={styles.hint}>Minimum : 100 FCFA</p>

              <div className={styles.conversion}>
                <span>Conversion estimée</span>
                <strong>
                  {amountXof && Number(amountXof) > 0
                    ? `${Math.round(
                        (Number(amountXof) / Number(result?.rateBtcXof || 1)) *
                          100_000_000,
                      ).toLocaleString("fr-FR")} sats`
                    : "— sats"}
                </strong>
              </div>

            <label htmlFor="phone">Téléphone du bénéficiaire</label>
            <input
              id="phone"
              type="tel"
              required
              value={receiverPhone}
              onChange={(e) => setReceiverPhone(e.target.value)}
              placeholder="221XXXXXXXXX ou 241XXXXXXXXX"
            />
            <p className={styles.hint}>
              Saisis le numéro au format attendu par ton API.
            </p>

            <label htmlFor="currency">Devise du bénéficiaire</label>
            <select
              id="currency"
              value={receiverCurrency}
              onChange={(e) => setReceiverCurrency(e.target.value)}
            >
              <option value="XOF">XOF — Franc CFA (Sénégal)</option>
              <option value="XAF">XAF — Franc CFA (Gabon)</option>
            </select>

            {error && (
              <div className={styles.error} role="alert">
                <strong>Erreur</strong>
                <p>{error}</p>
              </div>
            )}

            <button
              className={styles.primaryButton}
              type="submit"
              disabled={loading}
            >
              {loading ? "Création en cours…" : "Créer la facture Lightning"}
              {!loading && <span>→</span>}
            </button>

            <p className={styles.disclaimer}>
              Cette action appelle ton API. Elle ne déclenche pas de retrait
              Wave.
            </p>
          </form>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.step}>ÉTAPE 02</p>
              <h2>Résultat de la demande</h2>
            </div>
            <span className={styles.icon}>⌁</span>
          </div>

          {!result && !loading && (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>ϟ</div>
              <h3>En attente d’une facture</h3>
              <p>
                Remplis le formulaire et lance une demande. La réponse de ton
                serveur s’affichera ici.
              </p>
            </div>
          )}

          {loading && (
            <div className={styles.empty}>
              <div className={styles.spinner} />
              <h3>Communication avec le serveur…</h3>
              <p>Création de la transaction et demande de facture.</p>
            </div>
          )}

          {result && (
            <div className={styles.result}>
              <div className={styles.successBanner}>
                <span>✓</span>
                <div>
                  <strong>Réponse reçue</strong>
                  <p>La demande a abouti. Vérifie les détails ci-dessous.</p>
                </div>
              </div>

              
{invoiceValue && (
  <div className={styles.invoiceBox}>
    <div className={styles.invoiceTitle}>
      <strong>Scanne ta facture Lightning</strong>
      <button
        type="button"
        className={styles.copyButton}
        onClick={() => copyValue(invoiceValue)}
      >
        {copied ? "Copié ✓" : "Copier la facture"}
      </button>
    </div>

    <div className={styles.qrContainer}>
      <QRCodeSVG
        value={invoiceValue}
        size={220}
        level="M"
        includeMargin
      />
    </div>

    <p className={styles.qrHint}>
      Ouvre ton portefeuille Lightning sur ton téléphone,
      scanne ce QR code et vérifie les détails avant de payer.
    </p>

    <details className={styles.invoiceDetails}>
      <summary>Afficher le code de la facture</summary>
      <textarea
        readOnly
        value={invoiceValue}
        rows={4}
        aria-label="Facture Lightning"
      />
    </details>
  </div>
)}


              <h3 className={styles.responseTitle}>Réponse complète de l’API</h3>
              <pre className={styles.json}>
                {JSON.stringify(result, null, 2)}
              </pre>

              <div className={styles.testActions}>
  <h3>Tests du parcours</h3>

  <button
    type="button"
    className={styles.secondaryButton}
    onClick={simulatePayment}
    disabled={simulationLoading || waveLoading}
  >
    {simulationLoading
      ? "Simulation en cours…"
      : "⚡ Simuler le paiement Lightning"}
  </button>

  <p className={styles.hint}>
    Test fictif : aucune transaction Bitcoin réelle n'est effectuée.
  </p>

  {simulationError && (
    <div className={styles.error} role="alert">
      <strong>Erreur de simulation</strong>
      <p>{simulationError}</p>
    </div>
  )}

  {simulationResult !== null && (
    <>
      <h3 className={styles.responseTitle}>
        Résultat de la simulation
      </h3>
      <pre className={styles.json}>
        {JSON.stringify(simulationResult, null, 2)}
      </pre>
    </>
  )}

  <button
    type="button"
    className={styles.primaryButton}
    onClick={testWavePayout}
    disabled={
      waveLoading ||
      simulationLoading ||
      simulationResult === null ||
      Boolean(simulationError)
    }
  >
    {waveLoading
      ? "Appel de Wave en cours…"
      : "Tester le versement Wave (sandbox)"}
  </button>

  <p className={styles.hint}>
    Cet appel contacte l'API Wave configurée sur le serveur.
    Vérifie que ta clé est bien une clé sandbox avant de continuer.
  </p>

  {waveError && (
    <div className={styles.error} role="alert">
      <strong>Résultat Wave à vérifier</strong>
      <p>{waveError}</p>
    </div>
  )}

  {waveResult !== null && (
    <>
      <h3 className={styles.responseTitle}>
        Réponse brute de l’API Wave
      </h3>

      <p className={styles.hint}>
        HTTP de notre serveur : {waveResult.httpStatus}
        {waveResult.apiHttpStatus !== undefined
          ? ` · HTTP Wave : ${waveResult.apiHttpStatus}`
          : ""}
      </p>

      <pre className={styles.json}>{waveResult.rawBody}</pre>

      <details>
        <summary>Afficher la réponse complète de notre serveur</summary>
        <pre className={styles.json}>
          {JSON.stringify(waveResult.data, null, 2)}
        </pre>
      </details>
    </>
  )}
</div>

              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setResult(null);
                  setError("");
                  setCopied(false);
                }}
              >
                Nouvelle demande
              </button>
            </div>
          )}
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Lightning Bridge · Prototype hackathon</span>
        <span>Bitnob · Supabase · Next.js</span>
      </footer>
    </main>
  );
}
