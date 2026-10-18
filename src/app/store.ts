"use client";

// Mémoire locale du téléphone : envois faits depuis cet appareil et lien de gestion du bénéficiaire.
// Rien de sensible côté argent : ce sont des liens de suivi. Toujours protégé par try/catch
// (navigation privée, stockage bloqué).

export type SavedTransfer = {
  id: string; token: string; amountFcfa: number; recipientName: string; network: string; at: string;
};
export type SavedSpace = { handle: string; name: string; manageLink: string };

const KEY_TRANSFERS = "yonne.transfers";
const KEY_SPACE = "yonne.space";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}

export function rememberTransfer(t: Omit<SavedTransfer, "at">) {
  const list = read<SavedTransfer[]>(KEY_TRANSFERS, []).filter((x) => x.id !== t.id);
  write(KEY_TRANSFERS, [{ ...t, at: new Date().toISOString() }, ...list].slice(0, 30));
}

export const savedTransfers = () => read<SavedTransfer[]>(KEY_TRANSFERS, []);

export function rememberSpace(s: SavedSpace) { write(KEY_SPACE, s); }
export const savedSpace = () => read<SavedSpace | null>(KEY_SPACE, null);
