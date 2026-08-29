import { signText, type StoredIdentity } from "./identity";

export const TECHNOCORE_ORIGIN = "https://technocore.chat";
const PENDING_ACTIVITY_EVENT = "technocore-pending-activity-changed";
const PENDING_ACTIVITY_TTL_MS = 90_000;
const PENDING_PROFILE_TTL_MS = 10 * 60_000;
const DEFAULT_READ_TIMEOUT_MS = 8000;
const ACTIVITY_READ_TIMEOUT_MS = 5000;
const PROFILE_READ_TIMEOUT_MS = 2500;
const PROFILE_VERIFY_ATTEMPTS = 3;
const PROFILE_VERIFY_DELAY_MS = 700;

export type PendingActivity = {
  did: string;
  room: string;
  text: string;
  attemptedAt: string;
};

type PendingProfile = {
  did: string;
  agent: string;
  mailbox: string;
  proofRoom: string;
  value: string;
  attemptedAt: string;
};

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

export type TechnocoreMessage = { from?: string; text?: string; seq?: number; ts?: string; nonce?: string };
type RoomResponse = { messages?: TechnocoreMessage[] } | TechnocoreMessage[];

export type AgentContact = {
  did: string;
  fingerprint: string;
  agent: string;
  mailbox: string;
  proofRoom: string;
  seq?: number | null;
  ts?: string | null;
};

function pendingActivityKey(did: string) {
  return `technocore-agent-console.pendingActivity.${did}`;
}

function pendingProfileKey(did: string) {
  return `technocore-agent-console.pendingProfile.${did}`;
}

function broadcastPendingActivityChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PENDING_ACTIVITY_EVENT));
}

export function pendingActivityEventName() {
  return PENDING_ACTIVITY_EVENT;
}

function pendingActivityAgeMs(value: PendingActivity): number {
  const attemptedAt = Date.parse(value.attemptedAt);
  return Number.isFinite(attemptedAt) ? Math.max(0, Date.now() - attemptedAt) : Number.POSITIVE_INFINITY;
}

function pendingProfileAgeMs(value: PendingProfile): number {
  const attemptedAt = Date.parse(value.attemptedAt);
  return Number.isFinite(attemptedAt) ? Math.max(0, Date.now() - attemptedAt) : Number.POSITIVE_INFINITY;
}

export function loadPendingActivity(did: string): PendingActivity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(pendingActivityKey(did));
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingActivity;
    if (!(value?.did === did && value.room && value.text)) return null;
    if (pendingActivityAgeMs(value) > PENDING_ACTIVITY_TTL_MS) {
      localStorage.removeItem(pendingActivityKey(did));
      broadcastPendingActivityChange();
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function savePendingActivity(value: PendingActivity) {
  if (typeof window === "undefined") return;
  localStorage.setItem(pendingActivityKey(value.did), JSON.stringify(value));
  broadcastPendingActivityChange();
}

export function clearPendingActivity(did: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(pendingActivityKey(did));
  broadcastPendingActivityChange();
}

function loadPendingProfile(did: string): PendingProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(pendingProfileKey(did));
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingProfile;
    if (!(value?.did === did && value.agent && value.mailbox && value.proofRoom && value.value)) return null;
    if (pendingProfileAgeMs(value) > PENDING_PROFILE_TTL_MS) {
      localStorage.removeItem(pendingProfileKey(did));
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function savePendingProfile(value: PendingProfile) {
  if (typeof window === "undefined") return;
  localStorage.setItem(pendingProfileKey(value.did), JSON.stringify(value));
}

function clearPendingProfile(did: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(pendingProfileKey(did));
}

export function cleanName(value: string): string {
  const result = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(result)) throw new Error("Agent name must use lowercase letters, numbers, _ or -, up to 48 characters.");
  return result;
}

export function cleanLine(value: string, limit = 4096): string {
  const result = value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, " ").trim();
  if (!result) throw new Error("Text cannot be empty.");
  if (result.length > limit) throw new Error(`Text is limited to ${limit} characters.`);
  return result;
}

function encodeSegment(value: string) { return encodeURIComponent(value).replace(/%2F/gi, "%252F"); }
function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function parseRoomMessages(raw: string): TechnocoreMessage[] {
  try {
    const parsed = JSON.parse(raw) as RoomResponse;
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch { return []; }
}

async function readRoomMessages(room: string, timeoutMs = DEFAULT_READ_TIMEOUT_MS): Promise<TechnocoreMessage[]> {
  const raw = await proxyGet(`/r/${encodeSegment(room)}?format=json&limit=200&n=${Date.now()}`, timeoutMs);
  return parseRoomMessages(raw);
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

export async function proxyGet(path: string, timeoutMs = DEFAULT_READ_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/technocore?path=${encodeURIComponent(path)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `Technocore returned ${response.status}`);
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Technocore read timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyPostSigned(room: string, did: string, sig: string, nonce: string, textValue: string): Promise<string> {
  const response = await fetch("/api/technocore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      path: `/r/${room}`,
      payload: { did, sig, nonce, text: textValue },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Technocore returned ${response.status}`);
  return text;
}

async function sendSignedMessageToRoom(identity: StoredIdentity, room: string, text: string): Promise<string> {
  const body = cleanLine(text);
  const nonce = Date.now().toString();
  const canonical = `${room}|${nonce}|${body}`;
  const sig = await signText(identity.privateKeyJwk, canonical);
  return proxyPostSigned(room, identity.did, sig, nonce, body);
}

async function hasExactActivity(identity: StoredIdentity, room: string, body: string, timeoutMs = ACTIVITY_READ_TIMEOUT_MS): Promise<boolean> {
  const messages = await readRoomMessages(room, timeoutMs);
  return messages.some((item) => item.from === identity.did && item.text === body);
}

export async function verifySignedMessage(identity: StoredIdentity, room: string, text: string): Promise<boolean> {
  const body = cleanLine(text);
  return hasExactActivity(identity, room, body, ACTIVITY_READ_TIMEOUT_MS);
}

export async function verifyPendingActivity(identity: StoredIdentity): Promise<boolean> {
  const pending = loadPendingActivity(identity.did);
  if (!pending) return false;
  const found = await hasExactActivity(identity, pending.room, pending.text, DEFAULT_READ_TIMEOUT_MS);
  if (found) clearPendingActivity(identity.did);
  return found;
}

async function waitForExactActivity(
  identity: StoredIdentity,
  room: string,
  body: string,
  attempts = 5,
  delayMs = 1000,
  readTimeoutMs = ACTIVITY_READ_TIMEOUT_MS,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await hasExactActivity(identity, room, body, readTimeoutMs)) return true;
    } catch {
      // Readback can fail transiently while the write has already landed.
    }
    if (attempt < attempts - 1) await wait(delayMs);
  }
  return false;
}

function isSystemProof(text: string | undefined) {
  return Boolean(text?.startsWith("technocore-profile-v1") || text?.startsWith("technocore-builder-proof-v1"));
}

export async function sendSignedMessage(identity: StoredIdentity, room: string, text: string): Promise<string> {
  const body = cleanLine(text);
  const verifiedMailbox = identity.profile?.mailbox?.trim();
  const targetRoom = verifiedMailbox || room;
  const unresolved = loadPendingActivity(identity.did);

  if (unresolved) {
    let resolved = false;
    try {
      resolved = await hasExactActivity(identity, unresolved.room, unresolved.text, DEFAULT_READ_TIMEOUT_MS);
    } catch {
      // A read failure must not globally lock this identity from sending a different message.
    }

    if (resolved) {
      clearPendingActivity(identity.did);
    } else if (unresolved.room === targetRoom && unresolved.text === body) {
      throw new Error("ACTIVITY_DELIVERY_PENDING: this exact message is still waiting for read-back");
    } else {
      clearPendingActivity(identity.did);
    }
  }

  try {
    if (await hasExactActivity(identity, targetRoom, body, ACTIVITY_READ_TIMEOUT_MS)) return "already-confirmed";
  } catch {
    // A transient read failure should not prevent the single write attempt.
  }

  savePendingActivity({ did: identity.did, room: targetRoom, text: body, attemptedAt: new Date().toISOString() });

  let writeResult = "";
  let writeError: unknown = null;
  try { writeResult = await sendSignedMessageToRoom(identity, targetRoom, body); }
  catch (error) { writeError = error; }

  const confirmed = await waitForExactActivity(identity, targetRoom, body, 5, 1000, ACTIVITY_READ_TIMEOUT_MS);
  if (confirmed) {
    clearPendingActivity(identity.did);
    return writeError ? "confirmed-after-error" : (writeResult || "confirmed");
  }

  const raw = writeError instanceof Error ? writeError.message : "read-back confirmation did not arrive";
  throw new Error(`ACTIVITY_DELIVERY_PENDING: ${raw}`);
}

export async function hasVerifiableActivity(identity: StoredIdentity): Promise<boolean> {
  if (identity.profile?.mailbox) {
    try {
      const messages = await readMailbox(identity.profile.mailbox);
      if (messages.some((item) => item.from === identity.did && Boolean(item.text))) return true;
    } catch {
      // Fall back to legacy proof-room activity.
    }
  }
  const fingerprintValue = await fingerprint(identity.did);
  const messages = await readRoomMessages(publicProofRoom(fingerprintValue));
  return messages.some((item) => item.from === identity.did && !isSystemProof(item.text));
}

function parseProfileProof(text: string | undefined, did: string) {
  if (!text?.startsWith("technocore-profile-v1") || !text.includes(`did:${did}`)) return null;
  const agent = text.match(/(?:^|\s)agent:([a-z0-9_-]{1,48})(?:\s|$)/)?.[1];
  const mailbox = text.match(/(?:^|\s)mailbox:(mb-p-[a-zA-Z0-9_-]+)(?:\s|$)/)?.[1];
  return agent && mailbox ? { agent, mailbox } : null;
}

function newestFirst(a: TechnocoreMessage, b: TechnocoreMessage) {
  const seqA = typeof a.seq === "number" ? a.seq : -1;
  const seqB = typeof b.seq === "number" ? b.seq : -1;
  if (seqA !== seqB) return seqB - seqA;
  return Date.parse(String(b.ts || "")) - Date.parse(String(a.ts || ""));
}

export async function resolveAgentContact(didInput: string): Promise<AgentContact> {
  const did = didInput.trim();
  if (!did.startsWith("did:key:") || did.length < 32) throw new Error("CONTACT_DID_INVALID");
  const fingerprintValue = await fingerprint(did);
  const room = publicProofRoom(fingerprintValue);
  const messages = await readRoomMessages(room);
  const candidates = messages
    .filter((message) => message.from === did && Boolean(parseProfileProof(message.text, did)))
    .sort(newestFirst);
  const match = candidates[0];
  const profile = match ? parseProfileProof(match.text, did) : null;
  if (!profile) throw new Error("CONTACT_PROFILE_UNVERIFIED");
  return {
    did,
    fingerprint: fingerprintValue,
    agent: profile.agent,
    mailbox: profile.mailbox,
    proofRoom: room,
    seq: typeof match.seq === "number" ? match.seq : null,
    ts: match.ts || null,
  };
}

export async function readMailbox(mailbox: string): Promise<TechnocoreMessage[]> {
  if (!/^mb-p-[a-zA-Z0-9_-]+$/.test(mailbox)) throw new Error("MAILBOX_INVALID");
  return readRoomMessages(mailbox, DEFAULT_READ_TIMEOUT_MS);
}

export async function sendDirectMessage(identity: StoredIdentity, recipientMailbox: string, text: string): Promise<"confirmed" | "confirmed-after-error"> {
  if (!/^mb-p-[a-zA-Z0-9_-]+$/.test(recipientMailbox)) throw new Error("MAILBOX_INVALID");
  const body = cleanLine(text, 2000);
  let writeError: unknown = null;
  try { await sendSignedMessageToRoom(identity, recipientMailbox, body); }
  catch (error) { writeError = error; }
  const confirmed = await waitForExactActivity(identity, recipientMailbox, body, 5, 1000, ACTIVITY_READ_TIMEOUT_MS);
  if (confirmed) return writeError ? "confirmed-after-error" : "confirmed";
  const raw = writeError instanceof Error ? writeError.message : "read-back confirmation did not arrive";
  throw new Error(`DIRECT_MESSAGE_VERIFY_PENDING: ${raw}`);
}

function profileIndexMatches(raw: string, identity: StoredIdentity, agent: string, mailbox: string): boolean {
  return raw.includes(identity.did) && raw.includes(`agent:${agent}`) && raw.includes(`mailbox:${mailbox}`);
}

function profileProofMatches(raw: string, identity: StoredIdentity, agent: string, mailbox: string): boolean {
  return raw.includes(identity.did) && raw.includes("technocore-profile-v1") && raw.includes(`agent:${agent}`) && raw.includes(`mailbox:${mailbox}`);
}

async function canReadMatchingIndex(path: string, identity: StoredIdentity, agent: string, mailbox: string): Promise<boolean> {
  try { return profileIndexMatches(await proxyGet(path, PROFILE_READ_TIMEOUT_MS), identity, agent, mailbox); } catch { return false; }
}

async function canReadMatchingProof(path: string, identity: StoredIdentity, agent: string, mailbox: string): Promise<boolean> {
  try { return profileProofMatches(await proxyGet(`${path}&n=${Date.now()}`, PROFILE_READ_TIMEOUT_MS), identity, agent, mailbox); } catch { return false; }
}

export async function verifyProfile(identity: StoredIdentity, agentName: string, mailbox: string): Promise<boolean> {
  const agent = cleanName(agentName);
  const fingerprintValue = await fingerprint(identity.did);
  return canReadMatchingProof(publicProofPath(fingerprintValue), identity, agent, mailbox);
}

export async function publishProfile(identity: StoredIdentity, agentName: string, mailbox: string, onStage?: (stage: ProfilePublishStage) => void): Promise<ProfilePublishResult> {
  const agent = cleanName(agentName);
  const fingerprintValue = await fingerprint(identity.did);
  const notePath = didNotePath(fingerprintValue);
  const proofPath = publicProofPath(fingerprintValue);
  const proofRoom = publicProofRoom(fingerprintValue);
  const value = cleanLine(`technocore-profile-v1 did:${identity.did} agent:${agent} mailbox:${mailbox}`, 4096);

  onStage?.("checking-proof");
  if (await canReadMatchingProof(proofPath, identity, agent, mailbox)) {
    clearPendingProfile(identity.did);
    onStage?.("proof-confirmed");
    return { index: "existing", proof: "existing" };
  }

  const pending = loadPendingProfile(identity.did);
  const samePending = Boolean(
    pending &&
    pending.agent === agent &&
    pending.mailbox === mailbox &&
    pending.proofRoom === proofRoom &&
    pending.value === value
  );

  if (samePending) {
    onStage?.("checking-proof");
    const confirmed = await waitForExactActivity(
      identity,
      proofRoom,
      value,
      PROFILE_VERIFY_ATTEMPTS,
      PROFILE_VERIFY_DELAY_MS,
      PROFILE_READ_TIMEOUT_MS,
    );
    if (confirmed) {
      clearPendingProfile(identity.did);
      onStage?.("proof-confirmed");
      return { index: "existing", proof: "existing" };
    }
    throw new Error("PROFILE_PROOF_PENDING: signed profile was already sent once and is still waiting for Technocore read-back; no duplicate write was made");
  }

  savePendingProfile({
    did: identity.did,
    agent,
    mailbox,
    proofRoom,
    value,
    attemptedAt: new Date().toISOString(),
  });

  onStage?.("checking-index");
  let indexState: ProfilePublishResult["index"] = "existing";
  try {
    if (!await canReadMatchingIndex(notePath, identity, agent, mailbox)) {
      onStage?.("writing-index");
      await proxyGet(`${notePath}/set/${encodeURIComponent(value)}`, PROFILE_READ_TIMEOUT_MS);
      indexState = "published";
    }
  } catch {
    // The signed proof room is canonical for ownership verification in this console.
    // A slow note write must not cause a duplicate signed proof submission.
  }

  onStage?.("index-confirmed");
  onStage?.("writing-proof");

  let writeError: unknown = null;
  try {
    await sendSignedMessageToRoom(identity, proofRoom, value);
  } catch (error) {
    writeError = error;
  }

  const confirmed = await waitForExactActivity(
    identity,
    proofRoom,
    value,
    PROFILE_VERIFY_ATTEMPTS,
    PROFILE_VERIFY_DELAY_MS,
    PROFILE_READ_TIMEOUT_MS,
  );
  if (confirmed) {
    clearPendingProfile(identity.did);
    onStage?.("proof-confirmed");
    return {
      index: indexState,
      proof: writeError ? "confirmed-after-error" : "published",
    };
  }

  const raw = writeError instanceof Error ? writeError.message : "ownership proof is still waiting for Technocore read-back";
  throw new Error(`PROFILE_PROOF_PENDING: ${raw}`);
}

export async function publishContribution(identity: StoredIdentity, agentName: string, url: string, summary: string): Promise<string> {
  const agent = cleanName(agentName);
  const fingerprintValue = await fingerprint(identity.did);
  const cleanUrl = new URL(url).toString();
  const cleanSummary = cleanLine(summary, 1200);
  const value = cleanLine(`technocore-builder-proof-v1 did:${identity.did} agent:${agent} summary:${cleanSummary} url:${cleanUrl}`, 4096);
  const noteResult = await proxyGet(`${contributionNotePath(fingerprintValue)}/set/${encodeURIComponent(value)}`);
  await sendSignedMessageToRoom(identity, publicProofRoom(fingerprintValue), value);
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
