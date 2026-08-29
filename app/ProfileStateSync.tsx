"use client";

import { useEffect } from "react";
import { loadIdentity, withIdentityProfile } from "../lib/identity";
import { resolveAgentContact } from "../lib/technocore";

export default function ProfileStateSync() {
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function sync() {
      const identity = loadIdentity();
      if (!identity) return;

      try {
        const latest = await resolveAgentContact(identity.did);
        if (cancelled) return;

        const localAgent = localStorage.getItem("technocore-agent-console.agentName") || "";
        const localMailbox = localStorage.getItem("technocore-agent-console.mailbox") || "";
        const profileMatchesBackup = identity.profile?.agentName === latest.agent && identity.profile?.mailbox === latest.mailbox;
        const localMatches = localAgent === latest.agent && localMailbox === latest.mailbox;

        if (!localMatches || !profileMatchesBackup) {
          localStorage.setItem("technocore-agent-console.agentName", latest.agent);
          localStorage.setItem("technocore-agent-console.mailbox", latest.mailbox);
          withIdentityProfile(identity, latest.agent, latest.mailbox);

          const reloadKey = `technocore-agent-console.profile-sync.${identity.did}.${latest.seq ?? latest.mailbox}`;
          if (!sessionStorage.getItem(reloadKey)) {
            sessionStorage.setItem(reloadKey, "1");
            window.location.reload();
            return;
          }
        }
      } catch {
        // No verified remote profile yet or Technocore is temporarily unreadable.
        // Never invent a mailbox here.
      }
    }

    sync();
    timer = window.setInterval(sync, 5000);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return null;
}
