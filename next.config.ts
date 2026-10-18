import type { NextConfig } from "next";

// En-têtes de sécurité appliqués à toutes les pages et routes
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },                       // pas d'intégration en iframe (clickjacking)
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },                 // les jetons des URL ne fuient pas vers d'autres sites
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  // Autorise l'ouverture du serveur de dev via un tunnel ngrok (test sur téléphone).
  // Sans cela, Next.js bloque ses scripts et la page reste inerte.
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.app", "*.ngrok.dev"],
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  // Adresse Lightning awa@domaine → https://domaine/.well-known/lnurlp/awa (LUD-16)
  async rewrites() {
    return [{ source: "/.well-known/lnurlp/:handle", destination: "/api/lnurl/:handle" }];
  },
};

export default nextConfig;
