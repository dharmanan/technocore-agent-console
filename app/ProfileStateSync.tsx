"use client";

import { useEffect } from "react";
import { loadIdentity } from "../lib/identity";

export default function ProfileStateSync() {
  useEffect(() => {
    const identity = loadIdentity();
    if (!identity?.profile) return;

    const localAgent = localStorage.getItem("technocore-agent-console.agentName") || "";
    const localMailbox = localStorage.getItem("technocore-agent-console.mailbox") || "";

    if (localAgent !== identity.profile.agentName) {
      localStorage.setItem("technocore-agent-console.agentName", identity.profile.agentName);
    }
    if (localMailbox !== identity.profile.mailbox) {
      localStorage.setItem("technocore-agent-console.mailbox", identity.profile.mailbox);
    }
  }, []);

  return null;
}
