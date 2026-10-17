import type { ReactNode } from "react";
import { getBitnobEnvironment } from "@/lib/environment";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Yónne · FCFA via Bitcoin",
  description: "Envoyer des FCFA vers Orange Money avec Bitcoin Lightning",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f3ee" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const env = await getBitnobEnvironment();
  const live = env === "production" || env === "live";
  return (
    <html lang="fr">
      <body>
        <div className="shell">
          <header className="brand">
            <div className="brand-mark">₿</div>
            <div className="brand-name">Yónne</div>
            <div className="brand-tag">Bitcoin → Mobile Money</div>
          </header>
          {children}
          <p className="foot">
            Paiement via Lightning · Envoi par Bitnob ·{" "}
            <span className={live ? "env live" : "env"}>{live ? "Production · argent réel" : `Mode ${env}`}</span>
          </p>
        </div>
      </body>
    </html>
  );
}
