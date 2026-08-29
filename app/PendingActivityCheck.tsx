"use client";

import { useEffect, useState } from "react";
import { identityChangeEventName, loadIdentity } from "../lib/identity";
import { readMailbox } from "../lib/technocore";

type CheckState = "idle" | "checking" | "missing" | "error";

export default function PendingActivityCheck() {
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<CheckState>("idle");
  const [tr, setTr] = useState(false);

  function refreshVisibility() {
    const identity = loadIdentity();
    setTr((localStorage.getItem("technocore-agent-console.lang") || navigator.language).toLowerCase().startsWith("tr"));
    if (!identity?.profile?.mailbox) {
      setVisible(false);
      return;
    }
    const activityKey = `technocore-agent-console.progress.${identity.did}.activity`;
    setVisible(localStorage.getItem(activityKey) !== "true");
  }

  useEffect(() => {
    refreshVisibility();
    const eventName = identityChangeEventName();
    window.addEventListener(eventName, refreshVisibility);
    window.addEventListener("storage", refreshVisibility);
    return () => {
      window.removeEventListener(eventName, refreshVisibility);
      window.removeEventListener("storage", refreshVisibility);
    };
  }, []);

  async function check() {
    const identity = loadIdentity();
    if (!identity?.profile?.mailbox) return;
    setState("checking");
    try {
      const messages = await readMailbox(identity.profile.mailbox);
      const found = messages.some((item) => item.from === identity.did && Boolean(item.text));
      if (!found) {
        setState("missing");
        return;
      }

      localStorage.setItem(`technocore-agent-console.progress.${identity.did}.activity`, "true");
      setVisible(false);
      window.location.reload();
    } catch {
      setState("error");
    }
  }

  if (!visible) return null;

  return (
    <aside className="activityCheckBar" role="status">
      <div>
        <strong>{tr ? "3. adım henüz doğrulanmadı" : "Step 3 is not verified yet"}</strong>
        <span>
          {state === "checking"
            ? (tr ? "Technocore mailbox okunuyor…" : "Reading the Technocore mailbox…")
            : state === "missing"
              ? (tr ? "Bu DID'e ait imzalı aktivite henüz mailbox'ta bulunamadı. Mesajı tekrar göndermeden daha sonra yeniden kontrol edebilirsin." : "No signed activity from this DID is visible in the mailbox yet. You can check again later without resending.")
              : state === "error"
                ? (tr ? "Technocore mailbox şu anda okunamıyor. Bu, mesajın kaybolduğu anlamına gelmez." : "The Technocore mailbox cannot be read right now. This does not mean the message was lost.")
                : (tr ? "Önceki gönderimin gerçekten mailbox'a ulaşıp ulaşmadığını yeniden mesaj göndermeden kontrol et." : "Check whether the previous send actually reached the mailbox without sending it again.")}
        </span>
      </div>
      <button onClick={check} disabled={state === "checking"}>
        {state === "checking" ? (tr ? "Kontrol ediliyor…" : "Checking…") : (tr ? "Teslim durumunu kontrol et" : "Check delivery status")}
      </button>
    </aside>
  );
}
