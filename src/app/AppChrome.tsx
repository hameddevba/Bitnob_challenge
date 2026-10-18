"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

// Habillage façon application mobile : entête (logo ou bouton retour) + barre d'onglets en bas.

const TABS = [
  { href: "/", label: "Envoyer", match: (p: string) => p === "/" || p.startsWith("/recipient"), icon: SendIcon },
  { href: "/recevoir", label: "Recevoir", match: (p: string) => p.startsWith("/recevoir") || p.startsWith("/creer"), icon: ReceiveIcon },
  { href: "/activite", label: "Activité", match: (p: string) => p.startsWith("/activite") || p.endsWith("/gerer"), icon: ActivityIcon },
];

// Écrans de premier niveau : logo + onglets. Ailleurs : bouton retour.
const TOP_LEVEL = ["/", "/recevoir", "/activite"];
// Pages publiques reçues par les proches et étapes de paiement : pas de barre d'onglets.
const hideNav = (p: string) => /^\/(pay|recu|p|c)\//.test(p) && !p.endsWith("/gerer");

export default function AppChrome({ env, live, children }: { env: string; live: boolean; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const topLevel = TOP_LEVEL.includes(pathname);
  const withNav = !hideNav(pathname);

  function back() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  return (
    <div className={`app${withNav ? " with-nav" : ""}`}>
      <header className="top">
        {topLevel ? (
          <a className="wordmark" href="/">Yónne</a>
        ) : (
          <button className="icon-btn" onClick={back} aria-label="Retour"><BackIcon /></button>
        )}
        <span className={live ? "env live" : "env"}>{live ? "Argent réel" : env === "sandbox" ? "Sandbox" : env}</span>
      </header>
      <main>{children}</main>
      {withNav && (
        <nav className="tabbar" aria-label="Navigation principale">
          {TABS.map((t) => {
            const active = t.match(pathname);
            const Icon = t.icon;
            return (
              <a key={t.href} href={t.href} className={active ? "on" : ""} aria-current={active ? "page" : undefined}>
                <Icon />
                <span>{t.label}</span>
              </a>
            );
          })}
        </nav>
      )}
    </div>
  );
}

function BackIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SendIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M7 17L17 7M9 7h8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ReceiveIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M17 7L7 17M15 17H7V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ActivityIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
