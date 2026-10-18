import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { getBitnobEnvironment } from "@/lib/environment";
import AppChrome from "./AppChrome";
import "./globals.css";

export const dynamic = "force-dynamic";

const text = Geist({ subsets: ["latin"], variable: "--font-text" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "Yónne",
  description: "Envoyez des FCFA sur Orange Money ou Wave en payant en bitcoin",
  appleWebApp: { capable: true, title: "Yónne", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/192", apple: "/icons/180" },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b0b0d", colorScheme: "dark" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const env = await getBitnobEnvironment();
  const live = env === "live" || env === "production";
  return (
    <html lang="fr" className={`${text.variable} ${mono.variable}`}>
      <body>
        <AppChrome env={env} live={live}>{children}</AppChrome>
      </body>
    </html>
  );
}
