// Réconciliation automatique toutes les 60 s : paiements non notifiés, payouts en attente,
// remboursements. À lancer à côté du serveur dès qu'on manipule de l'argent réel.
// Usage : npm run reconcile:loop   (APP_URL et CRON_SECRET lus dans .env.local)
import { config } from "dotenv";
config({ path: ".env.local" });

const base = (process.env.RECONCILE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET manquant dans .env.local");
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(`${base}/api/cron/reconcile`, { headers: { authorization: `Bearer ${secret}` } });
    const body = await res.json().catch(() => ({}));
    const n = Object.keys(body.checked ?? {}).length;
    console.log(`${new Date().toLocaleTimeString("fr-FR")} réconciliation ${res.status} : ${n} envoi(s) vérifié(s)`);
  } catch (e) {
    console.error(`${new Date().toLocaleTimeString("fr-FR")} réconciliation impossible : ${(e as Error).message}`);
  }
}

await tick();
setInterval(tick, 60_000);
