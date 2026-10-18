import type { ReactNode } from "react";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { getBitnobEnvironment } from "@/lib/environment";
import AppChrome from "./AppChrome";
import "./globals.css";

export const dynamic = "force-dynamic";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"] });
const text = Instrument_Sans({ subsets: ["latin"], variable: "--font-text" });

export const metadata = {
  title: "Yónne",
  description: "Envoyez des FCFA sur Orange Money ou Wave en payant en bitcoin",
  appleWebApp: { capable: true, title: "Yónne", statusBarStyle: "default" },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const env = await getBitnobEnvironment();
  const live = env === "live" || env === "production";
  return (
    <html lang="fr" className={`${display.variable} ${text.variable}`}>
      <body>
        <AppChrome env={env} live={live}>{children}</AppChrome>
      </body>
    </html>
  );
}
