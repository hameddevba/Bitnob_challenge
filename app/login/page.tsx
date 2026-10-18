"use client";

import { useActionState, useState } from "react";
import { login, signup } from "./actions";
import { Zap, Lock, Mail, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import Link from "next/link";

interface ActionState {
  error?: string;
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginState, loginAction, loginPending] = useActionState<ActionState | null, FormData>(login, null);
  const [signupState, signupAction, signupPending] = useActionState<ActionState | null, FormData>(signup, null);

  const error = (loginState as ActionState)?.error ?? (signupState as ActionState)?.error;
  const isPending = loginPending || signupPending;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <Link href="/" className="inline-flex items-center gap-2 mb-2">
          <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center text-white shadow-sm font-bold mx-auto">
            <Zap className="w-6 h-6 fill-current" />
          </div>
        </Link>
        <h2 className="text-2xl font-extrabold text-zinc-900 dark:text-white tracking-tight">
          {mode === "login" ? "Connexion à Bitnob FCFA" : "Créer un compte"}
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Envoyez des FCFA vers Orange Money via Bitcoin Lightning
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white dark:bg-zinc-900 py-8 px-6 shadow-sm border border-zinc-200 dark:border-zinc-800 rounded-2xl sm:px-10 space-y-6">
          {/* Onglets Connexion / Inscription */}
          <div className="flex rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                mode === "login"
                  ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              }`}
            >
              Se connecter
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                mode === "signup"
                  ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              }`}
            >
              Créer un compte
            </button>
          </div>

          {/* Alerte d'erreur */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Formulaire */}
          <form
            action={mode === "login" ? loginAction : signupAction}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                Adresse e-mail
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="nom@exemple.com"
                  className="block w-full pl-10 pr-3 py-3 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                Mot de passe
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  className="block w-full pl-10 pr-3 py-3 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </div>
              {mode === "signup" && (
                <p className="mt-1 text-[11px] text-zinc-400">
                  Au moins 8 caractères.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-semibold bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-white text-sm transition-all shadow disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Traitement en cours...
                </>
              ) : mode === "login" ? (
                <>
                  Se connecter
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  Créer mon compte
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Note sur la session */}
          <div className="text-center pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-[11px] text-zinc-400">
              Session sécurisée par cookies HTTP-only chiffrés.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
