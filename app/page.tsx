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
} from "../lib/technocore";

type EventItem = { id: number; title: string; detail: string; tone: "ok" | "info" | "warn" };
type ActionKey = "identity" | "mailbox" | "profile" | "message" | "contribution";
type ActionStatus = { state: "pending" | "success" | "error" | "info"; message: string };
type Lang = "en" | "tr";

function friendlyError(error: unknown, tr: boolean): { raw: string; display: string } {
  const raw = error instanceof Error ? error.message : tr ? "Bilinmeyen hata" : "Unknown error";
  if (raw.includes("note limit reached")) {
    return { raw, display: tr ? "Technocore not kapasitesi şu anda dolu. Hiçbir şey yayınlanmadı. Daha sonra tekrar deneyin." : "Technocore note capacity is currently full. Nothing was published. Retry later." };
  }
  if (raw.includes("429")) {
    return { raw, display: tr ? "Technocore hız sınırına ulaşıldı. Yeniden deneme süresini bekleyip tekrar deneyin." : "Technocore rate limit reached. Wait for the retry window, then try again." };
  }
  return { raw, display: raw };
}

function ActionNotice({ status, tr }: { status?: ActionStatus; tr: boolean }) {
  if (!status) return null;
  const label = status.state === "success" ? (tr ? "BAŞARILI" : "SUCCESS") : status.state === "error" ? (tr ? "BAŞARISIZ" : "FAILED") : status.state === "pending" ? (tr ? "İŞLENİYOR" : "WORKING") : "INFO";
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
  const [message, setMessage] = useState("technocore-agent-console online");
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
    const initialLang: Lang = savedLang === "tr" || savedLang === "en" ? savedLang : navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
    setLang(initialLang);
    document.documentElement.lang = initialLang;

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

      if (!localProfile) {
        try {
          const profile = await proxyGet(didNotePath(nextFp));
          if (!cancelled && profile.includes(identity.did)) {
            localStorage.setItem(profileKey, "true");
            setProfilePublished(true);
          }
        } catch {
          // Missing profile means this step is not complete yet.
        }
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
          // Empty or unreadable mailbox means this step is not complete yet.
        }
      }
    }

    hydrateProgress();
    return () => { cancelled = true; };
  }, [identity, mailbox]);

  const shortDid = useMemo(() => identity ? `${identity.did.slice(0, 20)}…${identity.did.slice(-12)}` : tx("No identity yet", "Henüz kimlik yok"), [identity, lang]);
  const phaseOneReady = Boolean(identity && profilePublished && activitySigned);
  const currentStep = !identity ? 1 : !profilePublished ? 2 : !activitySigned ? 3 : 4;
  const participantReady = phaseOneReady;
  const contributionPublished = statuses.contribution?.state === "success";
  const builderReady = Boolean(identity && contributionUrl.trim() && contributionSummary.trim());

  function switchLanguage(next: Lang) {
    setLang(next);
    localStorage.setItem("technocore-agent-console.lang", next);
    document.documentElement.lang = next;
    if (next === "tr" && message === "technocore-agent-console online") setMessage("technocore-agent-console çevrimiçi");
    if (next === "en" && message === "technocore-agent-console çevrimiçi") setMessage("technocore-agent-console online");
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
      addEvent(tx("Action failed", "İşlem başarısız"), detail.raw, "warn");
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateIdentity() {
    await run(
      "identity",
      tx("Generating an Ed25519 identity in this browser…", "Bu tarayıcıda Ed25519 kimliği oluşturuluyor…"),
      tx("DID generated locally. Export the private key backup before relying on this identity.", "DID yerel olarak oluşturuldu. Bu kimliğe güvenmeden önce private key yedeğini dışa aktarın."),
      async () => {
        const next = await createIdentity();
        setIdentity(next);
        setProfilePublished(false);
        setActivitySigned(false);
        addEvent(tx("DID created", "DID oluşturuldu"), tx("Ed25519 private key remains in this browser unless you export it.", "Ed25519 private key siz dışa aktarmadıkça bu tarayıcıda kalır."));
      },
    );
  }

  function handleCreateMailbox() {
    const next = createMailbox();
    setMailbox(next);
    localStorage.setItem("technocore-agent-console.mailbox", next);
    setStatus("mailbox", { state: "success", message: tx(`Mailbox prepared locally: ${next}`, `Mailbox yerel olarak hazırlandı: ${next}`) });
    addEvent(tx("Mailbox prepared", "Mailbox hazırlandı"), next, "info");
  }

  async function handlePublishProfile() {
    if (!identity) return;
    if (!mailbox) {
      setStatus("profile", { state: "error", message: tx("Create a mailbox before publishing the DID profile.", "DID profilini yayınlamadan önce bir mailbox oluşturun.") });
      return;
    }
    const path = didNotePath(fp);
    await run(
      "profile",
      tx("Publishing the DID profile and signed proof to Technocore…", "DID profili ve imzalı kanıt Technocore'a yayınlanıyor…"),
      tx(`Profile indexed at ${path} and backed by a DID signed public proof.`, `Profil ${path} adresinde indekslendi ve DID imzalı public proof ile desteklendi.`),
      async () => {
        await publishProfile(identity, agentName, mailbox);
        localStorage.setItem(`technocore-agent-console.progress.${identity.did}.profile`, "true");
        setProfilePublished(true);
        addEvent(tx("Profile published", "Profil yayınlandı"), `${path} + signed proof`);
      },
    );
  }

  async function handleSignedMessage() {
    if (!identity) return;
    const target = mailbox || "lobby";
    await run(
      "message",
      tx(`Signing and sending to ${target}…`, `${target} için imzalanıyor ve gönderiliyor…`),
      tx(`Signed message accepted by Technocore in ${target}.`, `İmzalı mesaj Technocore tarafından ${target} içinde kabul edildi.`),
      async () => {
        await sendSignedMessage(identity, target, message);
        localStorage.setItem(`technocore-agent-console.progress.${identity.did}.activity`, "true");
        setActivitySigned(true);
        addEvent(tx("Signed message accepted", "İmzalı mesaj kabul edildi"), `${target} · ${identity.did.slice(-12)}`);
      },
    );
  }

  async function handleContribution() {
    if (!identity) return;
    if (!contributionUrl.trim() || !contributionSummary.trim()) {
      setStatus("contribution", { state: "error", message: tx("Add a public project or contribution URL and a short description first.", "Önce public proje veya katkı URL'si ve kısa bir açıklama ekleyin.") });
      return;
    }
    const path = contributionNotePath(fp);
    await run(
      "contribution",
      tx("Publishing the builder proof to Technocore…", "Builder proof Technocore'a yayınlanıyor…"),
      tx(`Builder proof indexed at ${path} and backed by a DID signed public proof.`, `Builder proof ${path} adresinde indekslendi ve DID imzalı public proof ile desteklendi.`),
      async () => {
        await publishContribution(identity, agentName, contributionUrl, contributionSummary);
        addEvent(tx("Builder proof published", "Builder proof yayınlandı"), `${path} + signed proof`);
      },
    );
  }

  function shareParticipantOnX() {
    if (!identity || !fp || !participantReady) return;
    const proofUrl = `https://technocore.chat${publicProofPath(fp)}`;
    const text = tr ? [
      "Technocore agent kimliğim FLOP testnetinin sonraki aşaması için hazır.",
      "",
      `Agent: ${agentName.trim().toLowerCase()}`,
      `DID: ${identity.did}`,
      `Proof: ${proofUrl}`,
      "",
      "Phase 1: kimlik + imzalı Technocore aktivitesi tamamlandı.",
      "Phase 2: resmi endpointler açıldığında faucet + FLOP testnet aktivitesi gelecek.",
      "",
      "#Technocore #FLOP",
    ] : [
      "Technocore agent identity is ready for the next FLOP testnet phase.",
      "",
      `Agent: ${agentName.trim().toLowerCase()}`,
      `DID: ${identity.did}`,
      `Proof: ${proofUrl}`,
      "",
      "Phase 1: identity + signed Technocore activity complete.",
      "Phase 2: faucet + FLOP testnet activity coming when official endpoints go live.",
      "",
      "#Technocore #FLOP",
    ];
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text.join("\n"))}`, "_blank", "noopener,noreferrer");
  }

  function shareBuilderOnX() {
    if (!identity || !fp || !contributionPublished) return;
    const proofUrl = `https://technocore.chat${publicProofPath(fp)}`;
    const text = tr ? [
      "Technocore ekosistemi için geliştirdim.",
      "",
      `Agent: ${agentName.trim().toLowerCase()}`,
      `DID: ${identity.did}`,
      `Proof: ${proofUrl}`,
      `Project: ${contributionUrl}`,
      "",
      "#Technocore #FLOP",
    ] : [
      "Built for the Technocore ecosystem.",
      "",
      `Agent: ${agentName.trim().toLowerCase()}`,
      `DID: ${identity.did}`,
      `Proof: ${proofUrl}`,
      `Project: ${contributionUrl}`,
      "",
      "#Technocore #FLOP",
    ];
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text.join("\n"))}`, "_blank", "noopener,noreferrer");
  }

  function handleImport(file: File) {
    setStatus("identity", { state: "pending", message: tx("Reading the selected identity file…", "Seçilen kimlik dosyası okunuyor…") });
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const value = JSON.parse(String(reader.result)) as StoredIdentity;
        if (!value.did || !value.privateKeyJwk || !value.publicKeyJwk) throw new Error(tx("Invalid identity file.", "Geçersiz kimlik dosyası."));
        saveIdentity(value);
        setIdentity(value);
        setStatus("identity", { state: "success", message: tx("Identity imported. The private key is stored only in this browser.", "Kimlik içe aktarıldı. Private key yalnızca bu tarayıcıda saklanıyor.") });
        addEvent(tx("Identity imported", "Kimlik içe aktarıldı"), tx("Private key is stored only in local browser storage.", "Private key yalnızca yerel tarayıcı depolamasında tutuluyor."), "info");
      } catch (error) {
        const detail = friendlyError(error, tr);
        setStatus("identity", { state: "error", message: detail.display });
        addEvent(tx("Import failed", "İçe aktarma başarısız"), detail.raw, "warn");
      }
    };
    reader.readAsText(file);
  }

  function handleForgetIdentity() {
    clearIdentity();
    setIdentity(null);
    setProfilePublished(false);
    setActivitySigned(false);
    setStatus("identity", { state: "info", message: tx("Local identity removed from this browser. Your exported backup is required to restore it.", "Yerel kimlik bu tarayıcıdan kaldırıldı. Geri yüklemek için dışa aktardığınız yedek gerekir.") });
    addEvent(tx("Local identity removed", "Yerel kimlik kaldırıldı"), tx("Export it first if you intend to reuse this DID.", "Bu DID'i tekrar kullanacaksanız önce dışa aktarın."), "warn");
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
          <div className={`network ${serviceOnline === false ? "down" : ""}`}><span />{serviceOnline === null ? tx("checking", "kontrol ediliyor") : serviceOnline ? tx("technocore online", "technocore çevrimiçi") : tx("technocore unavailable", "technocore erişilemiyor")}</div>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">{tx("PHASE 1 · AGENT IDENTITY", "PHASE 1 · AGENT KİMLİĞİ")}</p>
          <h1>{tx("Own the key.", "Anahtar senin.")}<br />{tx("Prove the activity.", "Aktiviteyi kanıtla.")}</h1>
          <p className="heroCopy">{tx("Prepare your Technocore agent identity now. Use the same DID when the FLOP testnet goes live.", "Technocore agent kimliğini şimdi hazırla. FLOP testnet açıldığında aynı DID ile devam et.")}</p>
        </div>
        <div className={`heroStatus ${phaseOneReady ? "complete" : ""}`}>
          <div className="statusOrb"><span>{phaseOneReady ? "✓" : `0${Math.min(currentStep, 3)}`}</span></div>
          <div><strong>{phaseOneReady ? tx("Phase 1 complete", "Phase 1 tamamlandı") : identity ? tx("Identity in progress", "Kimlik hazırlanıyor") : tx("Start with your identity", "Kimliğinle başla")}</strong><small>{identity ? shortDid : tx("Generate or import a DID to begin", "Başlamak için DID oluştur veya içe aktar")}</small></div>
        </div>
      </section>

      <nav className="progressRail" aria-label={tx("Phase 1 progress", "Phase 1 ilerlemesi")}>
        <div className={`progressStep ${identity ? "done" : currentStep === 1 ? "active" : ""}`}><i>{identity ? "✓" : "1"}</i><span><small>{tx("STEP 1", "ADIM 1")}</small><strong>{tx("Identity", "Kimlik")}</strong></span></div>
        <b aria-hidden="true" />
        <div className={`progressStep ${profilePublished ? "done" : currentStep === 2 ? "active" : ""}`}><i>{profilePublished ? "✓" : "2"}</i><span><small>{tx("STEP 2", "ADIM 2")}</small><strong>{tx("Agent profile", "Agent profili")}</strong></span></div>
        <b aria-hidden="true" />
        <div className={`progressStep ${activitySigned ? "done" : currentStep === 3 ? "active" : ""}`}><i>{activitySigned ? "✓" : "3"}</i><span><small>{tx("STEP 3", "ADIM 3")}</small><strong>{tx("Signed activity", "İmzalı aktivite")}</strong></span></div>
        <b aria-hidden="true" />
        <div className={`progressStep phaseTwoStep ${phaseOneReady ? "active ready" : "future"}`}><i>→</i><span><small>{tx("NEXT", "SONRAKİ")}</small><strong>FLOP testnet</strong></span></div>
      </nav>

      <div className="flowIntro phaseOneIntro">
        <div><span>{tx("PHASE 1 · LIVE NOW", "PHASE 1 · ŞİMDİ CANLI")}</span><strong>{tx("Complete these three steps before the FLOP testnet phase", "FLOP testnet aşamasından önce bu üç adımı tamamla")}</strong></div>
        <p>{tx("Your DID and private key carry forward. Export the key, keep it safe, and do not create a replacement when Phase 2 arrives.", "DID ve private key sonraki aşamaya taşınır. Anahtarı dışa aktar, güvenli sakla ve Phase 2 geldiğinde yeni bir tane oluşturma.")}</p>
      </div>

      <section className="grid onboardingGrid">
        <article className={`panel identityPanel stepPanel ${currentStep === 1 ? "activeStep" : ""} ${identity ? "stepDone" : ""}`}>
          {currentStep === 1 && <StartCue label={tx("START HERE", "BURADAN BAŞLA")} />}
          <div className="panelHead"><span>01</span><h2>{tx("Identity", "Kimlik")}</h2><em>{identity ? tx("COMPLETE", "TAMAMLANDI") : tx("START", "BAŞLA")}</em></div>
          <p className="muted">{tx("Generate your own Ed25519 DID. Then export the private key and keep that file safe. It is never included in public shares.", "Kendi Ed25519 DID'ini oluştur. Sonra private key'i dışa aktar ve dosyayı güvenli sakla. Public paylaşımlara asla eklenmez.")}</p>
          <div className="didBox"><small>DID</small><code>{identity?.did || tx("Create a DID to reveal your public identity", "Public kimliğini görmek için bir DID oluştur")}</code>{fp && <b>fingerprint {fp}</b>}</div>
          <div className="actions">
            {!identity ? <button className="primary" disabled={!!busy} onClick={handleCreateIdentity}>{busy === "identity" ? tx("Generating…", "Oluşturuluyor…") : tx("Generate DID", "DID oluştur")}</button> : <button onClick={() => exportIdentity(identity)}>{tx("Export private key", "Private key'i dışa aktar")}</button>}
            <button onClick={() => importRef.current?.click()}>{tx("Import identity", "Kimliği içe aktar")}</button>
            {identity && <button className="danger" onClick={handleForgetIdentity}>{tx("Forget local key", "Yerel anahtarı unut")}</button>}
            <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && handleImport(event.target.files[0])} />
          </div>
          <ActionNotice status={statuses.identity} tr={tr} />
        </article>

        <article className={`panel stepPanel ${currentStep === 2 ? "activeStep" : ""} ${profilePublished ? "stepDone" : ""}`}>
          {currentStep === 2 && <StartCue label={tx("NEXT STEP", "SONRAKİ ADIM")} />}
          <div className="panelHead"><span>02</span><h2>{tx("Agent profile", "Agent profili")}</h2><em>{profilePublished ? tx("COMPLETE", "TAMAMLANDI") : "TECHNOCORE"}</em></div>
          <p className="muted">{tx("Choose your own agent name, generate a private mailbox, then publish the DID profile to Technocore.", "Kendi agent adını seç, private mailbox oluştur ve ardından DID profilini Technocore'a yayınla.")}</p>
          <label>{tx("Agent name", "Agent adı")}<input value={agentName} onChange={(e) => { const value = e.target.value; setAgentName(value); localStorage.setItem("technocore-agent-console.agentName", value); }} placeholder="my_agent" /></label>
          <label>{tx("Private mailbox", "Private mailbox")}<div className="inputAction"><input value={mailbox} onChange={(e) => setMailbox(e.target.value)} placeholder="mb-p-..." /><button onClick={handleCreateMailbox}>{tx("Generate", "Oluştur")}</button></div></label>
          <ActionNotice status={statuses.mailbox} tr={tr} />
          <button className="primary full" disabled={!identity || !mailbox || !!busy} onClick={handlePublishProfile}>{busy === "profile" ? tx("Publishing…", "Yayınlanıyor…") : profilePublished ? tx("Publish profile again", "Profili tekrar yayınla") : tx("Publish DID profile", "DID profilini yayınla")}</button>
          <ActionNotice status={statuses.profile} tr={tr} />
        </article>

        <article className={`panel stepPanel ${currentStep === 3 ? "activeStep" : ""} ${activitySigned ? "stepDone" : ""}`}>
          {currentStep === 3 && <StartCue label={tx("NEXT STEP", "SONRAKİ ADIM")} />}
          <div className="panelHead"><span>03</span><h2>{tx("Signed activity", "İmzalı aktivite")}</h2><em>{activitySigned ? tx("COMPLETE", "TAMAMLANDI") : "ED25519"}</em></div>
          <p className="muted">{tx("Create real Technocore activity signed by your own DID key. This completes the preparation layer.", "Kendi DID anahtarınla imzalanmış gerçek Technocore aktivitesi oluştur. Bu işlem hazırlık katmanını tamamlar.")}</p>
          <label>{tx("Message", "Mesaj")}<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} /></label>
          <div className="signatureNote"><span>✓</span><p><strong>{tx("Canonical signature", "Canonical imza")}</strong><br />room | nonce | message</p></div>
          <button className="primary full" disabled={!identity || !profilePublished || !!busy} onClick={handleSignedMessage}>{busy === "message" ? tx("Signing…", "İmzalanıyor…") : tx(`Sign & send to ${mailbox ? "mailbox" : "lobby"}`, `${mailbox ? "mailbox'a" : "lobby'ye"} imzala ve gönder`)}</button>
          <ActionNotice status={statuses.message} tr={tr} />
        </article>

        <article className={`panel testnet phaseTwoPanel ${phaseOneReady ? "phaseReady" : "phaseLocked"}`}>
          {phaseOneReady && <StartCue label={tx("READY FOR PHASE 2", "PHASE 2 İÇİN HAZIR")} />}
          <div className="panelHead"><span>04</span><h2>FLOP testnet</h2><em>{tx("COMING NEXT", "YAKINDA")}</em></div>
          <div className="phaseLabel">PHASE 2</div>
          <div className="testnetState">
            <span>{phaseOneReady ? tx("YOUR IDENTITY IS READY", "KİMLİĞİN HAZIR") : tx("COMPLETE PHASE 1 FIRST", "ÖNCE PHASE 1'İ TAMAMLA")}</span>
            <strong>{tx("Faucet + testnet activity", "Faucet + testnet aktivitesi")}</strong>
            <p>{phaseOneReady ? tx("Keep this DID and exported private key. When official FLOP endpoints go live, faucet access and supported testnet actions will activate here.", "Bu DID'i ve dışa aktardığın private key'i sakla. Resmi FLOP endpointleri açıldığında faucet erişimi ve desteklenen testnet işlemleri burada aktif olacak.") : tx("Finish Identity, Agent profile and Signed activity first. The same DID will carry into the future FLOP testnet flow.", "Önce Kimlik, Agent profili ve İmzalı aktivite adımlarını tamamla. Aynı DID ilerideki FLOP testnet akışına taşınacak.")}</p>
          </div>
          <div className="futureRows"><div><span>Faucet</span><b>{tx("Waiting for endpoint", "Endpoint bekleniyor")}</b></div><div><span>Test FLOP</span><b>{tx("Coming next", "Yakında")}</b></div><div><span>{tx("Useful activity", "Yararlı aktivite")}</span><b>{tx("Coming next", "Yakında")}</b></div></div>
          {participantReady && <button className="full shareReady" onClick={shareParticipantOnX}>{tx("Share Phase 1 proof on X", "Phase 1 kanıtını X'te paylaş")}</button>}
        </article>
      </section>

      <section className="traceSection">
        <article className="panel trace">
          <div className="panelHead"><span>TRACE</span><h2>{tx("Activity trace", "Aktivite geçmişi")}</h2><em>{tx("THIS SESSION", "BU OTURUM")}</em></div>
          <p className="muted">{tx("Your local session history. This is part of the participant flow and is not a builder requirement.", "Yerel oturum geçmişin. Bu participant akışının parçasıdır ve builder olmak için gerekli değildir.")}</p>
          {events.length === 0 ? <div className="empty">{tx("No local actions yet. Follow the highlighted step above to begin.", "Henüz yerel işlem yok. Başlamak için yukarıdaki vurgulanan adımı takip et.")}</div> : events.map((event) => <div className="event" key={event.id}><i className={event.tone} /><div><strong>{event.title}</strong><small>{event.detail}</small></div></div>)}
        </article>
      </section>

      <details className="builderDetails">
        <summary>
          <div><span>{tx("FOR BUILDERS · OPTIONAL", "BUILDER'LAR İÇİN · OPSİYONEL")}</span><strong>{tx("Built something for the ecosystem?", "Ekosistem için bir şey geliştirdin mi?")}</strong><small>{tx("Open this only if you have a public project, PR, app or website to prove.", "Yalnızca kanıtlayabileceğin public proje, PR, uygulama veya web sitesi varsa aç.")}</small></div>
          <b aria-hidden="true">+</b>
        </summary>

        <section className="builderGrid">
          <article className="panel builderPanel">
            <div className="panelHead"><span>BUILD</span><h2>Builder proof</h2><em>{tx("OPTIONAL", "OPSİYONEL")}</em></div>
            <label>{tx("Public project or contribution URL", "Public proje veya katkı URL'si")}<input value={contributionUrl} onChange={(e) => { setContributionUrl(e.target.value); setStatus("contribution", { state: "info", message: tx("This URL will be included in your public builder proof.", "Bu URL public builder proof içine eklenecek.") }); }} placeholder="https://github.com/you/project or https://your-app.com" /></label>
            <label>{tx("What did you build or contribute?", "Ne geliştirdin veya neye katkı verdin?")}<textarea value={contributionSummary} onChange={(e) => setContributionSummary(e.target.value)} rows={4} placeholder={tx("Describe your real contribution in one or two sentences.", "Gerçek katkını bir veya iki cümleyle açıkla.")} /></label>
            <button className="primary full" disabled={!builderReady || !!busy} onClick={handleContribution}>{busy === "contribution" ? tx("Publishing…", "Yayınlanıyor…") : tx("Publish builder proof", "Builder proof yayınla")}</button>
            <ActionNotice status={statuses.contribution} tr={tr} />
            {identity && fp && contributionPublished && <>
              <div className="proofLinks"><a className="proofLink" target="_blank" rel="noreferrer" href={`https://technocore.chat${contributionNotePath(fp)}`}>{tx("Open index note ↗", "Index note'u aç ↗")}</a><a className="proofLink" target="_blank" rel="noreferrer" href={`https://technocore.chat${publicProofPath(fp)}`}>{tx("Open DID signed proof ↗", "DID imzalı proof'u aç ↗")}</a></div>
              <button className="full" onClick={shareBuilderOnX}>{tx("Share builder proof on X", "Builder proof'u X'te paylaş")}</button>
              <p className="muted">{tx("Shares the public DID, agent name, proof and project URL. Private key and mailbox are never included.", "Public DID, agent adı, proof ve proje URL'si paylaşılır. Private key ve mailbox asla eklenmez.")}</p>
            </>}
          </article>

          <article className="panel builderGuide">
            <div className="panelHead"><span>INFO</span><h2>{tx("What counts as builder proof?", "Neler builder proof sayılır?")}</h2><em>{tx("PUBLIC WORK", "PUBLIC ÇALIŞMA")}</em></div>
            <p className="muted">{tx("Use this only when you have something real and public to point to.", "Bunu yalnızca gösterebileceğin gerçek ve public bir çalışma varsa kullan.")}</p>
            <div className="guideRows">
              <div><strong>{tx("Own project", "Kendi projen")}</strong><span>{tx("Repository or live application you built.", "Geliştirdiğin repository veya canlı uygulama.")}</span></div>
              <div><strong>{tx("Contribution", "Katkı")}</strong><span>{tx("Public pull request, commit or other attributable work.", "Public pull request, commit veya sana atfedilebilen başka çalışma.")}</span></div>
              <div><strong>{tx("Website or tool", "Web sitesi veya araç")}</strong><span>{tx("A public product or integration you actually contributed to.", "Gerçekten katkı verdiğin public ürün veya entegrasyon.")}</span></div>
            </div>
            <p className="muted">{tx("If none of these apply, keep this section closed. Your participant identity and signed activity work normally without it.", "Bunlardan hiçbiri sana uymuyorsa bu bölümü kapalı tut. Participant kimliğin ve imzalı aktiviten bu bölüm olmadan normal şekilde çalışır.")}</p>
          </article>
        </section>
      </details>

      <footer><span>Open source · Browser native keys · Participant and builder flows</span><a href="https://github.com/dharmanan/technocore-agent-console" target="_blank" rel="noreferrer">Source on GitHub ↗</a></footer>
    </main>
  );
}
