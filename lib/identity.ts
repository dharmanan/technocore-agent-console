export type StoredIdentity = {
  did: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  createdAt: string;
};

const STORAGE_KEY = "technocore-agent-console.identity.v1";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base58btc(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let output = "";
  while (value > 0n) {
    const mod = Number(value % 58n);
    output = BASE58[mod] + output;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    output = "1" + output;
  }
  return output || "1";
}

function didFromJwk(publicKeyJwk: JsonWebKey): string {
  if (!publicKeyJwk.x) throw new Error("Public key is missing x coordinate.");
  const raw = fromBase64Url(publicKeyJwk.x);
  const multicodec = new Uint8Array(2 + raw.length);
  multicodec[0] = 0xed;
  multicodec[1] = 0x01;
  multicodec.set(raw, 2);
  return `did:key:z${base58btc(multicodec)}`;
}

export async function createIdentity(): Promise<StoredIdentity> {
  if (!crypto.subtle) throw new Error("WebCrypto is unavailable in this browser.");
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const identity = {
    did: didFromJwk(publicKeyJwk),
    publicKeyJwk,
    privateKeyJwk,
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function loadIdentity(): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredIdentity) : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: StoredIdentity) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function signText(privateKeyJwk: JsonWebKey, canonical: string): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateKeyJwk, { name: "Ed25519" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(canonical));
  const bytes = new Uint8Array(signature);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function exportIdentity(identity: StoredIdentity) {
  const blob = new Blob([JSON.stringify(identity, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `technocore-${identity.did.slice(-10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
