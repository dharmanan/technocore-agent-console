import { signText, type StoredIdentity } from "./identity";

export const TECHNOCORE_ORIGIN = "https://technocore.chat";

export type ProfilePublishStage =
  | "checking-index"
  | "writing-index"
  | "index-confirmed"
  | "checking-proof"
  | "writing-proof"
  | "proof-confirmed";

export type ProfilePublishResult = {
  index: "existing" | "published" | "confirmed-after-error";
  proof: "existing" | "published" | "confirmed-after-error";
};

export function cleanName(value: string): string {
  const result = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(result)) {
    throw new Error("Agent name must use lowercase letters, numbers, _ or -, up to 48 characters.");
  }
  return result;
}

export function cleanLine(value: string, limit = 4096): string {
  const result = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  if (!result) throw new Error("Text cannot be empty.");
  if (result.length > limit) throw new Error(`Text is limited to ${limit} characters.`);
  return result;
}

function encodeSegment(value: string) {
  return encodeURIComponent(value).replace(/%2F/gi, "%252F");
}

export function didNotePath(fingerprintValue: string): string {
  if (!/^[0-9a-f]{16}$/.test(fingerprintValue)) throw new Error("Invalid DID fingerprint.");
  return `/kv/did-${fingerprintValue.slice(0, 2)}/${fingerprintValue.slice(2)}`;
}

export function contributionNotePath(fingerprintValue: string): string {
  if (!/^[0-9a-f]{16}$/.test(fingerprintValue)) throw new Error("Invalid DID fingerprint.");
  return `/kv/contrib-${fingerprintValue.slice(0, 2)}/${fingerprintValue.slice(2)}`;
}

export function publicProofRoom(fingerprintValue: string): string {
  if (!/^[0-9a-f]{16}$/.test(fingerprintValue)) throw new Error("Invalid DID fingerprint.");
  return `proof-${fingerprintValue}`;
}

export function publicProofPath(fingerprintValue: string): string {
  return `/r/${publicProofRoom(fingerprintValue)}?format=json`;
}

export async function proxyGet(path: string): Promise<string> {
  const response = await fetch(`/api/technocore?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Technocore returned ${response.status}`);
  return text;
}

export async function sendSignedMessage(identity: StoredIdentity, room: string, text: string): Promise<string> {
  const body = cleanLine(text);
  const nonce = Date.now().toString();
  const canonical = `${room}|${nonce}|${body}`;
  const sig = await signText(identity.privateKeyJwk, canonical);
  return proxyGet(`/r/${encodeSegment(room)}/say-signed/${encodeSegment(identity.did)}/${encodeSegment(sig)}/${nonce}/${encodeURIComponent(body)}`);
}

function profileIndexMatches(raw: string, identity: StoredIdentity, agent: string, mailbox: string): boolean {
  return raw.includes(identity.did) && raw.includes(`agent:${agent}`) && raw.includes(`mailbox:${mailbox}`);
}

function profileProofMatches(raw: string, identity: StoredIdentity, agent: string, mailbox: string): boolean {
  return raw.includes(identity.did) && raw.includes("technocore-profile-v1") && raw.includes(`agent:${agent}`) && raw.includes(`mailbox:${mailbox}`);
}

async function canReadMatchingIndex(path: string, identity: StoredIdentity, agent: string, mailbox: string): Promise<boolean> {
  try {
    return profileIndexMatches(await proxyGet(path), identity, agent, mailbox);
  } catch {
    return false;
  }
}

async function canReadMatchingProof(path: string, identity: StoredIdentity, agent: string, mailbox: string): Promise<boolean> {
  try {
    return profileProofMatches(await proxyGet(path), identity, agent, mailbox);
  } catch {
    return false;
  }
}

export async function publishProfile(
  identity: StoredIdentity,
  agentName: string,
  mailbox: string,
  onStage?: (stage: ProfilePublishStage) => void,
): Promise<ProfilePublishResult> {
  const agent = cleanName(agentName);
  const fingerprintValue = await fingerprint(identity.did);
  const notePath = didNotePath(fingerprintValue);
  const proofPath = publicProofPath(fingerprintValue);
  const value = cleanLine(`technocore-profile-v1 did:${identity.did} agent:${agent} mailbox:${mailbox}`, 4096);

  onStage?.("checking-index");
  let indexState: ProfilePublishResult["index"] = "existing";
  const indexExists = await canReadMatchingIndex(notePath, identity, agent, mailbox);

  if (!indexExists) {
    onStage?.("writing-index");
    try {
      await proxyGet(`${notePath}/set/${encodeURIComponent(value)}`);
      indexState = "published";
    } catch (error) {
      const confirmed = await canReadMatchingIndex(notePath, identity, agent, mailbox);
      if (!confirmed) {
        const raw = error instanceof Error ? error.message : "Unknown Technocore error";
        throw new Error(`PROFILE_INDEX_PENDING: ${raw}`);
      }
      indexState = "confirmed-after-error";
    }
  }

  onStage?.("index-confirmed");
  onStage?.("checking-proof");
  let proofState: ProfilePublishResult["proof"] = "existing";
  const proofExists = await canReadMatchingProof(proofPath, identity, agent, mailbox);

  if (!proofExists) {
    onStage?.("writing-proof");
    try {
      await sendSignedMessage(identity, publicProofRoom(fingerprintValue), value);
      proofState = "published";
    } catch (error) {
      const confirmed = await canReadMatchingProof(proofPath, identity, agent, mailbox);
      if (!confirmed) {
        const raw = error instanceof Error ? error.message : "Unknown Technocore error";
        throw new Error(`PROFILE_PROOF_PENDING: ${raw}`);
      }
      proofState = "confirmed-after-error";
    }
  }

  onStage?.("proof-confirmed");
  return { index: indexState, proof: proofState };
}

export async function publishContribution(identity: StoredIdentity, agentName: string, url: string, summary: string): Promise<string> {
  const agent = cleanName(agentName);
  const fingerprintValue = await fingerprint(identity.did);
  const cleanUrl = new URL(url).toString();
  const cleanSummary = cleanLine(summary, 1200);
  const value = cleanLine(`technocore-builder-proof-v1 did:${identity.did} agent:${agent} summary:${cleanSummary} url:${cleanUrl}`, 4096);
  const noteResult = await proxyGet(`${contributionNotePath(fingerprintValue)}/set/${encodeURIComponent(value)}`);
  await sendSignedMessage(identity, publicProofRoom(fingerprintValue), value);
  return noteResult;
}

export function createMailbox(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `mb-p-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function fingerprint(did: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(did));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
