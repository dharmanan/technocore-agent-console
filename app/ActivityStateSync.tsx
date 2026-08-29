"use client";

import { useEffect } from "react";
import { loadIdentity } from "../lib/identity";
import { readMailbox } from "../lib/technocore";

export default function ActivityStateSync() {
  useEffect(() => {
    let cancelled = false;

    async function sync() {
      const identity = loadIdentity();
      const mailbox = identity?.profile?.mailbox || localStorage.getItem("technocore-agent-console.mailbox") || "";
      if (!identity || !mailbox) return;

      try {
        const messages = await readMailbox(mailbox);
        if (cancelled) return;

        const verified = messages.some((message) => message.from === identity.did && Boolean(message.text));
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
        // Keep the last locally confirmed state when Technocore cannot be read.
      }
    }

    sync();
    return () => { cancelled = true; };
  }, []);

  return null;
}
