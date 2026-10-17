// Affiche les champs requis par Bitnob pour un pays de payout. Usage : npx tsx scripts/show-country.ts SN
import { config } from "dotenv";
config({ path: ".env.local" });
const { bitnob } = await import("../src/lib/bitnob");

const country = process.argv[2] ?? "SN";
const only = process.argv[3]; // ex. mobile_money
const data = await bitnob<any>("GET", `/api/payouts/supported-countries/${country}`);

function printFields(fields: any[], indent: string) {
  for (const f of fields ?? []) {
    const opts = (f.options ?? []).map((o: any) => o.value).join("|");
    console.log(`${indent}- ${f.key} [${f.type}]${f.required ? " (requis)" : ""}${f.pattern ? ` pattern=${f.pattern}` : ""}${opts ? ` options=${opts.slice(0, 200)}` : ""}`);
    printFields(f.fields, indent + "    ");
    for (const [k, v] of Object.entries<any>(f.variants ?? {})) {
      console.log(`${indent}    variante ${k}:`);
      printFields(v.fields ?? v, indent + "        ");
    }
  }
}

for (const [type, def] of Object.entries<any>(data.destination_types ?? {})) {
  if (only && type !== only) continue;
  console.log(`\n== ${type}`);
  printFields(def.fields, "");
}
const rest = { ...data };
delete rest.destination_types;
console.log("\nAutres infos :", JSON.stringify(rest, null, 2));
