// Guide du code : scanne src/, migrations/, tests/ (et scripts/) et produit une page autonome
// public/code-guide/index.html (CSS/JS inline, index JSON embarqué), servie par Next à /code-guide/index.html.
// Contenu rédigé à la main : docs/code-guide/content.json (fonctionnalités, décisions…), fusionné ici.
// Usage : npx tsx scripts/build-code-guide.ts   (ou npm run docs:build)
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const OUT = join(ROOT, "public/code-guide/index.html");
const CONTENT = join(ROOT, "docs/code-guide/content.json");
const SELF = "scripts/build-code-guide.ts";

// ---------- Types ----------

type Loc = { file: string; line: number; label: string };
type Entry = {
  id: string;
  kind: string; // feature | decision | bitnob | webhook | route | page | fn | event | table | col | enum | env | test | code
  title: string;
  sub?: string;
  file?: string;
  line?: number;
  end?: number;
  doc?: string;
  summary?: string;
  keywords?: string[];
  exported?: boolean;
  locs?: Loc[];
  usedBy?: Loc[]; // fonctions : appels hors de la définition
  name?: string; // identifiant à chercher pour « Utilisé dans »
};

type Ref = string;
type Content = {
  synonyms: Record<string, string[]>;
  annotations: Record<string, { summary?: string; keywords?: string[] }>;
  features: {
    id: string; title: string; summary: string; screens: Ref[]; routes: Ref[]; functions: Ref[];
    bitnob: Ref[]; tables: Ref[]; steps: { text: string; refs: Ref[] }[]; notes?: string[]; noteRefs?: Ref[];
  }[];
  bitnobApis: { method: string; path: string; why: string }[];
  webhooks: { event: string; why: string; handling: string; refs: Ref[] }[];
  decisions: { title: string; choice: string; why: string; tradeoff?: string; refs: Ref[] }[];
  states: { happyPath: string[]; transitions: { from: string; to: string; when: string; by: Ref }[]; notes: string[] };
};

// ---------- Fichiers ----------

function walk(dir: string, filter: (p: string) => boolean): string[] {
  const abs = join(ROOT, dir);
  let out: string[] = [];
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(relative(ROOT, p), filter));
    else if (filter(p)) out.push(relative(ROOT, p).replace(/\\/g, "/"));
  }
  return out.sort();
}

const isTs = (p: string) => /\.(ts|tsx)$/.test(p);
const srcFiles = walk("src", isTs);
const migrationFiles = walk("migrations", (p) => p.endsWith(".sql"));
const testFiles = walk("tests", isTs);
const scriptFiles = walk("scripts", isTs).filter((f) => f !== SELF);
const extraFiles = ["next.config.ts"];
const allFiles = [...srcFiles, ...migrationFiles, ...testFiles, ...scriptFiles, ...extraFiles];

const files: Record<string, string[]> = {};
for (const f of allFiles) files[f] = readFileSync(join(ROOT, f), "utf8").replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");

const entries = new Map<string, Entry>();
const warnings: string[] = [];
function add(e: Entry) {
  if (entries.has(e.id)) {
    const prev = entries.get(e.id)!;
    prev.locs = [...(prev.locs ?? []), ...(e.file ? [{ file: e.file, line: e.line!, label: "autre définition" }] : [])];
    return prev;
  }
  entries.set(e.id, e);
  return e;
}
function addLoc(id: string, loc: Loc) {
  const e = entries.get(id);
  if (!e) return;
  e.locs ??= [];
  if (!e.locs.some((l) => l.file === loc.file && l.line === loc.line)) e.locs.push(loc);
}

// ---------- Déclarations TypeScript (fonctions, constantes, types) ----------

type Decl = { name: string; kind: "function" | "const" | "type" | "class"; line: number; end: number; exported: boolean; isDefault: boolean };
const declsByFile: Record<string, Decl[]> = {};

function docAbove(lines: string[], idx: number): string {
  const out: string[] = [];
  for (let i = idx - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!/^(\/\/|\/\*|\*)/.test(t)) break;
    const text = t.replace(/^\/\*+|\*+\/$|^\*|^\/\//g, "").trim();
    if (/^-{3,}.*-{3,}$/.test(text)) break; // séparateur de section
    out.unshift(text);
  }
  return out.join(" ").trim();
}

function endOfDecl(lines: string[], idx: number, kind: Decl["kind"]): number {
  const first = lines[idx];
  const open = (first.match(/{/g) ?? []).length;
  const close = (first.match(/}/g) ?? []).length;
  if (kind === "function" || kind === "class") {
    if (open > 0 && open === close && /}\s*;?\s*$/.test(first)) return idx;
    for (let i = idx + 1; i < Math.min(lines.length, idx + 400); i++) if (/^}\s*;?\s*(\/\/.*)?$/.test(lines[i])) return i;
    return idx;
  }
  for (let i = idx; i < Math.min(lines.length, idx + 120); i++) {
    if (i > idx && /^[}\])]/.test(lines[i])) return i;
    const next = lines[i + 1];
    if (/;\s*(\/\/.*)?$/.test(lines[i]) && (next === undefined || next.trim() === "" || /^\S/.test(next))) return i;
  }
  return idx;
}

function parseDecls(file: string): Decl[] {
  const lines = files[file];
  const out: Decl[] = [];
  lines.forEach((l, i) => {
    let m: RegExpExecArray | null;
    let d: Omit<Decl, "end"> | null = null;
    if ((m = /^(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(l))) {
      d = { name: m[4], kind: "function", line: i, exported: !!m[1], isDefault: !!m[2] };
    } else if ((m = /^(export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)/.exec(l))) {
      d = { name: m[2], kind: "const", line: i, exported: !!m[1], isDefault: false };
    } else if ((m = /^(export\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/.exec(l))) {
      d = { name: m[2], kind: "type", line: i, exported: !!m[1], isDefault: false };
    } else if ((m = /^(export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(l))) {
      d = { name: m[2], kind: "class", line: i, exported: !!m[1], isDefault: false };
    }
    if (d) out.push({ ...d, end: endOfDecl(lines, i, d.kind) });
  });
  return out;
}

function enclosing(file: string, line0: number): Decl | undefined {
  return (declsByFile[file] ?? []).find((d) => d.line <= line0 && line0 <= d.end);
}
const routeUrl = (f: string) => f.replace(/^src\/app/, "").replace(/\/route\.tsx?$/, "") || "/";
const pageUrl = (f: string) => f.replace(/^src\/app/, "").replace(/\/page\.tsx?$/, "") || "/";
const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

// Nom lisible du bloc qui contient une ligne : fonction, route (GET /api/…) ou écran
function ownerName(file: string, line0: number): string | null {
  const d = enclosing(file, line0);
  if (!d) return null;
  if (/\/route\.tsx?$/.test(file) && HTTP.has(d.name)) return `${d.name} ${routeUrl(file)}`;
  if (/\/page\.tsx?$/.test(file) && d.isDefault) return `écran ${pageUrl(file)}`;
  return d.name;
}
const inFn = (file: string, line0: number) => {
  const n = ownerName(file, line0);
  return n ? ` · dans ${n}` : "";
};

for (const f of [...srcFiles, ...scriptFiles, ...extraFiles]) {
  const decls = (declsByFile[f] = parseDecls(f));
  const lines = files[f];
  const isRoute = /\/route\.tsx?$/.test(f) && f.startsWith("src/app/");
  const isPage = /\/page\.tsx?$/.test(f) && f.startsWith("src/app/");
  for (const d of decls) {
    const doc = docAbove(lines, d.line);
    if (isRoute && d.kind === "function" && HTTP.has(d.name)) {
      const url = routeUrl(f);
      add({ id: `route:${d.name} ${url}`, kind: "route", title: `${d.name} ${url}`, file: f, line: d.line + 1, end: d.end + 1, doc, exported: true });
      continue;
    }
    if (isPage && d.isDefault) {
      const url = pageUrl(f);
      const fallback = lines.map((l, i) => ({ l, i })).find(({ l }) => /^\/\/ /.test(l))?.l.replace(/^\/\/\s*/, "");
      add({ id: `page:${url}`, kind: "page", title: url, sub: d.name, file: f, line: d.line + 1, end: d.end + 1, doc: doc || fallback, exported: true, name: d.name });
      continue;
    }
    if (f.startsWith("scripts/") || f === "next.config.ts") continue; // scripts : endpoints seulement
    const isArrow = d.kind === "const" && /=\s*(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*(:[^=]+)?=>/.test(lines[d.line]);
    const sub = d.kind === "function" || isArrow ? (/^[A-Z]/.test(d.name) && f.endsWith(".tsx") ? "composant" : "fonction")
      : d.kind === "const" ? "constante" : d.kind === "class" ? "classe" : "type";
    const id = `fn:${d.name}`;
    const existing = entries.get(id);
    // Doublon de nom (ex. UUID dans plusieurs routes) : on garde la version exportée de src/lib en priorité
    if (existing && (existing.exported || !d.exported)) {
      addLoc(id, { file: f, line: d.line + 1, label: `autre déclaration${d.exported ? " exportée" : ""}` });
      continue;
    }
    if (existing) entries.delete(id);
    add({ id, kind: "fn", title: d.name, sub: `${sub}${d.exported ? " exportée" : " interne"}`, file: f, line: d.line + 1, end: d.end + 1, doc, exported: d.exported, name: d.name });
  }
}

// ---------- API Bitnob : contenu + appels réels ----------

const content: Content = JSON.parse(readFileSync(CONTENT, "utf8"));

const apiPattern = (path: string) => new RegExp("^" + path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:\w+/g, "[^/]+") + "$");
for (const a of content.bitnobApis) {
  add({ id: `bitnob:${a.method} ${a.path}`, kind: "bitnob", title: `${a.method} ${a.path}`, summary: a.why, locs: [], name: a.path.split("/:")[0] });
}

const CALL = /\bbitnob(?:<.*?>)?\(\s*"(GET|POST|PUT|PATCH|DELETE)"\s*,\s*(["`])(.*?)\2/g;
for (const f of [...srcFiles, ...testFiles, ...scriptFiles]) {
  files[f].forEach((l, i) => {
    for (const m of l.matchAll(CALL)) {
      const method = m[1];
      const path = m[3].replace(/\$\{encodeURIComponent\((\w+)\)\}/g, ":$1").replace(/\$\{(\w+)\}/g, ":$1");
      const candidates = content.bitnobApis.filter((a) => a.method === method);
      const hit = candidates.find((a) => a.path === path) ?? candidates.find((a) => apiPattern(a.path).test(path));
      const id = hit ? `bitnob:${hit.method} ${hit.path}` : `bitnob:${method} ${path}`;
      if (!entries.has(id)) {
        add({ id, kind: "bitnob", title: `${method} ${path}`, summary: "Endpoint appelé dans le code (absent de content.json).", locs: [] });
        warnings.push(`Endpoint Bitnob non documenté dans content.json : ${method} ${path} (${f}:${i + 1})`);
      }
      const where = f.startsWith("tests/") ? "test" : f.startsWith("scripts/") ? "script" : "appel";
      addLoc(id, { file: f, line: i + 1, label: where === "appel" ? `appel${inFn(f, i)}` : where });
      const e = entries.get(id)!;
      if (!e.file && where === "appel") { e.file = f; e.line = i + 1; }
    }
  });
}
for (const e of entries.values()) {
  if (e.kind === "bitnob" && !e.file && e.locs?.length) { e.file = e.locs[0].file; e.line = e.locs[0].line; }
}

// ---------- Appels front → routes API ----------

const routeEntries = () => [...entries.values()].filter((e) => e.kind === "route");
for (const f of srcFiles.filter((p) => p.startsWith("src/app/") && !p.startsWith("src/app/api/"))) {
  const lines = files[f];
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/(["`])(\/api\/[^"`?]*)/g)) {
      const raw = m[2];
      const ctx = lines.slice(i, i + 4).join(" ");
      const method = /postJson|method:\s*"POST"/.test(ctx) ? "POST" : "GET";
      const re = new RegExp("^" + raw.replace(/\$\{[^}]+\}/g, "\u0000").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\u0000/g, "[^/]+") + "$");
      const routes = routeEntries().filter((r) => re.test(r.title.split(" ")[1].replace(/\[[^\]]+\]/g, "x")) || re.test(r.title.split(" ")[1]));
      const r = routes.find((x) => x.title.startsWith(method + " ")) ?? routes[0];
      if (r) addLoc(r.id, { file: f, line: i + 1, label: `appelée depuis l'écran${inFn(f, i)}` });
    }
  });
}

// Rewrites Next (next.config.ts) → routes
files["next.config.ts"].forEach((l, i) => {
  const m = /source:\s*"([^"]+)",\s*destination:\s*"([^"]+)"/.exec(l);
  if (!m) return;
  const dest = m[2].replace(/:(\w+)/g, "[$1]");
  for (const r of routeEntries()) if (r.title.endsWith(" " + dest)) addLoc(r.id, { file: "next.config.ts", line: i + 1, label: `rewrite ${m[1]} → ${m[2]}` });
});

// ---------- Tables SQL (migrations) ----------

const tables = new Set<string>();
for (const f of migrationFiles) {
  const lines = files[f];
  const mig = f.replace(/^migrations\//, "").replace(/\.sql$/, "");
  let currentTable: string | null = null;
  let currentEnum: { id: string; values: string[] } | null = null;
  lines.forEach((l, i) => {
    const comment = (/--\s*(.*)$/.exec(l)?.[1] ?? "").trim();
    let m: RegExpExecArray | null;
    if (currentEnum) {
      for (const v of l.matchAll(/'([A-Z_]+)'/g)) currentEnum.values.push(v[1]);
      if (/\);/.test(l)) { entries.get(currentEnum.id)!.summary = currentEnum.values.join(" · "); currentEnum = null; }
      return;
    }
    if ((m = /^CREATE TYPE (\w+) AS ENUM \((.*)$/.exec(l))) {
      const values = [...m[2].matchAll(/'([A-Za-z_]+)'/g)].map((v) => v[1]);
      add({ id: `enum:${m[1]}`, kind: "enum", title: m[1], file: f, line: i + 1, sub: `énumération · ${mig}`, summary: values.join(" · "), name: m[1] });
      if (!/\);/.test(m[2])) currentEnum = { id: `enum:${m[1]}`, values };
      return;
    }
    if ((m = /^ALTER TYPE (\w+) ADD VALUE(?: IF NOT EXISTS)? '(\w+)'/.exec(l))) {
      const e = entries.get(`enum:${m[1]}`);
      if (e) { e.summary += ` · ${m[2]}`; addLoc(e.id, { file: f, line: i + 1, label: `${mig} : ajoute ${m[2]}` }); }
      return;
    }
    if ((m = /^CREATE TABLE (\w+)/.exec(l))) {
      currentTable = m[1];
      tables.add(m[1]);
      const doc = docAbove(lines.map((x) => x.replace(/^--/, "//")), i)
        .replace(/^migrations\/\S+\s*(—.*?(\.|$))?\s*/, "").replace(/^\d+\.\s*/, "");
      let end = i;
      while (end < lines.length && !/^\);/.test(lines[end])) end++;
      add({ id: `table:${m[1]}`, kind: "table", title: m[1], sub: `table · ${mig}`, file: f, line: i + 1, end: end + 1, doc, locs: [], name: m[1] });
      return;
    }
    if (currentTable) {
      if (/^\);/.test(l)) { currentTable = null; return; }
      const c = /^\s+([a-z_][a-z0-9_]*)\s+([A-Za-z].*?)\s*,?\s*(--.*)?$/.exec(l);
      if (c) {
        add({ id: `col:${currentTable}.${c[1]}`, kind: "col", title: `${currentTable}.${c[1]}`, sub: c[2].replace(/,$/, ""), doc: comment, file: f, line: i + 1, name: c[1] });
      }
      return;
    }
    if ((m = /^ALTER TABLE (\w+)\s+(.*)$/.exec(l))) {
      const [, t, rest] = m;
      let a: RegExpExecArray | null;
      if ((a = /^ADD COLUMN (\w+)\s+(.*?);?\s*(--.*)?$/.exec(rest))) {
        add({ id: `col:${t}.${a[1]}`, kind: "col", title: `${t}.${a[1]}`, sub: a[2].replace(/;$/, ""), doc: comment, file: f, line: i + 1, name: a[1] });
        addLoc(`table:${t}`, { file: f, line: i + 1, label: `${mig} : ajoute ${a[1]}` });
      } else if ((a = /^RENAME COLUMN (\w+) TO (\w+)/.exec(rest))) {
        const old = entries.get(`col:${t}.${a[1]}`);
        if (old) {
          entries.delete(old.id);
          add({ ...old, id: `col:${t}.${a[2]}`, title: `${t}.${a[2]}`, name: a[2],
            locs: [...(old.locs ?? []), { file: f, line: i + 1, label: `${mig} : renommée (ancien nom ${a[1]})` }] });
        }
        addLoc(`table:${t}`, { file: f, line: i + 1, label: `${mig} : renomme ${a[1]} en ${a[2]}` });
      } else if ((a = /^ALTER COLUMN (\w+)\s+(.*?);?$/.exec(rest))) {
        addLoc(`col:${t}.${a[1]}`, { file: f, line: i + 1, label: `${mig} : ${a[2]}` });
      } else if (/ENABLE ROW LEVEL SECURITY/.test(rest)) {
        addLoc(`table:${t}`, { file: f, line: i + 1, label: `${mig} : RLS activé (aucune politique)` });
      } else {
        addLoc(`table:${t}`, { file: f, line: i + 1, label: `${mig} : ${rest.replace(/;$/, "").slice(0, 90)}` });
      }
      return;
    }
    if ((m = /^CREATE INDEX (\w+) ON (\w+)\((.*)\)/.exec(l))) addLoc(`table:${m[2]}`, { file: f, line: i + 1, label: `${mig} : index ${m[1]} (${m[3]})` });
    if ((m = /^CREATE TRIGGER (\w+)/.exec(l))) {
      const on = /ON (\w+)/.exec(lines[i + 1] ?? "")?.[1];
      if (on) addLoc(`table:${on}`, { file: f, line: i + 1, label: `${mig} : déclencheur ${m[1]} (updated_at)` });
    }
  });
}

// Accès SQL dans le code (lecture / écriture par table)
const SQL_OPS: Record<string, string> = { "INSERT INTO": "écriture (INSERT)", UPDATE: "mise à jour (UPDATE)", "DELETE FROM": "suppression", FROM: "lecture", JOIN: "lecture (JOIN)" };
for (const f of srcFiles) {
  files[f].forEach((l, i) => {
    for (const m of l.matchAll(/\b(INSERT INTO|DELETE FROM|UPDATE|FROM|JOIN)\s+([a-z_]+)\b/g)) {
      if (!tables.has(m[2])) continue;
      addLoc(`table:${m[2]}`, { file: f, line: i + 1, label: `${SQL_OPS[m[1]]}${inFn(f, i)}` });
    }
  });
}

// ---------- Événements du journal (logEvent) ----------

const LOG = /logEvent\(\s*([^,()]+?),\s*([^,()]+?),\s*(["'`])([^"'`]*)\3\s*,\s*(["'`])([^"'`]*)\5/g;
for (const f of srcFiles) {
  const text = files[f].join("\n");
  for (const m of text.matchAll(LOG)) {
    const at = m.index! + m[0].lastIndexOf(m[6]);
    const line0 = text.slice(0, at).split("\n").length - 1;
    const type = m[6];
    const id = `event:${type}`;
    if (!entries.has(id)) add({ id, kind: "event", title: type, sub: `source ${m[4]}`, file: f, line: line0 + 1, locs: [], name: type.replace(/\$\{.*$/, "") });
    addLoc(id, { file: f, line: line0 + 1, label: `écrit (source ${m[4]})${inFn(f, line0)}` });
  }
}
// Libellés lisibles (describe dans lib/journal.ts)
{
  const f = "src/lib/journal.ts";
  const lines = files[f] ?? [];
  let pending: { type: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const c = /^\s*case\s+"([^"]+)":/.exec(l);
    if (c) { pending.push({ type: c[1], line: i + 1 }); return; }
    const w = /type\.startsWith\("webhook:"\)/.test(l);
    if (w) pending.push({ type: "webhook:${event}", line: i + 1 });
    const t = /title:\s*(.*?)(?:,\s*(?:detail|tone):|$)/.exec(l);
    if (t && pending.length) {
      const label = [...t[1].matchAll(/"([^"]*)"|`([^`]*)`/g)].map((x) => (x[1] ?? x[2]).replace(/\$\{[^}]*\}/g, "…"))
        .filter((s) => s && !/^[a-z_]+$/.test(s)).join(" / ");
      for (const p of pending) {
        const e = entries.get(`event:${p.type}`);
        if (e) { e.summary = label; addLoc(e.id, { file: f, line: p.line, label: "libellé affiché (describe)" }); }
      }
      pending = [];
    }
  });
}

// ---------- Webhooks Bitnob ----------

for (const w of content.webhooks) {
  const id = `webhook:${w.event}`;
  add({ id, kind: "webhook", title: w.event, summary: `${w.why} ${w.handling}`, locs: [], name: w.event });
  for (const f of srcFiles) files[f].forEach((l, i) => {
    if (l.includes(w.event)) addLoc(id, { file: f, line: i + 1, label: `mentionné${inFn(f, i)}` });
  });
}

// ---------- Variables d'environnement ----------

for (const f of [...srcFiles, ...extraFiles]) {
  files[f].forEach((l, i) => {
    for (const m of l.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const id = `env:${m[1]}`;
      if (!entries.has(id)) add({ id, kind: "env", title: m[1], sub: "variable d'environnement", file: f, line: i + 1, locs: [], name: m[1] });
      addLoc(id, { file: f, line: i + 1, label: `lue${inFn(f, i)}` });
    }
  });
}

// ---------- Tests ----------

for (const f of testFiles) {
  let suite = "";
  files[f].forEach((l, i) => {
    const m = /^(\s*)(describe|it|test)\(\s*(["'`])(.*?)\3/.exec(l);
    if (!m) return;
    if (m[2] === "describe") { suite = m[4]; return; }
    add({ id: `test:${f}:${i + 1}`, kind: "test", title: m[4], sub: suite ? `test · ${suite}` : "test", file: f, line: i + 1 });
  });
}

// ---------- « Utilisé par » : occurrences de chaque fonction hors de sa définition ----------

const importLines: Record<string, Set<number>> = {};
for (const f of [...srcFiles, ...testFiles]) {
  const set = (importLines[f] = new Set<number>());
  let inImport = false;
  files[f].forEach((l, i) => {
    if (/^import\s/.test(l)) inImport = true;
    if (inImport) set.add(i);
    if (inImport && (/from\s*["']/.test(l) || /^import\s*["']/.test(l))) inImport = false;
  });
}
for (const e of entries.values()) {
  if (e.kind !== "fn" || !e.name || e.name.length < 3) continue;
  const re = new RegExp(String.raw`(?<![\w$.])` + e.name.replace(/\$/g, "\\$") + String.raw`(?![\w$])`);
  const used: Loc[] = [];
  for (const f of [...srcFiles, ...testFiles]) {
    files[f].forEach((l, i) => {
      if (used.length >= 60 || importLines[f].has(i) || /^\s*\/\//.test(l) || !re.test(l)) return;
      if (f === e.file && i + 1 >= e.line! && i + 1 <= (e.end ?? e.line!)) return;
      used.push({ file: f, line: i + 1, label: f.startsWith("tests/") ? "test" : ownerName(f, i) ? `dans ${ownerName(f, i)}` : "niveau module" });
    });
  }
  e.usedBy = used;
}

// ---------- Annotations, fonctionnalités, décisions ----------

for (const [ref, a] of Object.entries(content.annotations)) {
  const e = entries.get(ref);
  if (!e) { warnings.push(`Annotation sans cible : ${ref}`); continue; }
  if (a.summary) e.summary = a.summary;
  if (a.keywords) e.keywords = [...(e.keywords ?? []), ...a.keywords];
}

// Résolution des refs → id d'entrée (et création des entrées « code:fichier#texte »)
const resolved: Record<string, string | null> = {};
function resolve(ref: Ref, where: string): string | null {
  if (ref in resolved) return resolved[ref];
  let id: string | null = null;
  if (entries.has(ref)) id = ref;
  else if (ref.startsWith("code:")) {
    const [file, needle] = ref.slice(5).split("#");
    const idx = files[file]?.findIndex((l) => l.includes(needle)) ?? -1;
    if (idx >= 0) {
      add({ id: ref, kind: "code", title: needle, sub: file, file, line: idx + 1, end: idx + 1, doc: `Extrait de ${file}${inFn(file, idx)}` });
      id = ref;
    }
  } else if (ref.startsWith("test:")) {
    const q = ref.slice(5).toLowerCase();
    const t = [...entries.values()].find((e) => e.kind === "test" && (e.title.toLowerCase().includes(q) || (e.sub ?? "").toLowerCase().includes(q)));
    id = t?.id ?? null;
  }
  if (!id) warnings.push(`Ref introuvable dans le code : ${ref} (${where})`);
  return (resolved[ref] = id);
}

const allRefs = (refs: Ref[] | undefined, where: string) => (refs ?? []).forEach((r) => resolve(r, where));
for (const ft of content.features) {
  for (const k of ["screens", "routes", "functions", "bitnob", "tables", "noteRefs"] as const) allRefs(ft[k], ft.id);
  ft.steps.forEach((s) => allRefs(s.refs, ft.id));
  add({ id: `feature:${ft.id}`, kind: "feature", title: ft.title, summary: ft.summary, keywords: [...ft.steps.map((s) => s.text), ...(ft.notes ?? [])] });
}
content.webhooks.forEach((w) => allRefs(w.refs, w.event));
content.decisions.forEach((d, i) => {
  allRefs(d.refs, d.title);
  add({ id: `decision:${i}`, kind: "decision", title: d.title, summary: d.choice, keywords: [d.why, d.tradeoff ?? ""] });
});
content.states.transitions.forEach((t) => resolve(t.by, `${t.from} → ${t.to}`));

// ---------- Sortie ----------

function git(cmd: string) {
  try { return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
}
const meta = {
  generatedAt: new Date().toISOString(),
  branch: git("rev-parse --abbrev-ref HEAD"),
  commit: git("rev-parse --short HEAD"),
  dirty: git("status --porcelain -- src migrations tests").length > 0,
};

const data = { meta, files, entries: [...entries.values()], resolved, content };
const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, renderHtml(json));

const count = (k: string) => data.entries.filter((e) => e.kind === k).length;
console.log(`Guide du code → ${relative(ROOT, OUT).replace(/\\/g, "/")} (${Math.round(Buffer.byteLength(json) / 1024)} Ko de données)`);
console.log(`  ${count("route")} routes · ${count("page")} écrans · ${count("fn")} fonctions/constantes/types · ${count("bitnob")} endpoints Bitnob · ${count("table")} tables / ${count("col")} colonnes · ${count("event")} événements · ${count("test")} tests`);
if (warnings.length) {
  console.warn(`\n${warnings.length} avertissement(s) :`);
  for (const w of warnings) console.warn(`  - ${w}`);
}

// ---------- Page HTML (CSS et JS inline) ----------

function renderHtml(dataJson: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guide du code Yónne</title>
<meta name="description" content="Guide du code de Yónne : fonctionnalités, routes, appels Bitnob, données et décisions, avec recherche instantanée.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>${cssText()}</style>
</head>
<body>
<a class="skip" href="#main">Aller au contenu</a>
<header class="top">
  <div class="wrap">
    <p class="brand">Yónne <span>· guide du code</span></p>
    <h1>Comprendre le code, endroit par endroit</h1>
    <p class="lede">Tapez un mot (<em>invoice</em>, <em>payout</em>, <em>webhook</em>, <em>preimage</em>, <em>cagnotte</em>…) pour voir chaque endroit où il intervient, avec le fichier, la ligne et l'extrait. Plus bas : les fonctionnalités pas à pas, les API Bitnob utilisées, les décisions et le modèle de données.</p>
    <p class="meta" id="meta"></p>
  </div>
</header>
<div class="searchbar" role="search">
  <div class="wrap">
    <label for="q" class="sr">Rechercher dans le code</label>
    <div class="field">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="invoice, payout, webhook, preimage, cagnotte…" aria-describedby="count">
      <kbd aria-hidden="true">/</kbd>
    </div>
    <div class="suggest" id="suggest"></div>
    <p id="count" class="count" aria-live="polite"></p>
  </div>
</div>
<nav class="toc wrap" aria-label="Sommaire" id="toc">
  <a href="#fonctionnalites">Fonctionnalités</a><a href="#api-bitnob">API Bitnob</a><a href="#decisions">Décisions</a><a href="#donnees">Données</a><a href="#index">Index complet</a>
</nav>
<main id="main" class="wrap">
  <section id="results" hidden aria-label="Résultats de recherche"></section>
  <div id="sections"></div>
</main>
<footer class="wrap foot"><p>Page générée par <code>scripts/build-code-guide.ts</code> à partir du code et de <code>docs/code-guide/content.json</code>. Régénérer : <code>npm run docs:build</code>.</p></footer>
<dialog id="dlg" aria-labelledby="dlg-title">
  <div class="dlg-head"><div id="dlg-kicker" class="kicker"></div><button type="button" class="close" id="dlg-close" aria-label="Fermer">×</button></div>
  <h2 id="dlg-title"></h2>
  <div id="dlg-body"></div>
</dialog>
<script type="application/json" id="guide-data">${dataJson}</script>
<script>var __name = function (f) { return f; };
(${clientApp.toString()})();</script>
</body>
</html>
`;
}

function cssText(): string {
  return `
:root{--bg:#fff;--ink:#14213D;--muted:#4f5a70;--faint:#6f788b;--line:#e4e7ed;--soft:#f5f6f8;--accent:#0F7B5F;--accent-soft:#e6f3ef;--sats:#C46A00;--mark:#fdebc8;--focus:#0F7B5F;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0d1322;--ink:#e8ecf4;--muted:#a5aec0;--faint:#8a93a8;--line:#25304a;--soft:#141c30;--accent:#43c39c;--accent-soft:#12302a;--sats:#f0a347;--mark:#5b3d0c;--focus:#43c39c;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0d1322;--ink:#e8ecf4;--muted:#a5aec0;--faint:#8a93a8;--line:#25304a;--soft:#141c30;--accent:#43c39c;--accent-soft:#12302a;--sats:#f0a347;--mark:#5b3d0c;--focus:#43c39c;color-scheme:dark}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%;scroll-padding-top:170px}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.55 "Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;overflow-x:hidden}
h1,h2,h3,h4,.brand{font-family:"Bricolage Grotesque","Instrument Sans",system-ui,sans-serif;letter-spacing:-.01em;line-height:1.15}
h1{font-size:clamp(28px,5vw,44px);font-weight:700;margin:.2em 0 .35em;max-width:20ch;text-wrap:balance}
h2{font-size:clamp(24px,3.4vw,32px);font-weight:700;margin:0 0 .4em}
h3{font-size:21px;font-weight:700;margin:0 0 .3em}
h4{font-size:13px;font-weight:600;font-family:"Instrument Sans",sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:1.4em 0 .5em}
a{color:var(--accent);text-underline-offset:3px}
code,pre,kbd,.mono{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em}
code,pre,.mono,.ref,.hit-title,#dlg-title,.flow,td.col,td.type,.hit-loc{font-variant-ligatures:none}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:-999px;top:8px;background:var(--ink);color:var(--bg);padding:8px 12px;z-index:10}.skip:focus{left:16px}
.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
@media (min-width:720px){.wrap{padding:0 32px}}
.top{padding:36px 0 18px}
.brand{font-size:18px;font-weight:700;margin:0;color:var(--accent)}.brand span{color:var(--muted);font-weight:500}
.lede{max-width:68ch;color:var(--muted);margin:0 0 .6em;font-size:17px}
.meta{font-size:13px;color:var(--faint);margin:0}
.searchbar{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 0 8px}
.field{display:flex;align-items:center;gap:10px;border-bottom:2px solid var(--ink);padding:4px 2px}
.field:focus-within{border-color:var(--accent)}
.field svg{color:var(--muted);flex:none}
#q{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:500 20px/1.3 "Instrument Sans",sans-serif;padding:8px 0;outline:none}
#q::placeholder{color:var(--faint)}
kbd{border:1px solid var(--line);border-radius:4px;padding:1px 6px;color:var(--faint)}
@media (hover:none){kbd{display:none}}
.suggest{display:flex;flex-wrap:wrap;gap:2px 14px;margin-top:8px;font-size:14px}
.suggest button{background:none;border:0;padding:4px 0;color:var(--accent);font:inherit;cursor:pointer;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px}
.suggest button:hover{text-decoration-color:currentColor}
.suggest span{color:var(--faint);padding:4px 0}
@media (max-width:719px){body.has-q .suggest{display:none}.suggest{flex-wrap:nowrap;overflow-x:auto;white-space:nowrap;scrollbar-width:none}.top{padding-top:24px}.lede{font-size:16px}}
.count{margin:6px 0 0;font-size:13px;color:var(--muted);min-height:1.3em}
.toc{display:flex;flex-wrap:wrap;gap:4px 20px;padding-top:14px;padding-bottom:6px;font-weight:500}
.toc a{text-decoration:none;color:var(--ink);border-bottom:2px solid transparent;padding:4px 0}.toc a:hover{border-color:var(--accent)}
main{padding-bottom:40px}
section.block{padding:40px 0 8px;border-top:1px solid var(--line);margin-top:28px}
section.block:first-child{border-top:0;margin-top:0}
.intro{color:var(--muted);max-width:70ch;margin:0 0 1.2em}
.featnav{display:flex;flex-wrap:wrap;gap:4px 18px;margin:0 0 10px;padding:0;list-style:none;font-size:15px}
article.feat,article.dec{padding:26px 0;border-top:1px solid var(--line)}
article.feat>p.sum,article.dec>p{max-width:72ch}
p.sum{color:var(--muted);margin:.2em 0 .4em}
ol.steps{margin:0;padding:0;list-style:none;counter-reset:s}
ol.steps li{counter-increment:s;position:relative;padding:6px 0 10px 40px;max-width:80ch}
ol.steps li::before{content:counter(s);position:absolute;left:0;top:5px;width:26px;height:26px;border-radius:50%;border:1.5px solid var(--accent);color:var(--accent);font:600 13px/23px "Instrument Sans",sans-serif;text-align:center}
.refs{display:flex;flex-wrap:wrap;gap:2px 6px;margin-top:4px}
.ref{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;background:none;border:0;border-bottom:1px solid var(--line);padding:3px 0;margin-right:8px;font:500 14px/1.4 "JetBrains Mono",ui-monospace,monospace;color:var(--accent);cursor:pointer;text-align:left;max-width:100%;overflow-wrap:anywhere}
.ref:hover{border-color:var(--accent)}
.ref .loc{color:var(--faint);font-weight:400;font-size:12px}
.ref.missing{color:var(--faint);cursor:default;text-decoration:line-through}
dl.facets{display:grid;grid-template-columns:minmax(0,1fr);gap:2px 20px;margin:14px 0 0}
dl.facets dt{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-top:10px}
dl.facets dd{margin:0;min-width:0}
@media (min-width:760px){dl.facets{grid-template-columns:170px minmax(0,1fr)}dl.facets dt{margin-top:6px}}
p.note{border-left:3px solid var(--sats);padding:2px 0 2px 12px;max-width:76ch}
.tablewrap{overflow-x:auto;margin:10px 0 0;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:15px}
th,td{text-align:left;vertical-align:top;padding:10px 14px 10px 0;border-bottom:1px solid var(--line)}
th{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
td.ep{min-width:15em}
.method{font:600 12px "JetBrains Mono",monospace;color:var(--sats)}
.via{font-size:14px;color:var(--muted)}
@media (max-width:719px){table.stack thead{position:absolute;left:-9999px}table.stack tr{display:block;border-bottom:1px solid var(--line);padding:10px 0}table.stack td{display:block;border:0;padding:3px 0;min-width:0}table.stack td[data-h]::before{content:attr(data-h);display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--faint)}}
.dec .choice{font-weight:600;margin:.2em 0 .5em}
.dec .trade{color:var(--muted)}
.flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:10px 0 18px;font:500 14px "JetBrains Mono",monospace}
.state{color:var(--ink);border-bottom:2px solid var(--accent);padding:2px 0}
.arrow{color:var(--faint)}
.enum{display:flex;flex-wrap:wrap;gap:4px 14px;font:13px "JetBrains Mono",monospace;color:var(--muted);margin:6px 0 0;padding:0;list-style:none}
.tbl{padding:22px 0;border-top:1px solid var(--line)}
td.col{font:500 14px "JetBrains Mono",monospace;overflow-wrap:anywhere}
td.st{overflow-wrap:normal;white-space:nowrap;font-size:13px}
td.type{font:13px "JetBrains Mono",monospace;color:var(--muted);overflow-wrap:anywhere}
details{margin:8px 0}
summary{cursor:pointer;font-weight:500;padding:6px 0}
summary::marker{color:var(--accent)}
ul.locs{list-style:none;margin:6px 0;padding:0}
ul.locs li{padding:2px 0;border-bottom:1px dashed var(--line);font-size:14px}
ul.locs summary{font-weight:400;overflow-wrap:anywhere}
ul.locs .label{color:var(--muted)}
.index-file{margin:6px 0}
.index-file h4{text-transform:none;letter-spacing:0;font-family:"JetBrains Mono",monospace;font-size:13px}
.index-file ul{list-style:none;padding:0 0 0 4px;margin:4px 0 10px}
.index-file li{padding:3px 0}
.index-file .doc{color:var(--muted);font-size:14px}
.foot{color:var(--muted);font-size:14px;border-top:1px solid var(--line);padding-top:16px;padding-bottom:40px}
#results{padding-top:18px}
.group{margin:0 0 26px}
.group h2{font-size:20px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;border-bottom:1px solid var(--line);padding-bottom:6px}
.group h2 .n{font:500 13px "Instrument Sans",sans-serif;color:var(--faint)}
ul.hits{list-style:none;margin:0;padding:0}
li.hit{padding:12px 0;border-bottom:1px solid var(--line)}
.hit-btn{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 12px;background:none;border:0;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer;width:100%}
.hit-title{font:600 16px "JetBrains Mono",monospace;color:var(--accent);overflow-wrap:anywhere}
.hit-title.prose{font:600 17px "Bricolage Grotesque","Instrument Sans",sans-serif}
.jump{display:flex;flex-wrap:wrap;gap:2px 16px;margin:0 0 18px;padding:0;list-style:none;font-size:14px}
.jump a{padding:4px 0}
.jump span{color:var(--faint)}
.hit-btn:hover .hit-title{text-decoration:underline;text-underline-offset:3px}
.hit-sub{font-size:13px;color:var(--muted)}
.hit-loc{font:12px "JetBrains Mono",monospace;color:var(--faint);overflow-wrap:anywhere}
.hit-sum{margin:4px 0 0;color:var(--ink);font-size:15px;max-width:80ch}
pre.snip{margin:6px 0 0;padding:8px 10px;background:var(--soft);border-left:2px solid var(--line);overflow-x:auto;font-size:13px;line-height:1.5;white-space:pre}
mark{background:var(--mark);color:inherit;border-radius:2px;padding:0 1px}
.more{background:none;border:0;padding:8px 0;color:var(--accent);font:500 15px "Instrument Sans",sans-serif;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.empty{color:var(--muted);padding:20px 0}
.ft-line{display:flex;gap:12px;align-items:baseline;padding:6px 0;border:0;border-bottom:1px dashed var(--line);width:100%;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit}
.ft-line:hover code{color:var(--accent)}
.ft-line .hit-loc{flex:none;width:17em;max-width:40%}
.ft-line code{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;min-width:0}
@media (max-width:600px){.ft-line{flex-direction:column;gap:2px}.ft-line .hit-loc{width:auto;max-width:none}}
dialog{border:1px solid var(--line);background:var(--bg);color:var(--ink);padding:14px 16px 24px;width:100%;max-width:100%;height:100%;max-height:100%;margin:0;overflow-y:auto}
dialog::backdrop{background:rgba(13,19,34,.45)}
@media (min-width:760px){dialog{width:min(900px,calc(100% - 64px));height:fit-content;max-height:calc(100% - 64px);margin:auto;padding:20px 28px 28px;border-radius:6px}}
.dlg-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.kicker{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}
.close{background:none;border:0;font-size:30px;line-height:1;color:var(--ink);cursor:pointer;padding:0 4px;min-width:44px;min-height:44px}
#dlg-title{font:600 clamp(19px,3vw,24px)/1.25 "JetBrains Mono",monospace;margin:4px 0 6px;overflow-wrap:anywhere}
.where{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font:13px "JetBrains Mono",monospace;color:var(--muted);margin-bottom:10px;overflow-wrap:anywhere}
.copy{background:none;border:1px solid var(--line);border-radius:4px;padding:4px 10px;font:500 12px "Instrument Sans",sans-serif;color:var(--ink);cursor:pointer}
.doc-c{color:var(--muted);font-style:italic;max-width:76ch}
pre.code{margin:12px 0;padding:10px 0;background:var(--soft);overflow-x:auto;font-size:13px;line-height:1.55}
pre.code .ln{display:block;padding:0 12px 0 0;white-space:pre}
pre.code .n{display:inline-block;width:4.2em;padding-right:12px;text-align:right;color:var(--faint);user-select:none}
pre.code .ln.focus{background:var(--accent-soft)}
.c{color:var(--faint);font-style:italic}.s{color:var(--accent)}.k{color:var(--sats)}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;
}

// Code exécuté dans le navigateur (sérialisé tel quel dans la page).
function clientApp(): void {
  const D: any = JSON.parse(document.getElementById("guide-data")!.textContent || "{}");
  const files: Record<string, string[]> = D.files;
  const entries: any[] = D.entries;
  const byId = new Map<string, any>(entries.map((e: any) => [e.id, e]));
  const C: any = D.content;
  const R: Record<string, string | null> = D.resolved;
  const SYN: Record<string, string[]> = C.synonyms || {};

  // Ordre d'affichage des groupes de résultats : le code d'abord, puis les explications
  const KIND: Record<string, [string, string, number]> = {
    fn: ["Fonctions, constantes et types", "code", 0],
    route: ["Routes API", "route API", 1],
    bitnob: ["Endpoints Bitnob", "endpoint Bitnob", 2],
    webhook: ["Webhooks Bitnob", "webhook Bitnob", 3],
    page: ["Écrans", "écran", 4],
    feature: ["Fonctionnalités", "fonctionnalité", 5],
    decision: ["Décisions", "décision", 6],
    event: ["Événements du journal", "événement du journal", 7],
    table: ["Tables", "table SQL", 8],
    col: ["Colonnes", "colonne SQL", 9],
    enum: ["Énumérations SQL", "énumération SQL", 10],
    env: ["Variables d'environnement", "variable d'environnement", 11],
    test: ["Tests", "test", 12],
    code: ["Extraits cités", "extrait", 13],
  };

  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = (f: string) => f.split("/").pop() || f;
  const locText = (e: any) => (e.file ? `${e.file}:${e.line}${e.end && e.end !== e.line ? "–" + e.end : ""}` : "");
  const short = (e: any) => (e.file ? `${base(e.file)}:${e.line}` : "");
  const el = (id: string) => document.getElementById(id) as HTMLElement;

  // ---------- Coloration minimale ----------
  const KW = "export|default|async|function|const|let|return|await|if|else|try|catch|throw|import|from|type|new|for|of|in|class|extends|case|switch";
  const SQLKW = "SELECT|INSERT|INTO|UPDATE|SET|WHERE|FROM|CREATE|TABLE|ALTER|ADD|COLUMN|VALUES|RETURNING|AND|OR|NOT|NULL|JOIN|LEFT|ON|FOR|SKIP|LOCKED|UNIQUE|PRIMARY|KEY|REFERENCES|DEFAULT|CHECK|INDEX|TYPE|ENUM|ENABLE|ROW|LEVEL|SECURITY|LIMIT|ORDER|BY|DESC|IN|IS|CONFLICT|DO|NOTHING|TRIGGER|BEFORE|EACH";
  const RE_SQL = new RegExp("(--.*$)|('(?:[^'\\\\]|\\\\.)*')|\\b(" + SQLKW + ")\\b", "g");
  const RE_TS = new RegExp("(\\/\\/.*$)|(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`?)|\\b(" + KW + "|" + SQLKW + ")\\b", "g");
  function hl(line: string, sql: boolean): string {
    const re = sql ? RE_SQL : RE_TS;
    re.lastIndex = 0;
    let out = "", last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (!m[0]) { re.lastIndex++; continue; }
      out += esc(line.slice(last, m.index));
      const cls = m[1] ? "c" : m[2] ? "s" : "k";
      out += `<span class="${cls}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(line.slice(last));
  }
  function codeBlock(file: string, from: number, to: number, focus: [number, number] | null): string {
    const lines = files[file] || [];
    const a = Math.max(1, from), b = Math.min(lines.length, to);
    const sql = file.endsWith(".sql");
    let html = "";
    for (let i = a; i <= b; i++) {
      const f = focus && i >= focus[0] && i <= focus[1];
      html += `<span class="ln${f ? " focus" : ""}"><span class="n">${i}</span>${hl(lines[i - 1], sql) || " "}</span>`;
    }
    return `<pre class="code" tabindex="0" aria-label="${esc(file)}, lignes ${a} à ${b}">${html}</pre>`;
  }

  // ---------- Recherche ----------
  type Term = { lit: string; alts: string[] };
  function terms(q: string): Term[] {
    return norm(q).split(/\s+/).filter((t) => t.length > 0).map((t) => ({ lit: t, alts: [t, ...(SYN[t] || []).map(norm)] }));
  }
  const hay = new Map<string, { title: string; all: string }>();
  for (const e of entries) {
    hay.set(e.id, {
      title: norm(e.title || ""),
      all: norm([e.title, e.sub, e.id, e.file, e.doc, e.summary, (e.keywords || []).join(" ")].join(" ")),
    });
  }
  function score(e: any, ts: Term[]): number {
    const h = hay.get(e.id)!;
    let total = 0;
    for (const t of ts) {
      let best = 0;
      for (const a of t.alts) {
        const w = a === t.lit ? 1 : 0.5;
        let s = 0;
        if (h.title === a) s = 30;
        else if (h.title.startsWith(a)) s = 16;
        else if (h.title.includes(a)) s = 10;
        else if (h.all.includes(a)) s = 2;
        best = Math.max(best, s * w);
      }
      if (best === 0) return 0;
      total += best;
    }
    return total + (e.exported ? 0.5 : 0);
  }
  let fullText: { f: string; i: number; n: string }[] | null = null;
  function ftIndex() {
    if (!fullText) {
      const out: { f: string; i: number; n: string }[] = [];
      for (const f of Object.keys(files)) files[f].forEach((l, i) => out.push({ f, i, n: norm(l) }));
      fullText = out;
    }
    return fullText;
  }
  function markText(text: string, ts: { alts: string[] }[]): string {
    const words = ts.flatMap((t) => t.alts).filter((w) => w.length > 1).sort((a, b) => b.length - a.length);
    if (!words.length) return esc(text);
    const n = norm(text);
    if (n.length !== text.length) return esc(text); // décalage d'index après normalisation : pas de surlignage
    const re = new RegExp(words.map(reEsc).join("|"), "g");
    let out = "", last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(n))) {
      if (!m[0]) { re.lastIndex++; continue; }
      out += esc(text.slice(last, m.index)) + "<mark>" + esc(text.slice(m.index, m.index + m[0].length)) + "</mark>";
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }
  function snippetLines(e: any): [string, number, number] | null {
    const file = e.file || (e.locs && e.locs[0] && e.locs[0].file);
    const line = e.line || (e.locs && e.locs[0] && e.locs[0].line);
    if (!file || !line || !files[file]) return null;
    return [file, line, Math.min(e.end || line, line + 2)];
  }

  const resultsEl = el("results"), sectionsEl = el("sections"), countEl = el("count"), qEl = el("q") as HTMLInputElement;
  const tocEl = el("toc");
  const expanded = new Set<string>();

  function runSearch(q: string) {
    const ts = terms(q);
    document.body.classList.toggle("has-q", !!q.trim());
    if (!q.trim() || !ts.length) {
      resultsEl.hidden = true; resultsEl.innerHTML = ""; sectionsEl.hidden = false; tocEl.hidden = false; countEl.textContent = "";
      return;
    }
    const scored = new Map<string, number>();
    for (const e of entries) { const s = score(e, ts); if (s > 0) scored.set(e.id, s); }
    const groups = new Map<string, any[]>();
    for (const e of entries) {
      if (!scored.has(e.id)) continue;
      if (!groups.has(e.kind)) groups.set(e.kind, []);
      groups.get(e.kind)!.push(e);
    }
    for (const [, list] of groups) list.sort((a, b) => scored.get(b.id)! - scored.get(a.id)! || a.title.localeCompare(b.title));

    const lits = ts.map((t) => t.lit).filter((t) => t.length >= 2);
    const ft = lits.length ? ftIndex().filter((x) => lits.every((t) => x.n.includes(t))) : [];

    const ordered = [...groups].sort((a, b) => KIND[a[0]][2] - KIND[b[0]][2]);
    let html = `<ul class="jump" aria-label="Aller à un groupe">${ordered.map(([k, l]) => `<li><a href="#g-${k}" data-jump="g-${k}">${esc(KIND[k][0])}</a> <span>${l.length}</span></li>`).join("")}${ft.length ? `<li><a href="#g-__ft" data-jump="g-__ft">Lignes de code</a> <span>${ft.length}</span></li>` : ""}</ul>`;
    for (const [kind, list] of ordered) {
      const lim = expanded.has(kind) ? list.length : kind === "fn" ? 12 : 8;
      html += `<div class="group" id="g-${kind}"><h2>${esc(KIND[kind][0])} <span class="n">${list.length}</span></h2><ul class="hits">`;
      for (const e of list.slice(0, lim)) html += hitHtml(e, ts);
      html += `</ul>${list.length > lim ? `<button type="button" class="more" data-more="${kind}">Afficher les ${list.length - lim} autres</button>` : ""}</div>`;
    }
    if (ft.length) {
      const lim = expanded.has("__ft") ? ft.length : 40;
      html += `<div class="group" id="g-__ft"><h2>Toutes les lignes contenant « ${esc(lits.join(" "))} » <span class="n">${ft.length}</span></h2>`;
      for (const x of ft.slice(0, lim)) {
        html += `<button type="button" class="ft-line" data-loc="${esc(x.f)}#${x.i + 1}"><span class="hit-loc">${esc(x.f)}:${x.i + 1}</span><code>${markText(files[x.f][x.i].trim(), lits.map((t) => ({ alts: [t] })))}</code></button>`;
      }
      html += `${ft.length > lim ? `<button type="button" class="more" data-more="__ft">Afficher les ${ft.length - lim} autres lignes</button>` : ""}</div>`;
    }
    if (!scored.size && !ft.length) html = `<p class="empty">Rien trouvé pour « ${esc(q)} ». Essayez un nom de fonction, de table, ou un mot comme <em>facture</em>.</p>`;
    resultsEl.innerHTML = html;
    resultsEl.hidden = false; sectionsEl.hidden = true; tocEl.hidden = true;
    countEl.textContent = `${scored.size} élément${scored.size > 1 ? "s" : ""} et ${ft.length} ligne${ft.length > 1 ? "s" : ""} de code pour « ${q.trim()} »`;
  }

  function hitHtml(e: any, ts: Term[]): string {
    const sn = snippetLines(e);
    const kindLabel = e.sub || KIND[e.kind][1];
    const sum = e.summary || e.doc || "";
    const target = e.kind === "feature" ? `data-goto="f-${esc(e.id.slice(8))}"` : e.kind === "decision" ? `data-goto="d-${esc(e.id.slice(9))}"` : `data-id="${esc(e.id)}"`;
    const snip = sn ? `<pre class="snip">${files[sn[0]].slice(sn[1] - 1, sn[2]).map((l) => markText(l, ts)).join("\n")}</pre>` : "";
    return `<li class="hit"><button type="button" class="hit-btn" ${target}><span class="hit-title${e.kind === "feature" || e.kind === "decision" ? " prose" : ""}">${markText(e.title, ts)}</span><span class="hit-sub">${esc(kindLabel)}</span>${e.file ? `<span class="hit-loc">${esc(e.file)}:${e.line}</span>` : ""}</button>${sum ? `<p class="hit-sum">${markText(sum, ts)}</p>` : ""}${snip}</li>`;
  }

  // ---------- Références ----------
  function refHtml(ref: string): string {
    const id = R[ref] === undefined ? (byId.has(ref) ? ref : null) : R[ref];
    const e = id ? byId.get(id) : null;
    if (!e) return `<span class="ref missing" title="Introuvable dans le code actuel">${esc(ref.replace(/^\w+:/, ""))}</span>`;
    let label = e.title;
    if (e.kind === "code") label = e.title.length > 42 ? e.title.slice(0, 40) + "…" : e.title;
    if (e.kind === "test") label = `test « ${e.title.length > 40 ? e.title.slice(0, 38) + "…" : e.title} »`;
    return `<button type="button" class="ref" data-id="${esc(e.id)}">${esc(label)}${e.file ? `<span class="loc">${esc(short(e))}</span>` : ""}</button>`;
  }
  const refsHtml = (refs: string[] | undefined) => (refs && refs.length ? `<div class="refs">${refs.map(refHtml).join("")}</div>` : `<span class="via">—</span>`);

  // ---------- Dialogue de détail ----------
  const dlg = el("dlg") as HTMLDialogElement;
  function locList(locs: any[]): string {
    return `<ul class="locs">${locs.map((l) => `<li><details><summary><span class="mono">${esc(l.file)}:${l.line}</span> <span class="label">${esc(l.label || "")}</span></summary>${codeBlock(l.file, l.line - 4, l.line + 6, [l.line, l.line])}</details></li>`).join("")}</ul>`;
  }
  function usages(e: any): any[] {
    if (e.usedBy) return e.usedBy;
    const name: string = e.name;
    if (!name || name.length < 3) return [];
    const re = new RegExp("(^|[^\\w$])" + reEsc(name) + "(?![\\w$])");
    const own = new Set((e.locs || []).map((l: any) => l.file + "#" + l.line));
    const out: any[] = [];
    for (const f of Object.keys(files)) {
      files[f].forEach((l, i) => {
        if (out.length >= 50 || !re.test(l)) return;
        if (f === e.file && i + 1 >= e.line && i + 1 <= (e.end || e.line)) return;
        if (own.has(f + "#" + (i + 1))) return;
        out.push({ file: f, line: i + 1, label: "" });
      });
    }
    return out;
  }
  // Fonctions « enveloppes » qui appellent un endpoint Bitnob (ex. createInvoice)
  function bitnobWrappers(e: any): string[] {
    const names = new Set<string>();
    for (const l of (e && e.locs) || []) {
      const m = /^appel · dans (\w+)$/.exec(l.label || "");
      if (m && byId.has("fn:" + m[1])) names.add(m[1]);
    }
    return [...names];
  }
  function openEntry(id: string, push = true) {
    const e = byId.get(id);
    if (!e) return;
    el("dlg-kicker").textContent = e.sub && e.kind !== "fn" ? `${KIND[e.kind][1]} · ${e.sub}` : e.sub || KIND[e.kind][1];
    el("dlg-title").textContent = e.title;
    let b = "";
    if (e.file) b += `<div class="where"><span>${esc(locText(e))}</span><button type="button" class="copy" data-copy="${esc(e.file + ":" + e.line)}">Copier</button></div>`;
    if (e.summary) b += `<p>${esc(e.summary)}</p>`;
    if (e.doc && e.doc !== e.summary) b += `<p class="doc-c">Commentaire dans le code : ${esc(e.doc)}</p>`;
    if (e.file) {
      const ctx = e.kind === "code" || e.kind === "col" || e.kind === "env" || e.kind === "event" || e.kind === "bitnob" || e.kind === "webhook";
      const end = e.end || e.line;
      const to = Math.min(end, e.line + 59);
      b += ctx ? codeBlock(e.file, e.line - 4, e.line + 6, [e.line, e.line]) : codeBlock(e.file, e.line, to, [e.line, e.line]);
      if (!ctx && to < end) b += `<p class="via">… ${end - to} lignes de plus dans ${esc(e.file)}</p>`;
    }
    if (e.kind === "fn") {
      const eps = entries.filter((x) => x.kind === "bitnob" && bitnobWrappers(x).includes(e.title));
      if (eps.length) b += `<h4>Endpoint Bitnob appelé</h4><div class="refs">${eps.map((x) => refHtml(x.id)).join("")}</div>`;
    }
    if (e.kind === "bitnob") {
      const w = bitnobWrappers(e);
      if (w.length) b += `<h4>Fonction qui appelle cet endpoint</h4><div class="refs">${w.map((n) => refHtml("fn:" + n)).join("")}</div>`;
    }
    const heading: Record<string, string> = { bitnob: "Appels dans le code", table: "Migrations et accès SQL", event: "Écrit et affiché ici", route: "Appelée depuis", env: "Lue ici", webhook: "Mentionné ici" };
    if (e.locs && e.locs.length) b += `<h4>${heading[e.kind] || "Emplacements"} (${e.locs.length})</h4>${locList(e.locs)}`;
    const u = usages(e);
    if (u.length) b += `<h4>${e.usedBy ? "Utilisé par" : "Autres mentions dans le code"} (${u.length}${u.length >= 50 ? "+" : ""})</h4>${locList(u)}`;
    el("dlg-body").innerHTML = b;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    if (push) setHash({ e: id });
  }
  function openLoc(file: string, line: number) {
    el("dlg-kicker").textContent = "ligne de code";
    el("dlg-title").textContent = `${file}:${line}`;
    el("dlg-body").innerHTML = `<div class="where"><button type="button" class="copy" data-copy="${esc(file + ":" + line)}">Copier ${esc(base(file))}:${line}</button></div>${codeBlock(file, line - 10, line + 14, [line, line])}`;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }
  el("dlg-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => setHash({ e: null }));

  // ---------- Sections ----------
  function sectionFeatures(): string {
    let h = `<section class="block" id="fonctionnalites" aria-labelledby="h-f"><h2 id="h-f">Fonctionnalités</h2><p class="intro">Pour chaque fonctionnalité : le parcours dans le code étape par étape, puis ses écrans, routes, fonctions clés, endpoints Bitnob et données. Cliquez sur un nom pour voir l'extrait et tous ses usages.</p><ul class="featnav">`;
    h += C.features.map((f: any) => `<li><a href="#f-${esc(f.id)}">${esc(f.title)}</a></li>`).join("") + "</ul>";
    for (const f of C.features) {
      h += `<article class="feat" id="f-${esc(f.id)}"><h3>${esc(f.title)}</h3><p class="sum">${esc(f.summary)}</p>`;
      h += `<h4>Parcours</h4><ol class="steps">${f.steps.map((s: any) => `<li>${esc(s.text)}${refsHtml(s.refs)}</li>`).join("")}</ol>`;
      if (f.notes) h += f.notes.map((n: string) => `<p class="note">${esc(n)}</p>`).join("") + (f.noteRefs ? refsHtml(f.noteRefs) : "");
      const facet = (label: string, refs: string[]) => (refs && refs.length ? `<dt>${label}</dt><dd>${refsHtml(refs)}</dd>` : "");
      h += `<dl class="facets">${facet("Écrans", f.screens)}${facet("Routes API", f.routes)}${facet("Fonctions clés", f.functions)}${facet("Endpoints Bitnob", f.bitnob)}${facet("Données", f.tables)}</dl></article>`;
    }
    return h + "</section>";
  }
  function sectionBitnob(): string {
    let h = `<section class="block" id="api-bitnob" aria-labelledby="h-b"><h2 id="h-b">API Bitnob utilisées</h2><p class="intro">Tous les appels passent par <code>bitnob()</code> dans <code>src/lib/bitnob.ts</code>, signés en HMAC-SHA256. La colonne « Où » est extraite du code à chaque génération : la fonction qui appelle l'endpoint, puis celles qui s'en servent.</p>`;
    h += `<div class="tablewrap"><table class="stack"><thead><tr><th scope="col">Endpoint</th><th scope="col">Où</th><th scope="col">Pourquoi</th></tr></thead><tbody>`;
    for (const a of C.bitnobApis) {
      const e = byId.get(`bitnob:${a.method} ${a.path}`);
      const locs = (e && e.locs) || [];
      let where = "";
      for (const w of bitnobWrappers(e)) {
        const fe = byId.get("fn:" + w);
        const users = [...new Set(((fe && fe.usedBy) || []).filter((u: any) => u.label.startsWith("dans ")).map((u: any) => u.label.slice(5)))] as string[];
        where += `<div>${refHtml("fn:" + w)}${users.length ? `<span class="via">← ${users.slice(0, 5).map(esc).join(", ")}${users.length > 5 ? "…" : ""}</span>` : ""}</div>`;
      }
      const others = locs.filter((l: any) => !l.label.startsWith("appel"));
      if (others.length) where += `<div class="via">${others.map((l: any) => `${esc(l.label.split(" ·")[0])} ${esc(base(l.file))}:${l.line}`).join(" · ")}</div>`;
      if (!locs.length) where = `<span class="via">non appelé dans le code actuel</span>`;
      h += `<tr><td class="ep" data-h="Endpoint">${e ? `<button type="button" class="ref" data-id="${esc(e.id)}"><span class="method">${esc(a.method)}</span>${esc(a.path)}</button>` : esc(a.method + " " + a.path)}</td><td data-h="Où">${where}</td><td data-h="Pourquoi">${esc(a.why)}</td></tr>`;
    }
    h += `</tbody></table></div><h3 style="margin-top:32px">Webhooks reçus</h3><p class="intro">Reçus sur <code>POST /api/webhooks/bitnob</code>, signés en HMAC-SHA512 (<code>x-bitnob-signature</code>), dédupliqués par <code>event_id</code>. Le corps ne fait que déclencher une relecture chez Bitnob.</p>`;
    h += `<div class="tablewrap"><table class="stack"><thead><tr><th scope="col">Événement</th><th scope="col">Signification</th><th scope="col">Traitement</th></tr></thead><tbody>`;
    for (const w of C.webhooks) {
      h += `<tr><td class="ep" data-h="Événement"><button type="button" class="ref" data-id="webhook:${esc(w.event)}">${esc(w.event)}</button></td><td data-h="Signification">${esc(w.why)}</td><td data-h="Traitement">${esc(w.handling)}${refsHtml(w.refs)}</td></tr>`;
    }
    return h + `</tbody></table></div></section>`;
  }
  function sectionDecisions(): string {
    let h = `<section class="block" id="decisions" aria-labelledby="h-d"><h2 id="h-d">Décisions</h2><p class="intro">Les choix qui expliquent la forme du code, et ce qu'ils coûtent.</p>`;
    C.decisions.forEach((d: any, i: number) => {
      h += `<article class="dec" id="d-${i}"><h3>${esc(d.title)}</h3><p class="choice">${esc(d.choice)}</p><p>${esc(d.why)}</p>${d.tradeoff ? `<p class="trade">${esc(d.tradeoff)}</p>` : ""}${refsHtml(d.refs)}</article>`;
    });
    return h + "</section>";
  }
  function sectionData(): string {
    const st = C.states;
    let h = `<section class="block" id="donnees" aria-labelledby="h-m"><h2 id="h-m">Modèle de données</h2><p class="intro">Postgres (Supabase), schéma défini par les migrations de <code>migrations/</code>. Montants en <code>BIGINT</code> (sats et FCFA entiers). RLS activé sans politique : seul le serveur, connecté directement à Postgres, lit et écrit.</p>`;
    const en = byId.get("enum:transfer_status");
    h += `<h3>Machine à états d'un transfert</h3>`;
    if (en) h += `<p class="via">Énumération ${refHtml("enum:transfer_status")}</p><ul class="enum">${String(en.summary).split(" · ").map((v: string) => `<li>${esc(v)}</li>`).join("")}</ul>`;
    h += `<p style="margin:16px 0 0">Parcours nominal :</p><div class="flow">${st.happyPath.map((s: string, i: number) => `${i ? '<span class="arrow" aria-hidden="true">→</span>' : ""}<span class="state">${esc(s)}</span>`).join("")}</div>`;
    h += `<div class="tablewrap"><table class="stack"><thead><tr><th scope="col">De</th><th scope="col">Vers</th><th scope="col">Quand</th><th scope="col">Par</th></tr></thead><tbody>`;
    for (const t of st.transitions) h += `<tr><td class="col st" data-h="De">${esc(t.from)}</td><td class="col st" data-h="Vers">${esc(t.to)}</td><td data-h="Quand">${esc(t.when)}</td><td data-h="Par">${refHtml(t.by)}</td></tr>`;
    h += `</tbody></table></div>${st.notes.map((n: string) => `<p class="note">${esc(n)}</p>`).join("")}`;
    for (const t of entries.filter((e) => e.kind === "table")) {
      const cols = entries.filter((e) => e.kind === "col" && e.title.startsWith(t.title + "."));
      const mig = (t.locs || []).filter((l: any) => l.file.startsWith("migrations/"));
      const acc = (t.locs || []).filter((l: any) => !l.file.startsWith("migrations/"));
      h += `<div class="tbl" id="t-${esc(t.title)}"><h3>${refHtml(t.id)}</h3>${t.doc ? `<p class="sum">${esc(t.doc)}</p>` : ""}`;
      h += `<div class="tablewrap"><table class="stack"><thead><tr><th scope="col">Colonne</th><th scope="col">Type</th><th scope="col">Commentaire</th><th scope="col">Définie</th></tr></thead><tbody>`;
      for (const c of cols) h += `<tr><td class="col" data-h="Colonne">${esc(c.title.slice(t.title.length + 1))}</td><td class="type" data-h="Type">${esc(c.sub)}</td><td data-h="Commentaire">${esc(c.doc || "")}</td><td data-h="Définie"><button type="button" class="ref" data-id="${esc(c.id)}">${esc(short(c))}</button></td></tr>`;
      h += `</tbody></table></div>`;
      if (mig.length) h += `<details><summary>Évolutions dans les migrations (${mig.length})</summary>${locList(mig)}</details>`;
      if (acc.length) h += `<details><summary>Lu et écrit dans le code (${acc.length})</summary>${locList(acc)}</details>`;
      h += `</div>`;
    }
    return h + "</section>";
  }
  function sectionIndex(): string {
    const by = (k: string) => entries.filter((e) => e.kind === k);
    let h = `<section class="block" id="index" aria-labelledby="h-i"><h2 id="h-i">Index complet</h2><p class="intro">Tout ce que le générateur a extrait du code. Les numéros de ligne sont ceux de la dernière génération.</p>`;
    const routes = by("route").sort((a, b) => a.title.split(" ")[1].localeCompare(b.title.split(" ")[1]));
    h += `<details open><summary>Routes API (${routes.length})</summary><div class="tablewrap"><table class="stack"><tbody>${routes.map((r) => `<tr><td class="ep" data-h="Route">${refHtml(r.id)}</td><td data-h="Rôle">${esc(r.summary || r.doc || "")}</td></tr>`).join("")}</tbody></table></div></details>`;
    h += `<details><summary>Écrans (${by("page").length})</summary><div class="tablewrap"><table class="stack"><tbody>${by("page").map((p) => `<tr><td class="ep" data-h="URL">${refHtml(p.id)}</td><td data-h="Rôle">${esc(p.doc || "")}</td></tr>`).join("")}</tbody></table></div></details>`;
    const fns = by("fn");
    const fileSet = [...new Set(fns.map((e) => e.file as string))].sort();
    h += `<details><summary>Fonctions, constantes et types, par fichier (${fns.length})</summary>`;
    for (const f of fileSet) {
      const list = fns.filter((e) => e.file === f).sort((a, b) => a.line - b.line);
      h += `<div class="index-file"><h4>${esc(f)}</h4><ul>${list.map((e) => `<li>${refHtml(e.id)} <span class="via">${esc(e.sub)}</span>${e.summary || e.doc ? `<div class="doc">${esc(e.summary || e.doc)}</div>` : ""}</li>`).join("")}</ul></div>`;
    }
    h += `</details>`;
    h += `<details><summary>Événements du journal (${by("event").length})</summary><div class="tablewrap"><table class="stack"><tbody>${by("event").map((e) => `<tr><td class="ep" data-h="Événement">${refHtml(e.id)}</td><td data-h="Libellé">${esc(e.summary || "")}</td><td data-h="Écrit dans" class="via">${[...new Set((e.locs || []).filter((l: any) => l.label.startsWith("écrit")).map((l: any) => l.label.replace(/^.*dans /, "")))].map(esc).join(", ")}</td></tr>`).join("")}</tbody></table></div></details>`;
    h += `<details><summary>Variables d'environnement (${by("env").length})</summary><div class="refs">${by("env").map((e) => refHtml(e.id)).join("")}</div></details>`;
    const tests = by("test");
    h += `<details><summary>Tests (${tests.length})</summary>${[...new Set(tests.map((t) => t.file as string))].map((f) => `<div class="index-file"><h4>${esc(f)}</h4><ul>${tests.filter((t) => t.file === f).map((t) => `<li><button type="button" class="ref" data-id="${esc(t.id)}">${esc(t.title)}<span class="loc">:${t.line}</span></button> <span class="via">${esc((t.sub || "").replace(/^test · /, ""))}</span></li>`).join("")}</ul></div>`).join("")}</details>`;
    return h + "</section>";
  }

  sectionsEl.innerHTML = sectionFeatures() + sectionBitnob() + sectionDecisions() + sectionData() + sectionIndex();

  const meta = D.meta;
  const when = new Date(meta.generatedAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
  const nb = (k: string) => entries.filter((e) => e.kind === k).length;
  el("meta").textContent = `Généré le ${when} · branche ${meta.branch || "?"} @ ${meta.commit || "?"}${meta.dirty ? " + modifications locales" : ""} · ${nb("route")} routes, ${nb("page")} écrans, ${nb("fn")} fonctions et types, ${nb("table")} tables`;

  const SUGG = ["invoice", "payout", "webhook", "preimage", "cagnotte", "verrou", "remboursement", "owner_token", "cotation"];
  el("suggest").innerHTML = `<span>Exemples :</span>` + SUGG.map((s) => `<button type="button" data-q="${s}">${s}</button>`).join("");

  // ---------- Adresse (#q=…&e=…) et événements ----------
  function readHash(): URLSearchParams {
    const h = location.hash.slice(1);
    return new URLSearchParams(/^(q|e)=/.test(h) || h.includes("&") ? h : "");
  }
  function setHash(p: Record<string, string | null>) {
    const h = readHash();
    for (const [k, v] of Object.entries(p)) { if (v) h.set(k, v); else h.delete(k); }
    const s = h.toString();
    history.replaceState(null, "", s ? "#" + s : location.pathname + location.search);
  }
  let timer = 0;
  qEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => { expanded.clear(); runSearch(qEl.value); setHash({ q: qEl.value.trim() || null }); }, 60);
  });
  qEl.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { qEl.value = ""; runSearch(""); setHash({ q: null }); } });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "/" && document.activeElement !== qEl && !dlg.open) { ev.preventDefault(); qEl.focus(); qEl.select(); }
  });
  function goto(anchor: string) {
    if (dlg.open) dlg.close();
    qEl.value = ""; runSearch(""); setHash({ q: null });
    const target = document.getElementById(anchor);
    if (target) { target.setAttribute("tabindex", "-1"); target.scrollIntoView({ block: "start" }); target.focus({ preventScroll: true }); }
  }
  document.addEventListener("click", (ev) => {
    const t = (ev.target as HTMLElement).closest("[data-id],[data-goto],[data-q],[data-more],[data-loc],[data-copy],[data-jump]") as HTMLElement | null;
    if (!t) return;
    const d = t.dataset;
    if (d.jump) { ev.preventDefault(); document.getElementById(d.jump)?.scrollIntoView({ block: "start" }); return; }
    if (d.copy) { navigator.clipboard?.writeText(d.copy).then(() => { t.textContent = "Copié"; }).catch(() => {}); return; }
    if (d.q) { qEl.value = d.q; expanded.clear(); runSearch(qEl.value); setHash({ q: qEl.value }); return; }
    if (d.more) { expanded.add(d.more); runSearch(qEl.value); return; }
    if (d.loc) { const [f, l] = d.loc.split("#"); openLoc(f, Number(l)); return; }
    if (d.goto) { goto(d.goto); return; }
    if (d.id) {
      const e = byId.get(d.id);
      if (e && e.kind === "feature") return goto("f-" + e.id.slice(8));
      if (e && e.kind === "decision") return goto("d-" + e.id.slice(9));
      openEntry(d.id);
    }
  });

  function applyHash() {
    const h = readHash();
    const q = h.get("q") || "";
    if (q !== qEl.value) { qEl.value = q; expanded.clear(); runSearch(q); }
    const e = h.get("e");
    if (e) openEntry(e, false);
  }
  window.addEventListener("hashchange", applyHash);
  applyHash();
}
