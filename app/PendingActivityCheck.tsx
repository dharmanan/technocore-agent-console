"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { identityChangeEventName, loadIdentity } from "../lib/identity";
import {
  clearPendingActivity,
  loadPendingActivity,
  pendingActivityEventName,
  readMailbox,
  type TechnocoreMessage,
} from "../lib/technocore";

type CheckState = "idle" | "checking" | "missing" | "error" | "found";
type CachedSnapshot = { mailbox?: TechnocoreMessage[] };

function normalized(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function matches(messages: TechnocoreMessage[], did: string, text: string) {
  const expected = normalized(text);
  return Boolean(expected) && messages.some((item) => item.from === did && normalized(item.text) === expected);
}

function readCachedMailbox(did: string): TechnocoreMessage[] {
  try {
    const raw = localStorage.getItem(`technocore-agent-console.liveSnapshot.${did}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachedSnapshot;
    return Array.isArray(parsed.mailbox) ? parsed.mailbox : [];
  } catch {
    return [];
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function PendingActivityCheck() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<CheckState>("idle");
  const [tr, setTr] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [activityDone, setActivityDone] = useState(false);
  const [checkedText, setCheckedText] = useState("");

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

    const pending = loadPendingActivity(identity.did);
    const textarea = target?.querySelector<HTMLTextAreaElement>("textarea");
    const exactText = normalized(pending?.text || textarea?.value || "");
    setCheckedText(exactText);

    if (!exactText) {
      setState("missing");
      return;
    }

    setState("checking");

    // First use the same last verified mailbox snapshot shown by the Live page.
    const cached = readCachedMailbox(identity.did);
    if (matches(cached, identity.did, exactText)) {
      if (pending) clearPendingActivity(identity.did);
      localStorage.setItem(`technocore-agent-console.progress.${identity.did}.activity`, "true");
      setActivityDone(true);
      setPendingText("");
      setState("found");
      return;
    }

    // Then retry the live mailbox read. One proxy timeout must not decide the result.
    let atLeastOneReadSucceeded = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const messages = await readMailbox(identity.profile.mailbox);
        atLeastOneReadSucceeded = true;
        if (matches(messages, identity.did, exactText)) {
          if (pending) clearPendingActivity(identity.did);
          localStorage.setItem(`technocore-agent-console.progress.${identity.did}.activity`, "true");
          setActivityDone(true);
          setPendingText("");
          setState("found");
          return;
        }
      } catch {
        // Technocore reads are eventually consistent and can time out transiently.
      }

      if (attempt < 2) await wait(1800 * (attempt + 1));
    }

    setState(atLeastOneReadSucceeded ? "missing" : "error");
  }

  if (!visible || !target) return null;

  const hasPending = Boolean(pendingText);
  const content = (
    <aside className={`activityDeliveryPanel ${hasPending ? "hasPending" : ""}`} role="status">
      <div className="activityDeliveryCopy">
        <strong>
          {hasPending
            ? (tr ? "Son gönderimin teslimatı bekleniyor" : "The latest delivery is still pending")
            : activityDone
              ? (tr ? "Technocore kayıt kontrolü" : "Technocore record check")
              : (tr ? "İlk aktiviteni doğrula" : "Verify your first activity")}
        </strong>
        <span>
          {state === "checking"
            ? (tr ? "Önce son doğrulanmış Live kaydı, ardından canlı mailbox kontrol ediliyor…" : "Checking the last verified Live snapshot, then the live mailbox…")
            : state === "found"
              ? (tr ? "Bu mesaj Technocore'dan geri okunmuş. Doğrulandı." : "This message has been read back from Technocore. Verified.")
              : state === "missing"
                ? (tr ? "Technocore mailbox okunabildi fakat bu mesaj son başarılı okumada bulunmadı. Bu, gecikmeli işleniyorsa daha sonra görünebileceği anlamına gelir." : "The Technocore mailbox was readable, but this message was not found in the latest successful read. It may still appear later if processing is delayed.")
                : state === "error"
                  ? (tr ? "Canlı mailbox üç denemede de cevap vermedi ve son doğrulanmış Live kaydında da bu mesaj yok. Mesajı yeniden göndermeden daha sonra tekrar kontrol et." : "The live mailbox did not respond after three attempts, and this message is not in the last verified Live snapshot. Check again later without resending.")
                  : hasPending
                    ? (tr ? "Yeni mesaj göndermeden yalnız son bekleyen mesajın Technocore'da görünüp görünmediğini kontrol eder." : "Checks whether the last pending message is now visible on Technocore without sending it again.")
                    : (tr ? "Yeni mesaj göndermez. Yukarıdaki mevcut metnin son doğrulanmış Live kaydında veya canlı mailbox'ta bulunup bulunmadığını kontrol eder." : "Does not send a message. It checks whether the current text above exists in the last verified Live snapshot or the live mailbox.")}
        </span>
        {(hasPending || (state !== "idle" && checkedText)) && <code>{hasPending ? pendingText : checkedText}</code>}
      </div>
      <button type="button" onClick={check} disabled={state === "checking"}>
        {state === "checking"
          ? (tr ? "Kontrol ediliyor…" : "Checking…")
          : hasPending
            ? (tr ? "Son gönderimin teslimatını kontrol et" : "Check latest delivery")
            : (tr ? "Mevcut mesajı Technocore'da ara" : "Find current message on Technocore")}
      </button>
    </aside>
  );

  return createPortal(content, target);
}
