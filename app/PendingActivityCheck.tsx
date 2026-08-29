"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { identityChangeEventName, loadIdentity } from "../lib/identity";
import {
  loadPendingActivity,
  pendingActivityEventName,
  readMailbox,
  verifyPendingActivity,
} from "../lib/technocore";

type CheckState = "idle" | "checking" | "missing" | "error" | "found";

export default function PendingActivityCheck() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<CheckState>("idle");
  const [tr, setTr] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [activityDone, setActivityDone] = useState(false);

  function refreshState() {
    const identity = loadIdentity();
    setTr((localStorage.getItem("technocore-agent-console.lang") || navigator.language).toLowerCase().startsWith("tr"));
    if (!identity?.profile?.mailbox) {
      setVisible(false);
      setPendingText("");
      setActivityDone(false);
      return;
    }

    const pending = loadPendingActivity(identity.did);
    setVisible(true);
    setPendingText(pending?.text || "");
    setActivityDone(localStorage.getItem(`technocore-agent-console.progress.${identity.did}.activity`) === "true");
    if (!pending && state !== "found") setState("idle");
  }

  useEffect(() => {
    const findTarget = () => {
      const node = document.querySelector<HTMLElement>(".onboardingGrid > article:nth-of-type(3)");
      if (node) setTarget(node);
    };

    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    refreshState();
    const identityEvent = identityChangeEventName();
    const pendingEvent = pendingActivityEventName();
    window.addEventListener(identityEvent, refreshState);
    window.addEventListener(pendingEvent, refreshState);
    window.addEventListener("storage", refreshState);
    return () => {
      observer.disconnect();
      window.removeEventListener(identityEvent, refreshState);
      window.removeEventListener(pendingEvent, refreshState);
      window.removeEventListener("storage", refreshState);
    };
  }, []);

  async function check() {
    const identity = loadIdentity();
    if (!identity?.profile?.mailbox) return;

    setState("checking");
    try {
      const pending = loadPendingActivity(identity.did);
      let found = false;

      if (pending) {
        found = await verifyPendingActivity(identity);
      } else {
        const textarea = target?.querySelector<HTMLTextAreaElement>("textarea");
        const exactText = textarea?.value.trim() || "";
        if (!exactText) {
          setState("missing");
          return;
        }
        const messages = await readMailbox(identity.profile.mailbox);
        found = messages.some((item) => item.from === identity.did && item.text === exactText);
      }

      if (!found) {
        setState("missing");
        return;
      }

      localStorage.setItem(`technocore-agent-console.progress.${identity.did}.activity`, "true");
      setActivityDone(true);
      setPendingText("");
      setState("found");
      window.setTimeout(() => window.location.reload(), 700);
    } catch {
      setState("error");
    }
  }

  if (!visible || !target) return null;

  const content = (
    <aside className={`activityDeliveryPanel ${pendingText ? "hasPending" : ""}`} role="status">
      <div className="activityDeliveryCopy">
        <strong>
          {pendingText
            ? (tr ? "Son gönderimin teslimatı bekleniyor" : "The latest delivery is still pending")
            : activityDone
              ? (tr ? "Teslimat kontrolü" : "Delivery check")
              : (tr ? "İlk aktiviteni doğrula" : "Verify your first activity")}
        </strong>
        <span>
          {state === "checking"
            ? (tr ? "Technocore mailbox aynı mesaj için kontrol ediliyor…" : "Checking the Technocore mailbox for the exact message…")
            : state === "found"
              ? (tr ? "Mesaj Technocore'dan geri okundu. Doğrulama tamamlandı." : "The message was read back from Technocore. Verification is complete.")
              : state === "missing"
                ? (tr ? "Bu exact mesaj henüz Technocore'dan geri okunamıyor. Yeniden göndermeden daha sonra tekrar kontrol edebilirsin." : "This exact message is not readable from Technocore yet. Check again later without resending it.")
                : state === "error"
                  ? (tr ? "Technocore mailbox şu anda okunamıyor. Bu, mesajın kaybolduğu anlamına gelmez." : "The Technocore mailbox cannot be read right now. This does not mean the message was lost.")
                  : pendingText
                    ? (tr ? "Bu kontrol yeni mesaj göndermez. Yalnız bekleyen exact mesajı Technocore'dan geri okumaya çalışır." : "This does not send another message. It only checks whether the exact pending message can now be read back.")
                    : (tr ? "Yukarıdaki mevcut mesajı yeniden göndermeden Technocore mailbox'ında exact olarak ara." : "Check the exact message currently shown above in the Technocore mailbox without resending it.")}
        </span>
        {pendingText && <code>{pendingText}</code>}
      </div>
      <button type="button" onClick={check} disabled={state === "checking"}>
        {state === "checking" ? (tr ? "Kontrol ediliyor…" : "Checking…") : (tr ? "Technocore'dan teslimatı kontrol et" : "Check delivery on Technocore")}
      </button>
    </aside>
  );

  return createPortal(content, target);
}
