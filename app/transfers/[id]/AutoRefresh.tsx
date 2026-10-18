"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({ everyMs = 4000 }: { everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const i = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(i);
  }, [router, everyMs]);

  return (
    <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 py-1">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      </span>
      <span>Actualisation en direct...</span>
    </div>
  );
}
