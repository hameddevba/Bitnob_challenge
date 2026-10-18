import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Autorise l'ouverture du serveur de dev via un tunnel ngrok (test sur téléphone).
  // Sans cela, Next.js bloque ses scripts et la page reste inerte.
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.app", "*.ngrok.dev"],
};

export default nextConfig;
