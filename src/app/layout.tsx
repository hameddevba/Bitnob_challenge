import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Yónne · FCFA via Bitcoin",
  description: "Envoyer des FCFA vers Orange Money avec Bitcoin Lightning",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f3ee" };

export default function RootLayout({ children }: { children: ReactNode }) {
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
          <p className="foot">Paiement via Lightning · Envoi par Bitnob · Sandbox</p>
        </div>
      </body>
    </html>
  );
}
