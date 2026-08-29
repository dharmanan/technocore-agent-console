"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearIdentity,
  createIdentity,
  exportIdentity,
  loadIdentity,
  saveIdentity,
  withIdentityProfile,
  type StoredIdentity,
} from "../lib/identity";
import {
  contributionNotePath,
  createMailbox,
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
type DraftProfile = { agentName: string; mailbox: string };

const APP_URL = "https://flop-console.vercel.app/";
const DEFAULT_MESSAGE_EN = "Hello Technocore, my agent is active.";
const DEFAULT_MESSAGE_TR = "Merhaba Technocore, agent'ım aktif.";
const DEFAULT_AGENT_NAME = "agent_console";

function draftProfileKey(did: string) {
  return `technocore-agent-console.draftProfile.${did}`;
}

function loadDraftProfile(did: string): DraftProfile | null {
  try {
    const raw = localStorage.getItem(draftProfileKey(did));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftProfile>;
    return {
      agentName: typeof parsed.agentName === "string" && parsed.agentName.trim() ? parsed.agentName : DEFAULT_AGENT_NAME,
      mailbox: typeof parsed.mailbox === "string" ? parsed.mailbox : "",
    };
  } catch {
    return null;
  }
}

function saveDraftProfile(did: string, next: DraftProfile) {
  localStorage.setItem(draftProfileKey(did), JSON.stringify(next));
}

function clearDraftProfile(did: string) {
  localStorage.removeItem(draftProfileKey(did));
}

function friendlyError(error: unknown, tr: boolean): { raw: string; display: string } {
  const raw = error instanceof Error ? error.message : tr ? "Bilinmeyen hata" : "Unknown error";

  if (raw.includes("PROFILE_PROOF_PENDING")) {
    return {
      raw,
      display: tr
        ? "İmzalı profil kanıtı henüz Technocore'dan geri okunamadı. Aynı profil yeniden gönderilmiyor; bağlantı düzeldiğinde tekrar doğrulayabilirsin."
        : "The signed profile proof has not been read back from Technocore yet. The same profile is not resent; verify again when the service is readable.",
    };
  }

  if (raw.includes("Service Unavailable") || raw.includes("503")) {
    return {
      raw,
      display: tr
        ? "Technocore bu işlemi şu anda doğrulayamıyor. Kimliğin ve mailbox'ın bu cihazda korunuyor."
        : "Technocore cannot verify this action right now. Your identity and mailbox remain stored on this device.",
    };
  }

  if (raw.toLowerCase().includes("timed out")) {
    return {
      raw,
      display: tr
        ? "Technocore zamanında cevap vermedi. Başarılı varsaymadık. Aynı işlemi art arda tekrarlama."
        : "Technocore did not respond in time. The console did not assume success. Do not repeat the same action rapidly.",
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
        ? "Çok kısa sürede fazla istek gönderildi. Bir süre bekleyip yalnız bir kez tekrar dene."
        : "Too many requests were sent in a short period. Wait, then retry only once.",
    };
  }

  return { raw, display: raw };
}

function ActionNotice({ status, tr }: { status?: ActionStatus; tr: boolean }) {
  if (!status) return null;
  const label = status.state === "success"
    ? (tr ? "TAMAM" : "DONE")
    : status.state === "error"
      ? (tr ? "DOĞRULANAMADI" : "NOT VERIFIED")
      : status.state === "pending"
        ? (tr ? "DOĞRULANIYOR" : "VERIFYING")
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
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME);
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

    if (current?.profile) {
      setAgentName(current.profile.agentName);
      setMailbox(current.profile.mailbox);
      saveDraftProfile(current.did, {
        agentName: current.profile.agentName,
        mailbox: current.profile.mailbox,
      });
    } else if (current) {
      const draft = loadDraftProfile(current.did);
      setAgentName(draft?.agentName || DEFAULT_AGENT_NAME);
      setMailbox(draft?.mailbox || "");
    } else {
      setAgentName(DEFAULT_AGENT_NAME);
      setMailbox("");
    }

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
        const proof = await proxyGet(`${publicProofPath(nextFp)}&n=${Date.now()}`);
        const complete = proof.includes(identity.did) && proof.includes("technocore-profile-v1");
        if (!cancelled) {
          setProfilePublished(complete);
          if (complete) localStorage.setItem(profileKey, "true");
          else localStorage.removeItem(profileKey);
        }
      } catch {
        // Keep the last locally confirmed state when Technocore cannot be read.
      }
    }

    hydrateProgress();
    return () => { cancelled = true; };
  }, [identity]);

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
      addEvent(tx("Action could not be verified", "İşlem doğrulanamadı"), detail.display, "warn");
    } finally {
      setBusy(null);
    }
  }

  function profileStageMessage(stage: ProfilePublishStage) {
    const messages: Record<ProfilePublishStage, [string, string]> = {
      "checking-index": ["Preparing your signed agent profile…", "İmzalı agent profilin hazırlanıyor…"],
      "writing-index": ["Preparing profile verification…", "Profil doğrulaması hazırlanıyor…"],
      "index-confirmed": ["Profile data prepared. Checking the signed proof…", "Profil bilgileri hazır. İmzalı kanıt kontrol ediliyor…"],
      "checking-proof": ["Checking for an existing signed profile proof…", "Daha önce doğrulanmış imzalı profil kanıtı kontrol ediliyor…"],
      "writing-proof": ["Sending your DID-signed profile proof to Technocore…", "DID anahtarınla imzalanmış profil kanıtı Technocore'a gönderiliyor…"],
      "proof-confirmed": ["Signed profile proof was read back from Technocore.", "İmzalı profil kanıtı Technocore'dan geri okunarak doğrulandı."],
    };
    const [en, turkish] = messages[stage];
    setStatus("profile", { state: "pending", message: tx(en, turkish) });
  }

  function resetLocalProfileState(did?: string) {
    if (did) clearDraftProfile(did);
    setAgentName(DEFAULT_AGENT_NAME);
    setMailbox("");
    setProfilePublished(false);
    setActivitySigned(false);
  }

  async function handleCreateIdentity() {
    await run(
      "identity",
      tx("Creating your private agent identity in this browser…", "Sana özel agent kimliği bu tarayıcıda oluşturuluyor…"),
      tx("Your identity key is ready. You can make an emergency key backup now, or finish step 2 for a full agent backup.", "Kimlik anahtarın hazır. İstersen şimdi acil durum anahtar yedeğini alabilir, tam agent yedeği için 2. adımı tamamlayabilirsin."),
      async () => {
        if (identity) resetLocalProfileState(identity.did);
        const next = await createIdentity();
        setIdentity(next);
        setAgentName(DEFAULT_AGENT_NAME);
        setMailbox("");
        saveDraftProfile(next.did, { agentName: DEFAULT_AGENT_NAME, mailbox: "" });
        addEvent(
          tx("Identity created", "Kimlik oluşturuldu"),
          tx("This is only the cryptographic identity until you verify the agent profile in step 2.", "2. adımda agent profilini doğrulayana kadar bu yalnız kriptografik kimliktir."),
        );
      },
    );
  }

  function handleCreateMailbox() {
    if (!identity) return;
    const next = createMailbox();
    setMailbox(next);
    saveDraftProfile(identity.did, { agentName, mailbox: next });
    setStatus("mailbox", {
      state: "success",
      message: tx("Your message box is ready locally and saved to this DID. Refreshing the page will keep it.", "Mesaj kutun hazır ve bu DID'e bağlı olarak kaydedildi. Sayfayı yenilediğinde kaybolmayacak."),
    });
    addEvent(tx("Message box created", "Mesaj kutusu oluşturuldu"), next, "info");
  }

  async function handlePublishProfile() {
    if (!identity) return;
    if (!mailbox) {
      setStatus("profile", { state: "error", message: tx("Create your message box first.", "Önce mesaj kutunu oluştur.") });
      return;
    }

    saveDraftProfile(identity.did, { agentName, mailbox });

    await run(
      "profile",
      tx("Signing your agent profile and verifying it from Technocore…", "Agent profilin imzalanıyor ve Technocore'dan geri okunarak doğrulanıyor…"),
      tx("Your signed agent profile was verified from Technocore. Full backup is now available.", "İmzalı agent profilin Technocore'dan geri okunarak doğrulandı. Tam agent yedeğin artık indirilebilir."),
      async () => {
        const result = await publishProfile(identity, agentName, mailbox, profileStageMessage);
        const normalizedAgent = agentName.trim().toLowerCase();
        const profiledIdentity = withIdentityProfile(identity, normalizedAgent, mailbox);
        setIdentity(profiledIdentity);
        setAgentName(normalizedAgent);
        saveDraftProfile(identity.did, { agentName: normalizedAgent, mailbox });
        localStorage.setItem(`technocore-agent-console.progress.${identity.did}.profile`, "true");
        setProfilePublished(true);
        addEvent(
          tx("Signed agent profile verified", "İmzalı agent profili doğrulandı"),
          tx(`Ownership proof: ${result.proof}.`, `Sahiplik kanıtı: ${result.proof}.`),
        );
      },
    );
  }

  async function handleSignedMessage() {
    if (!identity) return;
    const target = mailbox || "lobby";
    await run(
      "message",
      tx("Signing your message on this device and verifying it from Technocore…", "Mesajın bu cihazda imzalanıyor ve Technocore'dan geri okunarak doğrulanıyor…"),
      tx("Your verifiable activity was read back from Technocore.", "Doğrulanabilir aktiviten Technocore'dan geri okunarak doğrulandı."),
      async () => {
        await sendSignedMessage(identity, target, message);
        localStorage.setItem(`technocore-agent-console.progress.${identity.did}.activity`, "true");
        setActivitySigned(true);
        addEvent(tx("Verifiable activity confirmed", "Doğrulanabilir aktivite doğrulandı"), tx("The private key never left this browser.", "Özel anahtar bu tarayıcıdan hiç çıkmadı."));
      },
    );
  }

  async function handleContribution() {
    if (!identity) return;
    if (!contributionUrl.trim() || !contributionSummary.trim()) {
      setStatus("contribution", { state: "error", message: tx("Add a public project link and a short description first.", "Önce public proje bağlantını ve kısa açıklamanı ekle.") });
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
      "Technocore agent hazırlığımı tamamladım.", "",
      "Kendi agent kimliğimi oluşturdum, profilimi Technocore'a kaydettim ve kimliğimle imzalanmış doğrulanabilir bir aktivite gönderdim.", "",
      `Agent: ${agentName.trim().toLowerCase()}`, `DID: ${identity.did}`, `Proof: ${proofUrl}`, "",
      "Resmi FLOP testnet faucet ve erişim bilgileri yayınlandığında aynı akışın sonraki adımı burada devam edecek.", "",
      `Console: ${APP_URL}`, "", "#Technocore #FLOP",
    ] : [
      "My Technocore agent preparation is complete.", "",
      "I created my agent identity, saved my profile to Technocore and sent verifiable activity signed by my identity key.", "",
      `Agent: ${agentName.trim().toLowerCase()}`, `DID: ${identity.did}`, `Proof: ${proofUrl}`, "",
      "The next step will connect the official FLOP testnet faucet and access flow when those details are published.", "",
      `Console: ${APP_URL}`, "", "#Technocore #FLOP",
    ];
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text.join("\n"))}`, "_blank", "noopener,noreferrer");
  }

  function shareBuilderOnX() {
    if (!identity || !fp || !contributionPublished) return;
    const proofUrl = `https://technocore.chat${publicProofPath(fp)}`;
    const cleanSummary = contributionSummary.trim().replace(/\s+/g, " ");
    const shortSummary = cleanSummary.length > 220 ? `${cleanSummary.slice(0, 217)}...` : cleanSummary;
    const text = tr ? ["Technocore ekosistemi için geliştirdiğim public çalışmayı kimliğimle doğrulanabilir bir katkı kaydı olarak yayınladım.", "", `Katkı: ${shortSummary}`, `Proje: ${contributionUrl}`, `Proof: ${proofUrl}`, "", `Console: ${APP_URL}`, "", "#Technocore #FLOP"]
      : ["I published my public Technocore ecosystem work as a contribution record verifiable by my identity.", "", `Contribution: ${shortSummary}`, `Project: ${contributionUrl}`, `Proof: ${proofUrl}`, "", `Console: ${APP_URL}`, "", "#Technocore #FLOP"];
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text.join("\n"))}`, "_blank", "noopener,noreferrer");
  }

  function handleImport(file: File) {
    setStatus("identity", { state: "pending", message: tx("Reading your backup…", "Yedeğin okunuyor…") });
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const value = JSON.parse(String(reader.result)) as StoredIdentity;
        if (!value.did || !value.privateKeyJwk || !value.publicKeyJwk) throw new Error(tx("This is not a valid identity backup.", "Bu dosya geçerli bir kimlik yedeği değil."));

        if (identity) resetLocalProfileState(identity.did);
        saveIdentity(value);
        setIdentity(value);
        if (value.profile) {
          setAgentName(value.profile.agentName);
          setMailbox(value.profile.mailbox);
          saveDraftProfile(value.did, {
            agentName: value.profile.agentName,
            mailbox: value.profile.mailbox,
          });
          localStorage.setItem(`technocore-agent-console.progress.${value.did}.profile`, "true");
          setProfilePublished(true);
        } else {
          const draft = loadDraftProfile(value.did);
          setAgentName(draft?.agentName || DEFAULT_AGENT_NAME);
          setMailbox(draft?.mailbox || "");
        }
        setStatus("identity", {
          state: "success",
          message: value.profile
            ? tx("Full agent backup restored, including the verified profile and mailbox.", "Tam agent yedeği, doğrulanmış profil ve mailbox ile birlikte geri yüklendi.")
            : tx("Identity key backup restored. Any local draft for this DID was restored too.", "Kimlik anahtarı yedeği geri yüklendi. Bu DID için yerel taslak varsa o da geri getirildi."),
        });
      } catch (error) {
        const detail = friendlyError(error, tr);
        setStatus("identity", { state: "error", message: detail.display });
      }
    };
    reader.readAsText(file);
  }

  function handleForgetIdentity() {
    if (identity) {
      clearDraftProfile(identity.did);
      localStorage.removeItem(`technocore-agent-console.progress.${identity.did}.profile`);
      localStorage.removeItem(`technocore-agent-console.progress.${identity.did}.activity`);
    }
    clearIdentity();
    setIdentity(null);
    resetLocalProfileState();
    setFp("");
    setStatuses({});
    setStatus("identity", {
      state: "info",
      message: tx("Identity and its local draft profile were removed from this browser. Keep your backup if you want to restore them later.", "Kimlik ve bu DID'e ait yerel taslak profil tarayıcıdan kaldırıldı. Daha sonra geri yüklemek istiyorsan yedeğini sakla."),
    });
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
          <div className={`network ${serviceOnline === false ? "down" : ""}`}><span />{serviceOnline === null ? tx("checking connection", "bağlantı kontrol ediliyor") : serviceOnline ? tx("Technocore reachable", "Technocore bağlantısı aktif") : tx("Technocore unavailable", "Technocore erişilemiyor")}</div>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">{tx("PHASE 1 · AVAILABLE NOW", "PHASE 1 · ŞİMDİ YAPABİLİRSİN")}</p>
          <h1>{tx("Create your agent identity.", "Agent kimliğini oluştur.")}<br />{tx("Prove it is yours.", "Sana ait olduğunu kanıtla.")}</h1>
          <p className="heroCopy">{tx("Create a reusable agent identity, verify its signed profile on Technocore and send one verifiable activity. The FLOP testnet step will be added when official access details are published.", "Tekrar kullanabileceğin agent kimliğini oluştur, imzalı profilini Technocore'da doğrula ve ilk doğrulanabilir aktiviteni gönder. Resmi FLOP testnet erişim bilgileri yayınlandığında sonraki adım eklenecek.")}</p>
        </div>
        <div className={`heroStatus ${phaseOneReady ? "complete" : ""}`}><div className="statusOrb"><span>{phaseOneReady ? "✓" : `0${Math.min(currentStep, 3)}`}</span></div><div><strong>{phaseOneReady ? tx("You are ready for the next phase", "Sonraki aşama için hazırsın") : identity ? tx("Continue where you left off", "Kaldığın yerden devam et") : tx("Start by creating your identity", "Önce kimliğini oluştur")}</strong><small>{identity ? shortDid : tx("Create a new identity or restore your backup", "Yeni kimlik oluştur veya yedeğini geri yükle")}</small></div></div>
      </section>

      <nav className="progressRail" aria-label={tx("Setup progress", "Kurulum ilerlemesi")}>
        <div className={`progressStep ${identity ? "done" : currentStep === 1 ? "active" : ""}`}><i>{identity ? "✓" : "1"}</i><span><small>{tx("STEP 1", "ADIM 1")}</small><strong>{tx("Digital identity", "Dijital kimlik")}</strong></span></div><b aria-hidden="true" />
        <div className={`progressStep ${profilePublished ? "done" : currentStep === 2 ? "active" : ""}`}><i>{profilePublished ? "✓" : "2"}</i><span><small>{tx("STEP 2", "ADIM 2")}</small><strong>{tx("Agent profile", "Agent profili")}</strong></span></div><b aria-hidden="true" />
        <div className={`progressStep ${activitySigned ? "done" : currentStep === 3 ? "active" : ""}`}><i>{activitySigned ? "✓" : "3"}</i><span><small>{tx("STEP 3", "ADIM 3")}</small><strong>{tx("First activity", "İlk aktivite")}</strong></span></div><b aria-hidden="true" />
        <div className={`progressStep phaseTwoStep ${phaseOneReady ? "active ready" : "future"}`}><i>→</i><span><small>{tx("NEXT", "SONRAKİ")}</small><strong>FLOP testnet</strong></span></div>
      </nav>

      <div className="flowIntro phaseOneIntro"><div><span>{tx("WHAT YOU CAN DO TODAY", "BUGÜN YAPABİLECEKLERİN")}</span><strong>{tx("Create your identity, verify your signed profile and send one verifiable activity", "Kimliğini oluştur, imzalı profilini doğrula ve bir doğrulanabilir aktivite gönder")}</strong></div><p>{tx("Step 1 can export an emergency identity-key backup. After step 2 is verified, export the full agent backup from the profile card.", "1. adımda acil durum kimlik anahtarı yedeği alabilirsin. 2. adım doğrulandıktan sonra tam agent yedeğini profil kartından indir.")}</p></div>

      <section className="grid onboardingGrid">
        <article className={`panel identityPanel stepPanel ${currentStep === 1 ? "activeStep" : ""} ${identity ? "stepDone" : ""}`}>
          {currentStep === 1 && <StartCue label={tx("START HERE", "BURADAN BAŞLA")} />}
          <div className="panelHead"><span>01</span><h2>{tx("Your digital identity", "Dijital kimliğin")}</h2><em>{identity ? tx("READY", "HAZIR") : tx("START", "BAŞLA")}</em></div>
          <p className="muted">{tx("This creates only the cryptographic identity. The agent name and mailbox are added to the full backup after step 2 is verified.", "Bu adım yalnız kriptografik kimliği oluşturur. Agent adı ve mailbox, 2. adım doğrulandıktan sonra tam yedeğe eklenir.")}</p>
          <div className="didBox"><small>{tx("PUBLIC IDENTITY (DID)", "HERKESE AÇIK KİMLİĞİN (DID)")}</small><code>{identity?.did || tx("Create an identity to see your public ID", "Herkese açık kimliğini görmek için kimlik oluştur")}</code>{fp && <b>{tx("identity reference", "kimlik özeti")} {fp}</b>}</div>
          <div className="actions">
            {!identity ? <button className="primary" disabled={!!busy} onClick={handleCreateIdentity}>{busy === "identity" ? tx("Creating…", "Oluşturuluyor…") : tx("Create my identity", "Kimliğimi oluştur")}</button> : <button onClick={() => exportIdentity({ ...identity, profile: undefined })}>{tx("Download identity-key backup", "Kimlik anahtarı yedeğini indir")}</button>}
            <button onClick={() => importRef.current?.click()}>{tx("Restore from backup", "Yedekten geri yükle")}</button>
            {identity && <button className="danger" onClick={handleForgetIdentity}>{tx("Remove from this device", "Bu cihazdan kaldır")}</button>}
            <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && handleImport(event.target.files[0])} />
          </div>
          <ActionNotice status={statuses.identity} tr={tr} />
        </article>

        <article className={`panel stepPanel ${currentStep === 2 ? "activeStep" : ""} ${profilePublished ? "stepDone" : ""}`}>
          {currentStep === 2 && <StartCue label={tx("NEXT STEP", "SONRAKİ ADIM")} />}
          <div className="panelHead"><span>02</span><h2>{tx("Your agent profile", "Agent profilin")}</h2><em>{profilePublished ? tx("VERIFIED", "DOĞRULANDI") : "TECHNOCORE"}</em></div>
          <p className="muted">{tx("Choose the agent name and mailbox that belong to this DID. The profile is complete only after its DID-signed proof can be read back from Technocore.", "Bu DID'e ait agent adını ve mailbox'ı seç. Profil ancak DID ile imzalanmış kanıt Technocore'dan geri okunabildiğinde tamamlanır.")}</p>
          <label>{tx("Agent name", "Agent adı")}<input value={agentName} onChange={(e) => { const value = e.target.value; setAgentName(value); if (identity) saveDraftProfile(identity.did, { agentName: value, mailbox }); }} placeholder="my_agent" /></label>
          <label>{tx("Message box", "Mesaj kutusu")}<div className="inputAction"><input value={mailbox} onChange={(e) => { const value = e.target.value; setMailbox(value); if (identity) saveDraftProfile(identity.did, { agentName, mailbox: value }); }} placeholder="mb-p-..." /><button onClick={handleCreateMailbox}>{tx("Create", "Oluştur")}</button></div></label>
          <ActionNotice status={statuses.mailbox} tr={tr} />
          <button className="primary full" disabled={!identity || !mailbox || !!busy} onClick={handlePublishProfile}>{busy === "profile" ? tx("Signing and verifying…", "İmzalanıyor ve doğrulanıyor…") : profilePublished ? tx("Verify profile again", "Profili tekrar doğrula") : tx("Sign and verify profile", "Profili imzala ve doğrula")}</button>
          <ActionNotice status={statuses.profile} tr={tr} />
          {profilePublished && identity && (
            <button className="full" onClick={() => exportIdentity(identity)}>{tx("Download full agent backup", "Tam agent yedeğini indir")}</button>
          )}
        </article>

        <article className={`panel stepPanel ${currentStep === 3 ? "activeStep" : ""} ${activitySigned ? "stepDone" : ""}`}>
          {currentStep === 3 && <StartCue label={tx("NEXT STEP", "SONRAKİ ADIM")} />}
          <div className="panelHead"><span>03</span><h2>{tx("Your first verifiable activity", "İlk doğrulanabilir aktiviten")}</h2><em>{activitySigned ? tx("VERIFIED", "DOĞRULANDI") : tx("VERIFIABLE", "DOĞRULANABİLİR")}</em></div>
          <p className="muted">{tx("Write a short message. It is signed on this device and only counts as complete after it can be read back from Technocore.", "Kısa bir mesaj yaz. Mesaj bu cihazda imzalanır ve yalnız Technocore'dan geri okunabildiğinde tamamlanmış sayılır.")}</p>
          <label>{tx("Message to Technocore", "Technocore'a göndereceğin mesaj")}<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} /></label>
          <div className="signatureNote"><span>✓</span><p><strong>{tx("What happens when I send?", "Gönderince ne oluyor?")}</strong><br />{tx("The message is signed on this device. Your private key is never sent.", "Mesaj bu cihazda imzalanır. Özel anahtarın hiçbir yere gönderilmez.")}</p></div>
          <button className="primary full" disabled={!identity || !profilePublished || !!busy} onClick={handleSignedMessage}>{busy === "message" ? tx("Signing and verifying…", "İmzalanıyor ve doğrulanıyor…") : activitySigned ? tx("Send another verifiable activity", "Yeni doğrulanabilir aktivite gönder") : tx("Sign and send to Technocore", "İmzala ve Technocore'a gönder")}</button>
          <ActionNotice status={statuses.message} tr={tr} />
        </article>

        <article className={`panel testnet phaseTwoPanel ${phaseOneReady ? "phaseReady" : "phaseLocked"}`}>
          {phaseOneReady && <StartCue label={tx("PHASE 1 COMPLETE", "PHASE 1 TAMAM")} />}
          <div className="panelHead"><span>04</span><h2>FLOP testnet</h2><em>{tx("NOT OPEN YET", "HENÜZ AÇILMADI")}</em></div>
          <div className="phaseLabel">PHASE 2</div>
          <div className="testnetState"><span>{phaseOneReady ? tx("YOUR TECHNOCORE SETUP IS READY", "TECHNOCORE HAZIRLIĞIN TAMAM") : tx("FINISH THE THREE STEPS FIRST", "ÖNCE ÜÇ ADIMI TAMAMLA")}</span><strong>{tx("Get test FLOP → use inference → track activity", "Test FLOP al → inference kullan → aktiviteni takip et")}</strong><p>{tx("The official faucet access method and endpoints have not been published yet. When available, this section will continue with the same identity.", "Resmi faucet erişim yöntemi ve endpointler henüz yayınlanmadı. Kullanıma açıldığında bu bölüm aynı kimlikle devam edecek.")}</p></div>
          <div className="futureRows"><div><span>Faucet</span><b>{tx("Waiting for official access details", "Resmi erişim bilgileri bekleniyor")}</b></div><div><span>Test FLOP</span><b>{tx("Claim test tokens", "Test tokenlarını al")}</b></div><div><span>Inference</span><b>{tx("Use tokens for agent inference", "Tokenları agent inference için kullan")}</b></div><div><span>{tx("Activity", "Aktivite")}</span><b>{tx("Track usage and FLOP spent", "Kullanımı ve harcanan FLOP'u takip et")}</b></div></div>
          {participantReady && <button className="full shareReady" onClick={shareParticipantOnX}>{tx("Share my Technocore setup on X", "Technocore hazırlığımı X'te paylaş")}</button>}
        </article>
      </section>

      <section className="traceSection"><article className="panel trace"><div className="panelHead"><span>TRACE</span><h2>{tx("What happened here", "İşlem geçmişi")}</h2><em>{tx("THIS VISIT", "BU OTURUM")}</em></div><p className="muted">{tx("Only events from this browser session appear here. A success state means Technocore was read back, not merely that a request was sent.", "Burada yalnız bu tarayıcı oturumundaki işlemler görünür. Başarı durumu yalnız istek gönderildiği için değil, Technocore'dan geri okunabildiği için verilir.")}</p>{events.length === 0 ? <div className="empty">{tx("No actions yet. Follow the highlighted step above.", "Henüz işlem yok. Yukarıdaki vurgulanan adımdan devam et.")}</div> : events.map((event) => <div className="event" key={event.id}><i className={event.tone} /><div><strong>{event.title}</strong><small>{event.detail}</small></div></div>)}</article></section>

      <details className="builderDetails">
        <summary><div><span>{tx("FOR BUILDERS · OPTIONAL", "GELİŞTİRİCİLER İÇİN · İSTEĞE BAĞLI")}</span><strong>{tx("Built something for the Technocore ecosystem?", "Technocore ekosistemi için bir şey geliştirdin mi?")}</strong><small>{tx("Open this only if you have a public project, pull request, app or website to show.", "Yalnız public bir proje, pull request, uygulama veya web sitesi gösterebiliyorsan bu bölümü aç.")}</small></div><b aria-hidden="true">+</b></summary>
        <section className="builderGrid">
          <article className="panel builderPanel"><div className="panelHead"><span>BUILD</span><h2>{tx("Verify your contribution", "Katkını doğrula")}</h2><em>{tx("OPTIONAL", "İSTEĞE BAĞLI")}</em></div><label>{tx("Public project or contribution link", "Public proje veya katkı bağlantısı")}<input value={contributionUrl} onChange={(e) => setContributionUrl(e.target.value)} placeholder="https://github.com/you/project" /></label><label>{tx("What did you build or contribute?", "Ne geliştirdin veya neye katkı verdin?")}<textarea value={contributionSummary} onChange={(e) => setContributionSummary(e.target.value)} rows={4} /></label><button className="primary full" disabled={!builderReady || !!busy} onClick={handleContribution}>{busy === "contribution" ? tx("Publishing…", "Yayınlanıyor…") : tx("Publish contribution record", "Katkı kaydını yayınla")}</button><ActionNotice status={statuses.contribution} tr={tr} />{identity && fp && contributionPublished && <><div className="proofLinks"><a className="proofLink" target="_blank" rel="noreferrer" href={`https://technocore.chat${contributionNotePath(fp)}`}>{tx("Open contribution record ↗", "Katkı kaydını aç ↗")}</a><a className="proofLink" target="_blank" rel="noreferrer" href={`https://technocore.chat${publicProofPath(fp)}`}>{tx("Open identity proof ↗", "Kimlik kanıtını aç ↗")}</a></div><button className="full" onClick={shareBuilderOnX}>{tx("Share contribution on X", "Katkıyı X'te paylaş")}</button></>}</article>
          <article className="panel builderGuide"><div className="panelHead"><span>INFO</span><h2>{tx("What can I add here?", "Buraya ne ekleyebilirim?")}</h2><em>{tx("PUBLIC WORK", "PUBLIC ÇALIŞMA")}</em></div><p className="muted">{tx("Use this only for work that anyone can open and verify.", "Bu bölümü yalnız herkesin açıp doğrulayabileceği çalışmalar için kullan.")}</p></article>
        </section>
      </details>

      <footer><span>Open source · Browser native keys · Signed proof verification</span><a href="https://github.com/dharmanan/technocore-agent-console" target="_blank" rel="noreferrer">Source on GitHub ↗</a></footer>
    </main>
  );
}
