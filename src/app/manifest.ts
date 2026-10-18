import type { MetadataRoute } from "next";

// Installable sur l'écran d'accueil du téléphone, ouverte en plein écran comme une application.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Yónne : bitcoin vers mobile money",
    short_name: "Yónne",
    description: "Payez en bitcoin, votre famille reçoit des FCFA sur Orange Money ou Wave.",
    start_url: "/",
    display: "standalone",
    background_color: "#18191d",
    theme_color: "#18191d",
    lang: "fr",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
