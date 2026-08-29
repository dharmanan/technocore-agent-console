import { fingerprint, proxyGet, publicProofPath, publicProofRoom } from "./technocore";

export type AgentProfileVersion = {
  did: string;
  fingerprint: string;
  agent: string;
  mailbox: string;
  proofRoom: string;
  seq: number | null;
  ts: string | null;
};

type ProofMessage = {
  from?: string;
  text?: string;
  seq?: number;
  ts?: string;
};

type ProofPayload = { messages?: ProofMessage[] } | ProofMessage[];

function parseMessages(raw: string): ProofMessage[] {
  try {
    const parsed = JSON.parse(raw) as ProofPayload;
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

function parseProfile(text: string | undefined, did: string) {
  if (!text?.startsWith("technocore-profile-v1") || !text.includes(`did:${did}`)) return null;
  const agent = text.match(/(?:^|\s)agent:([a-z0-9_-]{1,48})(?:\s|$)/)?.[1];
  const mailbox = text.match(/(?:^|\s)mailbox:(mb-p-[a-zA-Z0-9_-]+)(?:\s|$)/)?.[1];
  return agent && mailbox ? { agent, mailbox } : null;
}

function sortNewest(a: AgentProfileVersion, b: AgentProfileVersion) {
  const seqA = a.seq ?? -1;
  const seqB = b.seq ?? -1;
  if (seqA !== seqB) return seqB - seqA;
  return Date.parse(b.ts || "") - Date.parse(a.ts || "");
}

export async function resolveAgentProfileHistory(didInput: string): Promise<AgentProfileVersion[]> {
  const did = didInput.trim();
  if (!did.startsWith("did:key:") || did.length < 32) throw new Error("CONTACT_DID_INVALID");

  const fp = await fingerprint(did);
  const raw = await proxyGet(`${publicProofPath(fp)}&n=${Date.now()}`);
  const room = publicProofRoom(fp);

  const versions = parseMessages(raw)
    .filter((message) => message.from === did)
    .map((message) => {
      const parsed = parseProfile(message.text, did);
      if (!parsed) return null;
      return {
        did,
        fingerprint: fp,
        agent: parsed.agent,
        mailbox: parsed.mailbox,
        proofRoom: room,
        seq: typeof message.seq === "number" ? message.seq : null,
        ts: message.ts || null,
      } satisfies AgentProfileVersion;
    })
    .filter((value): value is AgentProfileVersion => Boolean(value))
    .sort(sortNewest);

  const seen = new Set<string>();
  return versions.filter((version) => {
    const key = `${version.agent}|${version.mailbox}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function resolveLatestAgentProfile(didInput: string): Promise<AgentProfileVersion> {
  const history = await resolveAgentProfileHistory(didInput);
  if (!history.length) throw new Error("CONTACT_PROFILE_UNVERIFIED");
  return history[0];
}
