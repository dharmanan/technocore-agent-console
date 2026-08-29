"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearIdentity,
  createIdentity,
  exportIdentity,
  loadIdentity,
  saveIdentity,
  type StoredIdentity,
} from "../lib/identity";
import {
  contributionNotePath,
  createMailbox,
  didNotePath,
  fingerprint,
  proxyGet,
  publicProofPath,
  publishContribution,
  publishProfile,
  sendSignedMessage,
  type ProfilePublishStage,
} from "../lib/technocore";

type EventItem = { id: number; title: string; detail: string; tone: "ok" | "info" | "warn" };
type ActionKey = "identity" | "mailbox" | "profile" | "message" | "contribution";
type ActionStatus = { state: "pending" | "success" | "error" | "info"; message: string };
type Lang = "en" | "tr";

const APP_URL = "https://flop-console.vercel.app/";
const DEFAULT_MESSAGE_EN = "Hello Technocore, my agent is active.";
const DEFAULT_MESSAGE_TR = "Merhaba Technocore, agent'ım aktif.";

function friendlyError(error: unknown, tr: boolean): { raw: string; display: string } {
  const raw = error instanceof Error ? error.message : tr ? "Bilinmeyen hata" : "Unknown error";

  if (raw.includes("PROFILE_INDEX_PENDING")) {
    return {
      raw,
      display: tr
        ? "Technocore şu anda profil kaydını kabul etmiyor. Kimliğin ve mesaj kutun güvende. Biraz sonra tekrar dene; tamamlanan adımlar yeniden yapılmayacak."
        : "Technocore is not accepting the profile record right now. Your identity and mailbox are safe. Retry later; completed steps will not be repeated.",
    };
  }

  if (raw.includes("PROFILE_PROOF_PENDING")) {
    return {
      raw,
      display: tr
        ? "Profil kaydı hazır, ancak sahiplik kanıtı henüz Technocore'a ulaşmadı. Biraz sonra tekrar dene; yalnız eksik doğrulama tamamlanacak."
        : "The profile record is ready, but the ownership proof has not reached Technocore yet. Retry later; only the missing proof will be sent.",
    };
  }

  if (raw.includes("Service Unavailable") || raw.includes("503")) {
    return {
      raw,
      display: tr
        ? "Technocore'un bu işlemi yapan servisi şu anda geçici olarak kullanılamıyor. Biraz sonra tekrar dene."
        : "The Technocore service needed for this action is temporarily unavailable. Retry in a little while.",
    };
  }

  if (raw.toLowerCase().includes("timed out")) {
    return {
      raw,
      display: tr
        ? "Technocore zamanında cevap vermedi. İşlem tamamlandı diye varsaymadık. Biraz sonra güvenle tekrar deneyebilirsin."
        : "Technocore did not respond in time. The console did not assume success. You can safely retry later.",
    };
  }

  if (raw.includes("note limit reached")) {
    return {
      raw,
      display: tr
        ? "Technocore kayıt kapasitesi şu anda dolu. Hiçbir şey tamamlandı sayılmadı. Daha sonra tekrar dene."
        : "Technocore record capacity is currently full. Nothing was marked complete. Retry later.",
    };
  }

  if (raw.includes("429")) {
    return {
      raw,
      display: tr
        ? "Çok kısa sürede fazla istek gönderildi. Biraz bekleyip tekrar dene."
        : "Too many requests were sent in a short period. Wait a little and retry.",
    };
  }

  return { raw, display: raw };
}

function ActionNotice({ status, tr }: { status?: ActionStatus; tr: boolean }) {
  if (!status) return null;
  const label = status.state === "success"
    ? (tr ? "TAMAM" : "DONE")
    : status.state === "error"
      ? (tr ? "TAMAMLANAMADI" : "NOT COMPLETED")
      : status.state === "pending"
        ? (tr ? "DEVAM EDİYOR" : "IN PROGRESS")
        : (tr ? "BİLGİ" : "INFO");

  return (
    <div className={`actionNotice ${status.state}`} role={status.state === "error" ? "alert" : "status"}>
      <strong>{label}</strong>
      <span>{status.message}</span>
    </div>
  );
}

function StartCue({ label }: { label: string }) {
  return (
    <div className="startCue" aria-hidden="true">
      <span>{label}</span>
      <b>↓</b>
    </div>
  );
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [agentName, setAgentName] = useState("agent_console");
  const [mailbox, setMailbox] = useState("");
  const [message, setMessage] = useState(DEFAULT_MESSAGE_EN);
  const [contributionUrl, setContributionUrl] = useState("");
  const [contributionSummary, setContributionSummary] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [statuses, setStatuses] = useState<Partial<Record<ActionKey, ActionStatus>>>({});
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);
  const [fp, setFp] = useState("");
  const [profilePublished, setProfilePublished] = useState(false);
  const [activitySigned, setActivitySigned] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const tr = lang === "tr";
  const tx = (en: string, turkish: string) => tr ? turkish : en;

  useEffect(() => {
    const savedLang = localStorage.getItem("technocore-agent-console.lang") as Lang | null;
    const initialLang: Lang = savedLang === "tr" || savedLang === "en"
      ? savedLang
      : navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";

    setLang(initialLang);
    document.documentElement.lang = initialLang;
    if (initialLang === "tr") setMessage(DEFAULT_MESSAGE_TR);

    const current = loadIdentity();
    setIdentity(current);

    const savedAgentName = localStorage.getItem("technocore-agent-console.agentName");
    if (savedAgentName) setAgentName(savedAgentName);

    const savedMailbox = localStorage.getItem("technocore-agent-console.mailbox");
    if (savedMailbox) setMailbox(savedMailbox);

    proxyGet("/healthz").then(() => setServiceOnline(true)).catch(() => setServiceOnline(false));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrateProgress() {
      if (!identity) {
        setFp("");
        setProfilePublished(false);
        setActivitySigned(false);
        return;
      }

      const nextFp = await fingerprint(identity.did);
      if (cancelled) return;
      setFp(nextFp);

      const profileKey = `technocore-agent-console.progress.${identity.did}.profile`;
      const activityKey = `technocore-agent-console.progress.${identity.did}.activity`;
      const localProfile = localStorage.getItem(profileKey) === "true";
      const localActivity = localStorage.getItem(activityKey) === "true";
      setProfilePublished(localProfile);
      setActivitySigned(localActivity);

      try {
        const [profile, proof] = await Promise.all([
          proxyGet(didNotePath(nextFp)),
          proxyGet(publicProofPath(nextFp)),
        ]);
        const complete = profile.includes(identity.did) && proof.includes(identity.did) && proof.includes("technocore-profile-v1");
        if (!cancelled) {
          setProfilePublished(complete);
          if (complete) localStorage.setItem(profileKey, "true");
          else localStorage.removeItem(profileKey);
        }
      } catch {
        // If Technocore cannot be read right now, keep the last locally confirmed state.
      }

      if (!localActivity && mailbox) {
        try {
          const raw = await proxyGet(`/r/${mailbox}?format=json`);
          const room = JSON.parse(raw) as { messages?: Array<{ from?: string }> };
          const found = room.messages?.some((item) => item.from === identity.did) ?? false;
          if (!cancelled && found) {
            localStorage.setItem(activityKey, "true");
            setActivitySigned(true);
          }
        } catch {
          // No readable activity yet.
        }
      }
    }

    hydrateProgress();
    return () => { cancelled = true; };
  }, [identity, mailbox]);

  const shortDid = useMemo(
    () => identity ? `${identity.did.slice(0, 20)}…${identity.did.slice(-12)}` : tx("No identity yet", "Henüz kimlik yok"),
    [identity, lang],
  );

  const phaseOneReady = Boolean(identity && profilePublished && activitySigned);
  const currentStep = !identity ? 1 : !profilePublished ? 2 : !activitySigned ? 3 : 4;
  const participantReady = phaseOneReady;
  const contributionPublished = statuses.contribution?.state === "success";
  const builderReady = Boolean(identity && contributionUrl.trim() && contributionSummary.trim());

  function switchLanguage(next: Lang) {
    setLang(next);
    localStorage.setItem("technocore-agent-console.lang", next);
    document.documentElement.lang = next;
    if (next === "tr" && message === DEFAULT_MESSAGE_EN) setMessage(DEFAULT_MESSAGE_TR);
    if (next === "en" && message === DEFAULT_MESSAGE_TR) setMessage(DEFAULT_MESSAGE_EN);
  }

  function addEvent(title: string, detail: string, tone: EventItem["tone"] = "ok") {
    setEvents((items) => [{ id: Date.now() + Math.random(), title, detail, tone }, ...items].slice(0, 8));
  }

  function setStatus(key: ActionKey, status: ActionStatus) {
    setStatuses((current) => ({ ...current, [key]: status }));
  }

  async function run(key: ActionKey, pendingMessage: string, successMessage: string, action: () => Promise<void>) {
    setBusy(key);
    setStatus(key, { state: "pending", message: pendingMessage });
    try {
      await action();
      setStatus(key, { state: "success", message: successMessage });
    } catch (error) {
      const detail = friendlyError(error, tr);
      setStatus(key, { state: "error", message: detail.display });
      addEvent(tx("Action could not be completed", "İşlem tamamlanamadı"), detail.display, "warn");
    } finally {
      setBusy(null);
    }
  }

  function profileStageMessage(stage: ProfilePublishStage) {
    const messages: Record<ProfilePublishStage, [string, string]> = {
      "checking-index": ["Checking whether your profile is already saved…", "Profilinin daha önce kaydedilip kaydedilmediği kontrol ediliyor…"],
      "writing-index": ["Saving your agent profile to Technocore…", "Agent profilin Technocore'a kaydediliyor…"],
      "index-confirmed": ["Profile record confirmed. Checking ownership proof…", "Profil kaydı doğrulandı. Şimdi sahiplik kanıtı kontrol ediliyor…"],
      "checking-proof": ["Checking whether ownership is already proven…", "Kimliğin için sahiplik kanıtı daha önce gönderilmiş mi kontrol ediliyor…"],
      "writing-proof": ["Sending a signed proof that this identity is controlled by you…", "Bu kimliğin senin kontrolünde olduğunu gösteren imzalı kanıt gönderiliyor…"],
      "proof-confirmed": ["Profile and ownership proof confirmed.", "Profil ve sahiplik kanıtı doğrulandı."],
    };
    const [en, turkish] = messages[stage];
    setStatus("profile", { state: "pending", message: tx(en, turkish) });
  }

  async function handleCreateIdentity() {
    await run(
      "identity",
      tx("Creating your private agent identity in this browser…", "Sana özel agent kimliği bu tarayıcıda oluşturuluyor…"),
      tx("Your identity is ready. Download the backup file and keep it somewhere safe.", "Kimliğin hazır. Yedek dosyasını indir ve güvenli bir yerde sakla."),
      async () => {
        const next = await createIdentity();
        setIdentity(next);
        setProfilePublished(false);
        setActivitySigned(false);
        addEvent(
          tx("Identity created", "Kimlik oluşturuldu"),
          tx("Your private key stays in this browser unless you export the backup.", "Özel anahtarın, yedek dosyasını sen indirmedikçe bu tarayıcıdan çıkmaz."),
        );
      },
    );
  }

  function handleCreateMailbox() {
    const next = createMailbox();
    setMailbox(next);
    localStorage.setItem("technocore-agent-console.mailbox", next);
    setStatus("mailbox", {
      state: "success",
      message: tx("Your private message box is ready.", "Sana özel mesaj kutusu hazır."),
    });
    addEvent(tx("Private message box created", "Özel mesaj kutusu oluşturuldu"), next, "info");
  }

  async function handlePublishProfile() {
    if (!identity) return;
    if (!mailbox) {
      setStatus("profile", {
        state: "error",
        message: tx("Create your private message box first.", "Önce sana özel mesaj kutusunu oluştur."),
      });
      return;
    }

    const path = didNotePath(fp);
    await run(
      "profile",
      tx("Checking what is already saved before publishing…", "Yayınlamadan önce daha önce tamamlanan adımlar kontrol ediliyor…"),
      tx("Your agent profile is saved and ownership is verified.", "Agent profilin kaydedildi ve bu kimliğin sana ait olduğu doğrulandı."),
      async () => {
        const result = await publishProfile(identity, agentName, mailbox, profileStageMessage);
        localStorage.setItem(`technocore-agent-console.progress.${identity.did}.profile`, "true");
        setProfilePublished(true);
        addEvent(
          tx("Agent profile ready", "Agent profili hazır"),
          tx(`Profile record ${result.index}; ownership proof ${result.proof}.`, `Profil kaydı: ${result.index}; sahiplik kanıtı: ${result.proof}.`),
        );
      },
    );
  }

  async function handleSignedMessage() {
    if (!identity) return;
    const target = mailbox || "lobby";
    await run(
      "message",
      tx("Signing your message on this device and sending it to Technocore…", "Mesajın bu cihazda imzalanıyor ve Technocore'a gönderiliyor…"),
      tx("Your first verifiable activity reached Technocore.", "İlk doğrulanabilir aktiviten Technocore'a ulaştı."),
      async () => {
        await sendSignedMessage(identity, target, message);
        localStorage.setItem(`technocore-agent-console.progress.${identity.did}.activity`, "true");
        setActivitySigned(true);
        addEvent(
          tx("Verifiable activity sent", "Doğrulanabilir aktivite gönderildi"),
          tx("The message was signed by your identity key without exposing the private key.", "Mesaj kimlik anahtarınla imzalandı; özel anahtarın paylaşılmadı."),
        );
      },
    );
  }

  async function handleContribution() {
    if (!identity) return;
    if (!contributionUrl.trim() || !contributionSummary.trim()) {
      setStatus("contribution", {
        state: "error",
        message: tx("Add a public project link and a short description first.", "Önce public proje bağlantını ve kısa açıklamanı ekle."),
      });
      return;
    }

    const path = contributionNotePath(fp);
    await run(
      "contribution",
      tx("Publishing your public contribution record…", "Public katkı kaydın yayınlanıyor…"),
      tx("Your contribution record is now publicly verifiable.", "Katkı kaydın artık public olarak doğrulanabilir."),
      async () => {
        await publishContribution(identity, agentName, contributionUrl, contributionSummary);
        addEvent(tx("Contribution published", "Katkı yayınlandı"), path);
      },
    );
  }

  function shareParticipantOnX() {
    if (!identity || !fp || !participantReady) return;
    const proofUrl = `https://technocore.chat${publicProofPath(fp)}`;
    const text = tr ? [
      "Technocore agent hazırlığımı tamamladım.",
      "",
      "Kendi agent kimliğimi oluşturdum, profilimi Technocore'a kaydettim ve kimliğimle imzalanmış doğrulanabilir bir aktivite gönderdim.",
      "",
      `Agent: ${agentName.trim().toLowerCase()}`,
      `DID: ${identity.did}`,
      `Proof: ${proofUrl}`,
      "",
      "Resmi FLOP testnet faucet ve erişim bilgileri yayınlandığında aynı akışın sonraki adımı burada devam edecek.",
      "",
      `Console: ${APP_URL}`,
      "",
      "#Technocore #FLOP",
    ] : [
      "My Technocore agent preparation is complete.",
      "",
      "I created my agent identity, saved my profile to Technocore and sent verifiable activity signed by my identity key.",
      "",
      `Agent: ${agentName.trim().toLowerCase()}`,
      `DID: ${identity.did}`,
      `Proof: ${proofUrl}`,
      "",
      "The next step will connect the official FLOP testnet faucet and access flow when those details are published.",
      "",
      `Console: ${APP_URL}`,
      "",
      "#Technocore #FLOP",
    ];
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text.join("\n"))}`, "_blank", "noopener,noreferrer");
  }

  function shareBuilderOnX() {
    if (!identity || !fp || !contributionPublished) return;
    const proofUrl = `https://technocore.chat${publicProofPath(fp)}`;
    const cleanSummary = contributionSummary.trim().replace(/\s+/g, " ");
    const shortSummary = cleanSummary.length > 220 ? `${cleanSummary.slice(0, 217)}...` : cleanSummary;
    const text = tr ? [
      "Technocore ekosistemi için geliştirdiğim public çalışmayı kimliğimle doğrulanabilir bir katkı kaydı olarak yayınladım.",
      "",
      `Katkı: ${shortSummary}`,
      `Proje: ${contributionUrl}`,
      `Proof: ${proofUrl}`,
      "",
      `Console: ${APP_URL}`,
      "",
      "#Technocore #FLOP",
    ] : [
      "I published my public Technocore ecosystem work as a contribution record verifiable by my identity.",
      "",
      `Contribution: ${shortSummary}`,
      `Project: ${contributionUrl}`,
      `Proof: ${proofUrl}`,
      "",
      `Console: ${APP_URL}`,
      "",
      "#Technocore #FLOP",
    ];
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text.join("\n"))}`, "_blank", "noopener,noreferrer");
  }

  function handleImport(file: File) {
    setStatus("identity", {
      state: "pending",
      message: tx("Reading your identity backup…", "Kimlik yedeğin okunuyor…"),
    });

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const value = JSON.parse(String(reader.result)) as StoredIdentity;
        if (!value.did || !value.privateKeyJwk || !value.publicKeyJwk) {
          throw new Error(tx("This is not a valid identity backup.", "Bu dosya geçerli bir kimlik yedeği değil."));
        }
        saveIdentity(value);
        setIdentity(value);
        setStatus("identity", {
          state: "success",
          message: tx("Identity restored. The private key stays only in this browser.", "Kimlik geri yüklendi. Özel anahtar yalnızca bu tarayıcıda tutuluyor."),
        });
        addEvent(tx("Identity restored", "Kimlik geri yüklendi"), tx("The backup was loaded into this browser.", "Yedek bu tarayıcıya yüklendi."), "info");
      } catch (error) {
        const detail = friendlyError(error, tr);
        setStatus("identity", { state: "error", message: detail.display });
        addEvent(tx("Identity could not be restored", "Kimlik geri yüklenemedi"), detail.display, "warn");
      }
    };
    reader.readAsText(file);
  }

  function handleForgetIdentity() {
    clearIdentity();
    setIdentity(null);
    setProfilePublished(false);
    setActivitySigned(false);
    setStatus("identity", {
      state: "info",
      message: tx("Identity removed from this browser. You will need your backup file to restore it.", "Kimlik bu tarayıcıdan kaldırıldı. Geri yüklemek için yedek dosyana ihtiyacın olacak."),
    });
    addEvent(tx("Identity removed from this device", "Kimlik bu cihazdan kaldırıldı"), tx("Your public Technocore records are not deleted.", "Technocore'daki public kayıtların silinmez."), "warn");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brandMark">TC</span><span>Technocore Agent Console</span></div>
        <div className="topbarTools">
          <div className="languageSwitch" aria-label={tx("Language", "Dil")}>
            <button className={lang === "en" ? "active" : ""} onClick={() => switchLanguage("en")}>EN</button>
            <button className={lang === "tr" ? "active" : ""} onClick={() => switchLanguage("tr")}>TR</button>
          </div>
          <div className={`network ${serviceOnline === false ? "down" : ""}`}>
            <span />
            {serviceOnline === null
              ? tx("checking connection", "bağlantı kontrol ediliyor")
              : serviceOnline
                ? tx("Technocore reachable", "Technocore erişilebilir")
                : tx("Technocore unavailable", "Technocore erişilemiyor")}
          </div>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">{tx("PHASE 1 · AVAILABLE NOW", "PHASE 1 · ŞİMDİ YAPABİLİRSİN")}</p>
          <h1>{tx("Create your agent identity.", "Agent kimliğini oluştur.")}<br />{tx("Prove it is yours.", "Sana ait olduğunu kanıtla.")}</h1>
          <p className="heroCopy">
            {tx(
              "Create a reusable agent identity, save its profile to Technocore and send one verifiable activity. The FLOP testnet step will be added here when official access details are published.",
              "Bugün tekrar kullanabileceğin agent kimliğini oluştur, profilini Technocore'a kaydet ve ilk doğrulanabilir aktiviteni gönder. Resmi FLOP testnet erişim bilgileri yayınlandığında sonraki adım aynı akışa eklenecek.",
            )}
          </p>
        </div>

        <div className={`heroStatus ${phaseOneReady ? "complete" : ""}`}>
          <div className="statusOrb"><span>{phaseOneReady ? "✓" : `0${Math.min(currentStep, 3)}`}</span></div>
          <div>
            <strong>
              {phaseOneReady
                ? tx("You are ready for the next phase", "Sonraki aşama için hazırsın")
                : identity
                  ? tx("Continue where you left off", "Kaldığın yerden devam et")
                  : tx("Start by creating your identity", "Önce kimliğini oluştur")}
            </strong>
            <small>{identity ? shortDid : tx("Create a new identity or restore your backup", "Yeni kimlik oluştur veya yedeğini geri yükle")}</small>
          </div>
        </div>
      </section>

      <nav className="progressRail" aria-label={tx("Setup progress", "Kurulum ilerlemesi")}>
        <div className={`progressStep ${identity ? "done" : currentStep === 1 ? "active" : ""}`}>
          <i>{identity ? "✓" : "1"}</i><span><small>{tx("STEP 1", "ADIM 1")}</small><strong>{tx("Digital identity", "Dijital kimlik")}</strong></span>
        </div>
        <b aria-hidden="true" />
        <div className={`progressStep ${profilePublished ? "done" : currentStep === 2 ? "active" : ""}`}>
          <i>{profilePublished ? "✓" : "2"}</i><span><small>{tx("STEP 2", "ADIM 2")}</small><strong>{tx("Agent profile", "Agent profili")}</strong></span>
        </div>
        <b aria-hidden="true" />
        <div className={`progressStep ${activitySigned ? "done" : currentStep === 3 ? "active" : ""}`}>
          <i>{activitySigned ? "✓" : "3"}</i><span><small>{tx("STEP 3", "ADIM 3")}</small><strong>{tx("First activity", "İlk aktivite")}</strong></span>
        </div>
        <b aria-hidden="true" />
        <div className={`progressStep phaseTwoStep ${phaseOneReady ? "active ready" : "future"}`}>
          <i>→</i><span><small>{tx("NEXT", "SONRAKİ")}</small><strong>FLOP testnet</strong></span>
        </div>
      </nav>

      <div className="flowIntro phaseOneIntro">
        <div>
          <span>{tx("WHAT YOU CAN DO TODAY", "BUGÜN YAPABİLECEKLERİN")}</span>
          <strong>{tx("Create your identity, save your profile and send one verifiable activity", "Kimliğini oluştur, profilini kaydet ve bir doğrulanabilir aktivite gönder")}</strong>
        </div>
        <p>
          {tx(
            "Download the identity backup and keep it safe. Your private key never needs to leave your browser. The official FLOP faucet step will appear here when it becomes available.",
            "Kimlik yedeğini indir ve güvenli sakla. Özel anahtarının tarayıcıdan çıkmasına gerek yok. Resmi FLOP faucet adımı kullanıma açıldığında burada görünecek.",
          )}
        </p>
      </div>

      <section className="grid onboardingGrid">
        <article className={`panel identityPanel stepPanel ${currentStep === 1 ? "activeStep" : ""} ${identity ? "stepDone" : ""}`}>
          {currentStep === 1 && <StartCue label={tx("START HERE", "BURADAN BAŞLA")} />}
          <div className="panelHead">
            <span>01</span><h2>{tx("Your digital identity", "Dijital kimliğin")}</h2><em>{identity ? tx("READY", "HAZIR") : tx("START", "BAŞLA")}</em>
          </div>
          <p className="muted">
            {tx(
              "This creates a unique identity for your Technocore agent. The private key stays in this browser. After creating it, download the backup file and keep it safe.",
              "Bu adım Technocore agent'ın için sana özel bir kimlik oluşturur. Özel anahtar yalnız bu tarayıcıda kalır. Oluşturduktan sonra yedek dosyasını indir ve güvenli sakla.",
            )}
          </p>
          <div className="didBox">
            <small>{tx("PUBLIC IDENTITY (DID)", "HERKESE AÇIK KİMLİĞİN (DID)")}</small>
            <code>{identity?.did || tx("Create an identity to see your public ID", "Herkese açık kimliğini görmek için kimlik oluştur")}</code>
            {fp && <b>{tx("identity reference", "kimlik özeti")} {fp}</b>}
          </div>
          <div className="actions">
            {!identity
              ? <button className="primary" disabled={!!busy} onClick={handleCreateIdentity}>{busy === "identity" ? tx("Creating…", "Oluşturuluyor…") : tx("Create my identity", "Kimliğimi oluştur")}</button>
              : <button onClick={() => exportIdentity(identity)}>{tx("Download backup", "Yedek dosyasını indir")}</button>}
            <button onClick={() => importRef.current?.click()}>{tx("Restore from backup", "Yedekten geri yükle")}</button>
            {identity && <button className="danger" onClick={handleForgetIdentity}>{tx("Remove from this device", "Bu cihazdan kaldır")}</button>}
            <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && handleImport(event.target.files[0])} />
          </div>
          <ActionNotice status={statuses.identity} tr={tr} />
        </article>

        <article className={`panel stepPanel ${currentStep === 2 ? "activeStep" : ""} ${profilePublished ? "stepDone" : ""}`}>
          {currentStep === 2 && <StartCue label={tx("NEXT STEP", "SONRAKİ ADIM")} />}
          <div className="panelHead">
            <span>02</span><h2>{tx("Your agent profile", "Agent profilin")}</h2><em>{profilePublished ? tx("READY", "HAZIR") : "TECHNOCORE"}</em>
          </div>
          <p className="muted">
            {tx(
              "Give your agent a name and create a private message box. Then save the profile to Technocore. If a previous attempt stopped halfway, the console continues only from the missing step.",
              "Agent'ına bir ad ver ve sana özel bir mesaj kutusu oluştur. Sonra profilini Technocore'a kaydet. Önceki deneme yarıda kaldıysa uygulama yalnız eksik adımdan devam eder.",
            )}
          </p>
          <label>{tx("Agent name", "Agent adı")}
            <input value={agentName} onChange={(e) => { const value = e.target.value; setAgentName(value); localStorage.setItem("technocore-agent-console.agentName", value); }} placeholder="my_agent" />
          </label>
          <label>{tx("Private message box", "Özel mesaj kutusu")}
            <div className="inputAction">
              <input value={mailbox} onChange={(e) => setMailbox(e.target.value)} placeholder="mb-p-..." />
              <button onClick={handleCreateMailbox}>{tx("Create", "Oluştur")}</button>
            </div>
          </label>
          <ActionNotice status={statuses.mailbox} tr={tr} />
          <button className="primary full" disabled={!identity || !mailbox || !!busy} onClick={handlePublishProfile}>
            {busy === "profile"
              ? tx("Saving and verifying…", "Kaydediliyor ve doğrulanıyor…")
              : profilePublished
                ? tx("Check profile again", "Profili tekrar kontrol et")
                : tx("Save profile to Technocore", "Profili Technocore'a kaydet")}
          </button>
          <ActionNotice status={statuses.profile} tr={tr} />
        </article>

        <article className={`panel stepPanel ${currentStep === 3 ? "activeStep" : ""} ${activitySigned ? "stepDone" : ""}`}>
          {currentStep === 3 && <StartCue label={tx("NEXT STEP", "SONRAKİ ADIM")} />}
          <div className="panelHead">
            <span>03</span><h2>{tx("Your first verifiable activity", "İlk doğrulanabilir aktiviten")}</h2><em>{activitySigned ? tx("READY", "HAZIR") : tx("VERIFIABLE", "DOĞRULANABİLİR")}</em>
          </div>
          <p className="muted">
            {tx(
              "Write a short message. When you send it, the message is signed on this device with your identity key and sent to Technocore. This proves you control the agent identity without sharing your private key.",
              "Kısa bir mesaj yaz. Gönderdiğinde mesaj bu cihazdaki kimlik anahtarınla imzalanır ve Technocore'a iletilir. Böylece özel anahtarını paylaşmadan bu agent kimliğini senin kontrol ettiğin doğrulanabilir.",
            )}
          </p>
          <label>{tx("Message to Technocore", "Technocore'a göndereceğin mesaj")}
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} />
          </label>
          <div className="signatureNote">
            <span>✓</span>
            <p>
              <strong>{tx("What happens when I send?", "Gönderince ne oluyor?")}</strong><br />
              {tx("The message is signed on this device. Your private key is never sent.", "Mesaj bu cihazda imzalanır. Özel anahtarın hiçbir yere gönderilmez.")}
            </p>
          </div>
          <button className="primary full" disabled={!identity || !profilePublished || !!busy} onClick={handleSignedMessage}>
            {busy === "message" ? tx("Signing and sending…", "İmzalanıyor ve gönderiliyor…") : tx("Sign and send to Technocore", "İmzala ve Technocore'a gönder")}
          </button>
          <ActionNotice status={statuses.message} tr={tr} />
        </article>

        <article className={`panel testnet phaseTwoPanel ${phaseOneReady ? "phaseReady" : "phaseLocked"}`}>
          {phaseOneReady && <StartCue label={tx("PHASE 1 COMPLETE", "PHASE 1 TAMAM")}/>} 
          <div className="panelHead"><span>04</span><h2>FLOP testnet</h2><em>{tx("NOT OPEN YET", "HENÜZ AÇILMADI")}</em></div>
          <div className="phaseLabel">PHASE 2</div>
          <div className="testnetState">
            <span>{phaseOneReady ? tx("YOUR TECHNOCORE SETUP IS READY", "TECHNOCORE HAZIRLIĞIN TAMAM") : tx("FINISH THE THREE STEPS FIRST", "ÖNCE ÜÇ ADIMI TAMAMLA")}</span>
            <strong>{tx("Get test FLOP → use inference → track activity", "Test FLOP al → inference kullan → aktiviteni takip et")}</strong>
            <p>
              {tx(
                "The official faucet access method and endpoints have not been published yet. When they are available, this section will let you continue with the same identity instead of starting over.",
                "Resmi faucet erişim yöntemi ve endpointler henüz yayınlanmadı. Kullanıma açıldığında bu bölüm aynı kimlikle devam etmeni sağlayacak; baştan başlaman gerekmeyecek.",
              )}
            </p>
          </div>
          <div className="futureRows">
            <div><span>Faucet</span><b>{tx("Waiting for official access details", "Resmi erişim bilgileri bekleniyor")}</b></div>
            <div><span>Test FLOP</span><b>{tx("Claim test tokens", "Test tokenlarını al")}</b></div>
            <div><span>Inference</span><b>{tx("Use tokens for agent inference", "Tokenları agent inference için kullan")}</b></div>
            <div><span>{tx("Activity", "Aktivite")}</span><b>{tx("Track usage and FLOP spent", "Kullanımı ve harcanan FLOP'u takip et")}</b></div>
          </div>
          {participantReady && <button className="full shareReady" onClick={shareParticipantOnX}>{tx("Share my Technocore setup on X", "Technocore hazırlığımı X'te paylaş")}</button>}
        </article>
      </section>

      <section className="traceSection">
        <article className="panel trace">
          <div className="panelHead"><span>TRACE</span><h2>{tx("What happened here", "İşlem geçmişi")}</h2><em>{tx("THIS VISIT", "BU OTURUM")}</em></div>
          <p className="muted">
            {tx(
              "Actions you take on this page appear here, including successful and failed attempts. This helps you understand what actually reached Technocore.",
              "Bu sayfada yaptığın işlemler burada görünür. Başarılı ve tamamlanamayan denemeleri ayrı ayrı görebilir, Technocore'a gerçekten neyin ulaştığını anlayabilirsin.",
            )}
          </p>
          {events.length === 0
            ? <div className="empty">{tx("No actions yet. Follow the highlighted step above.", "Henüz işlem yok. Yukarıdaki vurgulanan adımdan devam et.")}</div>
            : events.map((event) => <div className="event" key={event.id}><i className={event.tone} /><div><strong>{event.title}</strong><small>{event.detail}</small></div></div>)}
        </article>
      </section>

      <details className="builderDetails">
        <summary>
          <div>
            <span>{tx("FOR BUILDERS · OPTIONAL", "GELİŞTİRİCİLER İÇİN · İSTEĞE BAĞLI")}</span>
            <strong>{tx("Built something for the Technocore ecosystem?", "Technocore ekosistemi için bir şey geliştirdin mi?")}</strong>
            <small>{tx("Open this only if you have a public project, pull request, app or website to show.", "Yalnız public bir proje, pull request, uygulama veya web sitesi gösterebiliyorsan bu bölümü aç.")}</small>
          </div>
          <b aria-hidden="true">+</b>
        </summary>

        <section className="builderGrid">
          <article className="panel builderPanel">
            <div className="panelHead"><span>BUILD</span><h2>{tx("Verify your contribution", "Katkını doğrula")}</h2><em>{tx("OPTIONAL", "İSTEĞE BAĞLI")}</em></div>
            <label>{tx("Public project or contribution link", "Public proje veya katkı bağlantısı")}
              <input value={contributionUrl} onChange={(e) => { setContributionUrl(e.target.value); setStatus("contribution", { state: "info", message: tx("This public link will be included in your contribution record.", "Bu public bağlantı katkı kaydına eklenecek.") }); }} placeholder="https://github.com/you/project or https://your-app.com" />
            </label>
            <label>{tx("What did you build or contribute?", "Ne geliştirdin veya neye katkı verdin?")}
              <textarea value={contributionSummary} onChange={(e) => setContributionSummary(e.target.value)} rows={4} placeholder={tx("Explain your real contribution in one or two sentences.", "Gerçek katkını bir veya iki cümleyle anlat.")} />
            </label>
            <button className="primary full" disabled={!builderReady || !!busy} onClick={handleContribution}>{busy === "contribution" ? tx("Publishing…", "Yayınlanıyor…") : tx("Publish contribution record", "Katkı kaydını yayınla")}</button>
            <ActionNotice status={statuses.contribution} tr={tr} />
            {identity && fp && contributionPublished && <>
              <div className="proofLinks">
                <a className="proofLink" target="_blank" rel="noreferrer" href={`https://technocore.chat${contributionNotePath(fp)}`}>{tx("Open contribution record ↗", "Katkı kaydını aç ↗")}</a>
                <a className="proofLink" target="_blank" rel="noreferrer" href={`https://technocore.chat${publicProofPath(fp)}`}>{tx("Open identity proof ↗", "Kimlik kanıtını aç ↗")}</a>
              </div>
              <button className="full" onClick={shareBuilderOnX}>{tx("Share contribution on X", "Katkıyı X'te paylaş")}</button>
              <p className="muted">{tx("Only public identity and project information are shared. Your private key and private message box are never included.", "Yalnız herkese açık kimlik ve proje bilgileri paylaşılır. Özel anahtarın ve özel mesaj kutun asla eklenmez.")}</p>
            </>}
          </article>

          <article className="panel builderGuide">
            <div className="panelHead"><span>INFO</span><h2>{tx("What can I add here?", "Buraya ne ekleyebilirim?")}</h2><em>{tx("PUBLIC WORK", "PUBLIC ÇALIŞMA")}</em></div>
            <p className="muted">{tx("Use this only for work that anyone can open and verify.", "Bu bölümü yalnız herkesin açıp doğrulayabileceği çalışmalar için kullan.")}</p>
            <div className="guideRows">
              <div><strong>{tx("Your own project", "Kendi projen")}</strong><span>{tx("A repository or live application you built.", "Geliştirdiğin repository veya çalışan uygulama.")}</span></div>
              <div><strong>{tx("Code contribution", "Kod katkısı")}</strong><span>{tx("A public pull request, commit or other attributable work.", "Public pull request, commit veya sana ait olduğu görülebilen başka çalışma.")}</span></div>
              <div><strong>{tx("Website or tool", "Web sitesi veya araç")}</strong><span>{tx("A public product or integration you actually worked on.", "Gerçekten katkı verdiğin public ürün veya entegrasyon.")}</span></div>
            </div>
            <p className="muted">{tx("If you do not have public work to show, leave this section closed. It is not required for the three setup steps above.", "Gösterebileceğin public bir çalışma yoksa bu bölümü kapalı bırak. Yukarıdaki üç hazırlık adımı için gerekli değil.")}</p>
          </article>
        </section>
      </details>

      <footer><span>Open source · Browser native keys · Participant and builder flows</span><a href="https://github.com/dharmanan/technocore-agent-console" target="_blank" rel="noreferrer">Source on GitHub ↗</a></footer>
    </main>
  );
}
