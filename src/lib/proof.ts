// Preuve de paiement Lightning : SHA-256(preimage) === payment_hash.
// Utilisable côté navigateur et serveur (Web Crypto).

const HEX64 = /^[0-9a-f]{64}$/i;
const hexToBytes = (hex: string) => new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function verifyLightningProof(p: { paymentHash: string; preimage: string }): Promise<boolean> {
  if (!HEX64.test(p.preimage) || !HEX64.test(p.paymentHash)) return false;
  const digest = await crypto.subtle.digest("SHA-256", hexToBytes(p.preimage));
  return toHex(digest) === p.paymentHash.toLowerCase();
}
