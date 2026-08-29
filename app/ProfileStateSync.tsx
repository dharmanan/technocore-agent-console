"use client";

import { useEffect } from "react";
import { identityChangeEventName, loadIdentity } from "../lib/identity";

export default function ProfileStateSync() {
  useEffect(() => {
    function sync() {
      const identity = loadIdentity();
      if (!identity) return;

      if (!identity.profile) {
        const hadAgent = Boolean(localStorage.getItem("technocore-agent-console.agentName"));
        const hadMailbox = Boolean(localStorage.getItem("technocore-agent-console.mailbox"));
        localStorage.removeItem("technocore-agent-console.agentName");
        localStorage.removeItem("technocore-agent-console.mailbox");

        if (hadAgent || hadMailbox) {
          const key = `technocore-agent-console.legacy-clean.${identity.did}`;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, "1");
            window.location.reload();
          }
        }
        return;
      }

      localStorage.setItem("technocore-agent-console.agentName", identity.profile.agentName);
      localStorage.setItem("technocore-agent-console.mailbox", identity.profile.mailbox);
    }

    sync();
    const eventName = identityChangeEventName();
    window.addEventListener(eventName, sync);
    return () => window.removeEventListener(eventName, sync);
  }, []);

  return null;
}
