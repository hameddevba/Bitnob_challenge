import "server-only";
import { admin } from "./supabase";

export interface QuotePricing {
  amountXof: number;
  feeXof: number;
  totalXof: number;
  rate: number;
  amountSats: number;
  quoteTtl: number;
}

interface LimitsSetting {
  min_xof: number;
  max_xof: number;
}

interface PricingSetting {
  fee_percent: number;
  fee_fixed_xof: number;
  fx_spread_percent: number;
}

const DEFAULT_LIMITS: LimitsSetting = { min_xof: 500, max_xof: 10000 };
const DEFAULT_PRICING: PricingSetting = { fee_percent: 1.5, fee_fixed_xof: 100, fx_spread_percent: 1.0 };
const DEFAULT_TTL = 600; // 10 minutes

/**
 * Récupère le taux de change BTC/XOF (cache DB ou appel externe CoinGecko)
 */
export async function getBtcXofRate(): Promise<number> {
  try {
    // 1. Chercher un taux récent (< 5 min) dans Supabase
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: cached } = await admin
      .from("fx_rates")
      .select("xof_per_btc")
      .gte("fetched_at", fiveMinutesAgo)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.xof_per_btc) {
      return Number(cached.xof_per_btc);
    }
  } catch {
    // Si la DB n'est pas encore prête, continuer vers l'API
  }

  // 2. Appel API CoinGecko simple/price
  let rate = 0;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=xof,usd",
      { next: { revalidate: 120 } }
    );
    if (res.ok) {
      const json = await res.json();
      if (json?.bitcoin?.xof) {
        rate = Number(json.bitcoin.xof);
      } else if (json?.bitcoin?.usd) {
        // Estimation 1 USD ≈ 610 XOF
        rate = Number(json.bitcoin.usd) * 610;
      }
    }
  } catch (e) {
    console.warn("Échec récupération CoinGecko :", e);
  }

  // 3. Repli si l'API externe échoue
  if (!rate || rate <= 0) {
    try {
      const { data: lastRate } = await admin
        .from("fx_rates")
        .select("xof_per_btc")
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastRate?.xof_per_btc) {
        return Number(lastRate.xof_per_btc);
      }
    } catch {
      // ignore
    }
    // Taux de secours réaliste si tout échoue (ex: 1 BTC ≈ 55 000 000 FCFA)
    rate = 55_000_000;
  }

  // Enregistrer le taux en base pour audit / cache
  try {
    await admin.from("fx_rates").insert({
      xof_per_btc: rate,
      source: "coingecko",
    });
  } catch {
    // ignore
  }

  return rate;
}

/**
 * Calcule le devis complet avec vérification des limites et calcul des frais
 */
export async function computeQuote(amountXof: number): Promise<QuotePricing> {
  if (!Number.isFinite(amountXof) || amountXof <= 0 || !Number.isInteger(amountXof)) {
    throw new Error("Le montant doit être un nombre entier positif en FCFA.");
  }

  // Charger les paramètres depuis app_settings
  let limits = DEFAULT_LIMITS;
  let pricing = DEFAULT_PRICING;
  let ttl = DEFAULT_TTL;

  try {
    const { data: settings } = await admin.from("app_settings").select("key, value");
    if (settings && Array.isArray(settings)) {
      for (const s of settings) {
        if (s.key === "limits" && s.value) limits = { ...limits, ...s.value };
        if (s.key === "pricing" && s.value) pricing = { ...pricing, ...s.value };
        if (s.key === "quote_ttl_seconds" && s.value) ttl = Number(s.value);
      }
    }
  } catch {
    // Fallback aux valeurs par défaut si app_settings n'est pas encore accessible
  }

  if (amountXof < limits.min_xof) {
    throw new Error(`Le montant minimum est de ${limits.min_xof.toLocaleString("fr-FR")} FCFA.`);
  }

  if (amountXof > limits.max_xof) {
    throw new Error(`Le montant maximum autorisé pour ce test est de ${limits.max_xof.toLocaleString("fr-FR")} FCFA.`);
  }

  const rawRate = await getBtcXofRate();
  // Appliquer le spread FX : le taux appliqué donne un peu plus de sécurité
  const effectiveRate = Math.round(rawRate * (1 - (pricing.fx_spread_percent || 0) / 100));

  // Frais de service : pourcentage + fixe
  const feeXof = Math.ceil(amountXof * ((pricing.fee_percent || 0) / 100) + (pricing.fee_fixed_xof || 0));
  const totalXof = amountXof + feeXof;

  // Conversion en satoshis (1 BTC = 100 000 000 sats), arrondi supérieur
  const amountSats = Math.ceil((totalXof / effectiveRate) * 1e8);

  return {
    amountXof,
    feeXof,
    totalXof,
    rate: effectiveRate,
    amountSats,
    quoteTtl: ttl,
  };
}
