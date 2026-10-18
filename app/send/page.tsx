import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import SendWizard from "./SendWizard";
import { Zap, LogOut } from "lucide-react";
import { logout } from "../login/actions";

export const instant = false;

export default async function SendPage() {
  await connection();
  const user = await requireUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col justify-between">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center text-white shadow-sm font-bold">
              <Zap className="w-5 h-5 fill-current" />
            </div>
            <div>
              <span className="font-extrabold text-base tracking-tight text-zinc-900 dark:text-white">
                Bitnob FCFA
              </span>
              <span className="hidden sm:inline-block ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold uppercase">
                Lightning ⚡ Orange Money
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 hidden sm:inline truncate max-w-[200px]">
              {user.email}
            </span>
            <form action={logout}>
              <button
                type="submit"
                title="Déconnexion"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Déconnexion</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8 flex flex-col justify-center">
        <div className="text-center max-w-md mx-auto mb-8 space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-zinc-900 dark:text-white tracking-tight">
            Envoyez des FCFA via Bitcoin Lightning
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Payez instantanément en Bitcoin. Votre destinataire reçoit ses FCFA directement sur son compte Orange Money.
          </p>
        </div>

        <SendWizard />
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 py-6 text-center text-xs text-zinc-500">
        <p>
          Propulsé par <span className="font-semibold text-zinc-700 dark:text-zinc-300">Bitnob Lightning</span> &{" "}
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">PayDunya PER</span>.
        </p>
        <p className="text-[11px] text-zinc-400 mt-1">
          Sénégal 🇸🇳 • Côte d&apos;Ivoire 🇨🇮 • Mali 🇲🇱 • Burkina Faso 🇧🇫
        </p>
      </footer>
    </div>
  );
}
