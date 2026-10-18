"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_FCFA, MIN_FCFA, postJson, type Quote } from "./ui";

// Cotation Bitnob en direct pour un montant FCFA (debounce 500 ms, ignore les réponses périmées)
export function useQuote(amount: number) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const inRange = amount >= MIN_FCFA && amount <= MAX_FCFA;

  useEffect(() => {
    setQuote(null);
    setError(null);
    if (!inRange) { setLoading(false); return; }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const q = await postJson<Quote>("/api/quote", { amountFcfa: amount });
        if (id === seq.current) setQuote(q);
      } catch (e) {
        if (id === seq.current) setError((e as Error).message);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [amount, inRange]);

  return { quote, loading, error, inRange };
}
