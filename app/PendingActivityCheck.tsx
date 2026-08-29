"use client";

import { useEffect, useState } from "react";
import { identityChangeEventName, loadIdentity } from "../lib/identity";
import {
  loadPendingActivity,
  pendingActivityEventName,
  verifyPendingActivity,
} from "../lib/technocore";

type CheckState = "idle" | "checking" | "missing" | "error";

export default function PendingActivityCheck() {
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<CheckState>("idle");
  const [tr, setTr] = useState(false);
  const [pendingText, setPendingText] = useState("");

  function refreshVisibility() {
    const identity = loadIdentity();
    setTr((localStorage.getItem("technocore-agent-console.lang") || navigator.language).toLowerCase().startsWith("tr"));
    if (!identity) {
      setVisible(false);
      setPendingText("");
      return;
    }
    const pending = loadPendingActivity(identity.did);
    setVisible(Boolean(pending));
    setPendingText(pending?.text || "");
    if (!pending) setState("idle");
  }

  useEffect(() => {
    refreshVisibility();
    const identityEvent = identityChangeEventName();
    const pendingEvent = pendingActivityEventName();
    window.addEventListener(identityEvent, refreshVisibility);
    window.addEventListener(pendingEvent, refreshVisibility);
    window.addEventListener("storage", refreshVisibility);
    return () => {
      window.removeEventListener(identityEvent, refreshVisibility);
      window.removeEventListener(pendingEvent, refreshVisibility);
      window.removeEventListener("storage", refreshVisibility);
    };
  }, []);

  async function check() {
    const identity = loadIdentity();
    if (!identity) return;
    setState("checking");
    try {
      const found = await verifyPendingActivity(identity);
      if (!found) {
        setState("missing");
        return;
      }

      localStorage.setItem(`technocore-agent-console.progress.${identity.did}.activity`, "true");
      setVisible(false);
      setPendingText("");
      setState("idle");
      window.location.reload();
    } catch {
      setState("error");
    }
  }

  if (!visible) return null;

  return (
    <aside className="activityCheckBar" role="status">
      <div>
        <strong>{tr ? "Son gönderimin teslimatı henüz doğrulanmadı" : "The latest delivery is not verified yet"}</strong>
        <span>
          {state === "checking"
            ? (tr ? "Technocore aynı mesaj için kontrol ediliyor…" : "Checking Technocore for this exact message…")
            : state === "missing"
              ? (tr ? "Bu mesaj henüz Technocore'dan geri okunamıyor. Yeniden gönderme; daha sonra yalnız teslim durumunu tekrar kontrol et." : "This exact message is not readable from Technocore yet. Do not resend it; check delivery again later.")
              : state === "error"
                ? (tr ? "Technocore şu anda okunamıyor. Pending gönderim korunuyor; mesajı yeniden göndermene gerek yok." : "Technocore cannot be read right now. The pending send is preserved; you do not need to resend it.")
                : (tr ? "Gönderim isteği yapıldı fakat aynı mesaj henüz geri okunamadı. Bu kontrol yeni mesaj göndermez." : "The send was attempted, but this exact message has not been read back yet. This check does not send a new message.")}
        </span>
        {pendingText && <code>{pendingText}</code>}
      </div>
      <button onClick={check} disabled={state === "checking"}>
        {state === "checking" ? (tr ? "Kontrol ediliyor…" : "Checking…") : (tr ? "Teslim durumunu kontrol et" : "Check delivery status")}
      </button>
    </aside>
  );
}
