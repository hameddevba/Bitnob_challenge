import type { ReactNode } from "react";

export const metadata = {
  title: "FCFA via Bitcoin",
  description: "Envoyer des FCFA vers Orange Money avec Bitcoin Lightning",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
