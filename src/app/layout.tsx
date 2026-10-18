import type { ReactNode } from "react";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { getBitnobEnvironment } from "@/lib/environment";
import "./globals.css";

export const dynamic = "force-dynamic";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"] });
const text = Instrument_Sans({ subsets: ["latin"], variable: "--font-text" });

export const metadata = {
  title: "Yónne",
  description: "Envoyez des FCFA sur Orange Money ou Wave en payant en bitcoin",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const env = await getBitnobEnvironment();
  const live = env === "live" || env === "production";
  return (
    <html lang="fr" className={`${display.variable} ${text.variable}`}>
      <body>
        <div className="app">
          <header className="top">
            <a className="wordmark" href="/">Yónne</a>
            <span className={live ? "env live" : "env"}>{live ? "Argent réel" : env === "sandbox" ? "Sandbox" : env}</span>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
