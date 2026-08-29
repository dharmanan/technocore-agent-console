import { signText, type StoredIdentity } from "./identity";

export const TECHNOCORE_ORIGIN = "https://technocore.chat";
export const FIRST_ACTIVITY_ROOM = "lobby";

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

export type ActivityPublishResult = "existing" | "published" | "confirmed-after-error";

type RoomMessage = { from?: string; text?: string; seq?: number; ts?: string; nonce?: string };
type RoomResponse = { messages?: RoomMessage[] } | RoomMessage[];

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

function parseRoomMessages(raw: string): RoomMessage[] {
  try {
    const parsed = JSON.parse(raw) as RoomResponse;
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch { return []; }
}

async function readRoomMessages(room: string): Promise<RoomMessage[]> {
  const raw = await proxyGet(`/r/${encodeSegment(room)}?format=json&limit=200&n=${Date.now()}`);
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
export function publicProofPath(fingerprintValue: string): string { return `/r/${publicProofRoom(fingerprintValue)}?format=json`; }

export async function proxyGet(path: string): Promise<string> {
  const response = await fetch(`/api/technocore?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Technocore returned ${response.status}`);
  return text;
}

async function sendSignedMessageToRoom(identity: StoredIdentity, room: string, text: string): Promise<string> {
  const body = cleanLine(text);
  const nonce = Date.now().toString();
  const canonical = `${room}|${nonce}|${body}`;
  const sig = await signText(identity.privateKeyJwk, canonical);
  return proxyGet(`/r/${encodeSegment(room)}/say-signed/${encodeSegment(identity.did)}/${encodeSegment(sig)}/${nonce}/${encodeURIComponent(body)}`);
}

async function hasExactActivity(identity: StoredIdentity, room: string, body: string): Promise<boolean> {
  try { return (await readRoomMessages(room)).some((item) => item.from === identity.did && item.text === body); }
  catch { return false; }
}

async function waitForExactActivity(identity: StoredIdentity, room: string, body: string, attempts = 10, delayMs = 2000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await hasExactActivity(identity, room, body)) return true;
    if (attempt < attempts - 1) await wait(delayMs);
  }
  return false;
}

export async function sendSignedMessage(identity: StoredIdentity, room: string, text: string): Promise<string> {
  const targetRoom = room.startsWith("mb-p-") ? FIRST_ACTIVITY_ROOM : room;
  const body = cleanLine(text);

  if (targetRoom === FIRST_ACTIVITY_ROOM && await hasExactActivity(identity, targetRoom, body)) return "already-confirmed";

  let writeResponse = "";
  let writeError: unknown = null;
  try { writeResponse = await sendSignedMessageToRoom(identity, targetRoom, body); }
  catch (error) { writeError = error; }

  if (targetRoom === FIRST_ACTIVITY_ROOM) {
    const confirmed = await waitForExactActivity(identity, targetRoom, body);
    if (confirmed) return writeError ? "confirmed-after-error" : (writeResponse || "confirmed");
    const raw = writeError instanceof Error ? writeError.message : "Technocore accepted the request but the activity was not visible in lobby before verification timed out.";
    throw new Error(`ACTIVITY_VERIFY_PENDING: ${raw}`);
  }

  if (writeError) throw writeError;
  return writeResponse;
}

export async function hasVerifiableActivity(identity: StoredIdentity, room = FIRST_ACTIVITY_ROOM): Promise<boolean> {
  try { return (await readRoomMessages(room)).some((item) => item.from === identity.did); }
  catch { return false; }
}

export async function publishVerifiableActivity(identity: StoredIdentity, text: string, room = FIRST_ACTIVITY_ROOM): Promise<ActivityPublishResult> {
  const body = cleanLine(text);
  if (await hasExactActivity(identity, room, body)) return "existing";
  let writeError: unknown = null;
  try { await sendSignedMessageToRoom(identity, room, body); }
  catch (error) { writeError = error; }
  const confirmed = await waitForExactActivity(identity, room, body);
  if (confirmed) return writeError ? "confirmed-after-error" : "published";
  const raw = writeError instanceof Error ? writeError.message : "Activity was not visible before verification timed out.";
  throw new Error(`ACTIVITY_VERIFY_PENDING: ${raw}`);
}

function profileIndexMatches(raw: string, identity: StoredIdentity, agent: string, mailbox: string): boolean {
  return raw.includes(identity.did) && raw.includes(`agent:${agent}`) && raw.includes(`mailbox:${mailbox}`);
}
function profileProofMatches(raw: string, identity: StoredIdentity, agent: string, mailbox: string): boolean {
  return raw.includes(identity.did) && raw.includes("technocore-profile-v1") && raw.includes(`agent:${agent}`) && raw.includes(`mailbox:${mailbox}`);
}
async function canReadMatchingIndex(path: string, identity: StoredIdentity, agent: string, mailbox: string): Promise<boolean> {
  try { return profileIndexMatches(await proxyGet(path), identity, agent, mailbox); } catch { return false; }
}
async function canReadMatchingProof(path: string, identity: StoredIdentity, agent: string, mailbox: string): Promise<boolean> {
  try { return profileProofMatches(await proxyGet(path), identity, agent, mailbox); } catch { return false; }
}

export async function publishProfile(identity: StoredIdentity, agentName: string, mailbox: string, onStage?: (stage: ProfilePublishStage) => void): Promise<ProfilePublishResult> {
  const agent = cleanName(agentName);
  const fingerprintValue = await fingerprint(identity.did);
  const notePath = didNotePath(fingerprintValue);
  const proofPath = publicProofPath(fingerprintValue);
  const value = cleanLine(`technocore-profile-v1 did:${identity.did} agent:${agent} mailbox:${mailbox}`, 4096);
  onStage?.("checking-index");
  let indexState: ProfilePublishResult["index"] = "existing";
  if (!await canReadMatchingIndex(notePath, identity, agent, mailbox)) {
    onStage?.("writing-index");
    try { await proxyGet(`${notePath}/set/${encodeURIComponent(value)}`); indexState = "published"; }
    catch (error) {
      if (!await canReadMatchingIndex(notePath, identity, agent, mailbox)) throw new Error(`PROFILE_INDEX_PENDING: ${error instanceof Error ? error.message : "Unknown Technocore error"}`);
      indexState = "confirmed-after-error";
    }
  }
  onStage?.("index-confirmed"); onStage?.("checking-proof");
  let proofState: ProfilePublishResult["proof"] = "existing";
  if (!await canReadMatchingProof(proofPath, identity, agent, mailbox)) {
    onStage?.("writing-proof");
    try { await sendSignedMessageToRoom(identity, publicProofRoom(fingerprintValue), value); proofState = "published"; }
    catch (error) {
      if (!await canReadMatchingProof(proofPath, identity, agent, mailbox)) throw new Error(`PROFILE_PROOF_PENDING: ${error instanceof Error ? error.message : "Unknown Technocore error"}`);
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
