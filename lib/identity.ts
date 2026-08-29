export type StoredIdentity = {
  did: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  createdAt: string;
  profile?: {
    agentName: string;
    mailbox: string;
    verifiedAt?: string;
  };
};

const STORAGE_KEY = "technocore-agent-console.identity.v1";
const IDENTITY_EVENT = "technocore-identity-changed";
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

function broadcastIdentityChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(IDENTITY_EVENT));
}

export async function createIdentity(): Promise<StoredIdentity> {
  if (!crypto.subtle) throw new Error("WebCrypto is unavailable in this browser.");
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const identity: StoredIdentity = {
    did: didFromJwk(publicKeyJwk),
    publicKeyJwk,
    privateKeyJwk,
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  broadcastIdentityChange();
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
  broadcastIdentityChange();
}

export function withIdentityProfile(identity: StoredIdentity, agentName: string, mailbox: string): StoredIdentity {
  const next: StoredIdentity = {
    ...identity,
    profile: {
      agentName,
      mailbox,
      verifiedAt: new Date().toISOString(),
    },
  };
  saveIdentity(next);
  return next;
}

export function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
  broadcastIdentityChange();
}

export function identityChangeEventName() {
  return IDENTITY_EVENT;
}

export async function signText(privateKeyJwk: JsonWebKey, canonical: string): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateKeyJwk, { name: "Ed25519" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(canonical));
  const bytes = new Uint8Array(signature);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function exportPayload(identity: StoredIdentity): StoredIdentity {
  if (identity.profile) return identity;
  if (typeof window === "undefined") return identity;

  const profileConfirmed = localStorage.getItem(`technocore-agent-console.progress.${identity.did}.profile`) === "true";
  const agentName = localStorage.getItem("technocore-agent-console.agentName")?.trim() || "";
  const mailbox = localStorage.getItem("technocore-agent-console.mailbox")?.trim() || "";

  if (!profileConfirmed || !agentName || !mailbox) return identity;

  const enriched: StoredIdentity = {
    ...identity,
    profile: {
      agentName,
      mailbox,
      verifiedAt: new Date().toISOString(),
    },
  };
  saveIdentity(enriched);
  return enriched;
}

export function exportIdentity(identity: StoredIdentity) {
  const payload = exportPayload(identity);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const safeAgent = payload.profile?.agentName?.replace(/[^a-z0-9_-]/gi, "_");
  anchor.download = safeAgent
    ? `technocore-agent-${safeAgent}.json`
    : `technocore-identity-key-${payload.did.slice(-10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
