"use client";

import { useEffect } from "react";
import { loadIdentity } from "../lib/identity";
import { fingerprint, proxyGet, publicProofPath } from "../lib/technocore";

type ProofMessage = { from?: string; text?: string };
type ProofPayload = { messages?: ProofMessage[] } | ProofMessage[];

function messagesFrom(raw: string): ProofMessage[] {
  try {
    const parsed = JSON.parse(raw) as ProofPayload;
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

function isUserActivity(message: ProofMessage, did: string) {
  if (message.from !== did || !message.text) return false;
  return !message.text.startsWith("technocore-profile-v1") && !message.text.startsWith("technocore-builder-proof-v1");
}

export default function ActivityStateSync() {
  useEffect(() => {
    let cancelled = false;

    async function sync() {
      const identity = loadIdentity();
      if (!identity) return;

      try {
        const fp = await fingerprint(identity.did);
        const raw = await proxyGet(`${publicProofPath(fp)}&n=${Date.now()}`);
        if (cancelled) return;

        const verified = messagesFrom(raw).some((message) => isUserActivity(message, identity.did));
        const key = `technocore-agent-console.progress.${identity.did}.activity`;
        const before = localStorage.getItem(key) === "true";

        if (verified) localStorage.setItem(key, "true");
        else localStorage.removeItem(key);

        if (before !== verified) {
          const reloadKey = `technocore-agent-console.activity-sync.${identity.did}.${verified ? "1" : "0"}`;
          if (!sessionStorage.getItem(reloadKey)) {
            sessionStorage.setItem(reloadKey, "1");
            window.location.reload();
          }
        }
      } catch {
        // Do not overwrite a locally confirmed state when Technocore cannot be read.
      }
    }

    sync();
    return () => { cancelled = true; };
  }, []);

  return null;
}
