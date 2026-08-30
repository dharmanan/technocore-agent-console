"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadIdentity, type StoredIdentity } from "../../lib/identity";
import { fingerprint, proxyGet, publicProofPath } from "../../lib/technocore";

type Lang = "en" | "tr";
type LiveMessage = { seq?: number; ts?: string; from?: string; text?: string };
type RoomPayload = { messages?: LiveMessage[] } | LiveMessage[];
type SourceMessage = LiveMessage & { source: "activity" | "mailbox" };
type Snapshot = {
  checkedAt: string;
  lastSeen: string;
  lastSeq: number | null;
  activity: LiveMessage[];
  profile: LiveMessage[];
  mailbox: LiveMessage[];
};

type ParsedProfile = { agent: string; mailbox: string };

function parseRoom(raw: string): LiveMessage[] {
  try {
    const parsed = JSON.parse(raw) as RoomPayload;
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch { return []; }
}

function isSystemProof(message: LiveMessage) {
  return Boolean(message.text?.startsWith("technocore-profile-v1") || message.text?.startsWith("technocore-builder-proof-v1"));
}

function parseProfile(text: string | undefined): ParsedProfile | null {
  if (!text?.startsWith("technocore-profile-v1")) return null;
  const agent = text.match(/(?:^|\s)agent:([a-z0-9_-]{1,48})(?:\s|$)/)?.[1];
  const mailbox = text.match(/(?:^|\s)mailbox:(mb-p-[a-zA-Z0-9_-]+)(?:\s|$)/)?.[1];
  return agent && mailbox ? { agent, mailbox } : null;
}

function formatStamp(value: string, tr: boolean) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat(tr ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "medium" }).format(parsed);
}

function cleanMessage(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function latestOf(messages: LiveMessage[]) {
  return [...messages].sort((a, b) => Date.parse(String(b.ts || "")) - Date.parse(String(a.ts || "")))[0];
}

function CopyButton({ value, label, tr }: { value: string; label: string; tr: boolean }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be unavailable (permissions, non-secure context); nothing to recover.
    }
  }
  return (
    <button type="button" className={`liveCopyBtn${copied ? " copied" : ""}`} onClick={handleCopy} aria-label={`${tr ? "Kopyala" : "Copy"} ${label}`}>
      {copied ? (tr ? "Kopyalandı" : "Copied") : (tr ? "Kopyala" : "Copy")}
    </button>
  );
}

export default function LiveActivityPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [mailbox, setMailbox] = useState("");
  const [fp, setFp] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<"checking" | "ok" | "partial" | "stale">("checking");
  const [connectionMessage, setConnectionMessage] = useState("");
  const retryMs = useRef(15000);
  const timerRef = useRef<number | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const tr = lang === "tr";
  const tx = (en: string, turkish: string) => tr ? turkish : en;

  useEffect(() => {
    const saved = localStorage.getItem("technocore-agent-console.lang") as Lang | null;
    const next: Lang = saved === "tr" || saved === "en" ? saved : navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
    setLang(next);
    const storedIdentity = loadIdentity();
    setIdentity(storedIdentity);
    setMailbox(storedIdentity?.profile?.mailbox || localStorage.getItem("technocore-agent-console.mailbox") || "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!identity) { setFp(""); setLoading(false); return; }
    fingerprint(identity.did).then((value) => {
      if (cancelled) return;
      setFp(value);
      try {
        const cached = localStorage.getItem(`technocore-agent-console.liveSnapshot.${identity.did}`);
        if (cached) {
          const parsedCache = JSON.parse(cached) as Snapshot;
          snapshotRef.current = parsedCache;
          setSnapshot(parsedCache);
        }
      } catch {
        // Ignore invalid local cache.
      }
    });
    return () => { cancelled = true; };
  }, [identity]);

  function scheduleNext() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(refresh, retryMs.current);
  }

  async function refresh() {
    if (!identity || !fp) return;
    setLoading(true);
    setConnection("checking");

    const proofPromise = proxyGet(`${publicProofPath(fp)}&n=${Date.now()}`);
    const mailboxPromise = mailbox ? proxyGet(`/r/${encodeURIComponent(mailbox)}?format=json&limit=200&n=${Date.now()}`) : Promise.resolve("");
    const [proofResult, mailboxResult] = await Promise.allSettled([proofPromise, mailboxPromise]);

    try {
      const own = (messages: LiveMessage[]) => messages.filter((m) => m.from === identity.did);
      const previous = snapshotRef.current;

      const proofMessages = proofResult.status === "fulfilled"
        ? own(parseRoom(proofResult.value))
        : [...(previous?.activity || []), ...(previous?.profile || [])];
      const proofActivity = proofMessages.filter((m) => !isSystemProof(m));
      const profile = proofMessages.filter(isSystemProof);
      const mailboxMessages = mailboxResult.status === "fulfilled"
        ? own(parseRoom(mailboxResult.value))
        : (previous?.mailbox || []);

      const all = [...proofActivity, ...profile, ...mailboxMessages];
      const latest = latestOf(all);
      const next: Snapshot = {
        checkedAt: new Date().toISOString(),
        lastSeen: String(latest?.ts || previous?.lastSeen || ""),
        lastSeq: typeof latest?.seq === "number" ? latest.seq : (previous?.lastSeq ?? null),
        activity: proofActivity,
        profile,
        mailbox: mailboxMessages,
      };

      snapshotRef.current = next;
      setSnapshot(next);
      localStorage.setItem(`technocore-agent-console.liveSnapshot.${identity.did}`, JSON.stringify(next));

      const proofOk = proofResult.status === "fulfilled";
      const mailboxOk = mailboxResult.status === "fulfilled";
      if (proofOk && mailboxOk) {
        setConnection("ok");
        setConnectionMessage("");
        retryMs.current = 15000;
      } else if (proofOk || mailboxOk) {
        setConnection("partial");
        setConnectionMessage(tx(
          "One Technocore source is delayed. The source that responded was refreshed and the last verified data from the other source is preserved.",
          "Technocore kaynaklarından biri gecikiyor. Cevap veren kaynak yenilendi ve diğer kaynağın son doğrulanmış verisi korunuyor.",
        ));
        retryMs.current = 30000;
      } else {
        setConnection("stale");
        setConnectionMessage(tx(
          "Technocore is temporarily not responding. The last verified data is being shown.",
          "Technocore geçici olarak yanıt vermiyor. Son doğrulanmış veriler gösteriliyor.",
        ));
        retryMs.current = Math.min(retryMs.current === 15000 ? 30000 : retryMs.current * 2, 60000);
      }
    } finally {
      setLoading(false);
      scheduleNext();
    }
  }

  useEffect(() => {
    if (!identity || !fp) return;
    refresh();
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [identity, fp, mailbox]);

  const shortDid = useMemo(() => identity ? `${identity.did.slice(0, 24)}…${identity.did.slice(-14)}` : "", [identity]);
  const proofUrl = identity && fp ? `https://technocore.chat${publicProofPath(fp)}` : "";
  const currentProfile = useMemo(() => {
    if (identity?.profile) return { agent: identity.profile.agentName, mailbox: identity.profile.mailbox };
    const parsed = snapshot?.profile.map((item) => parseProfile(item.text)).find(Boolean);
    return parsed || null;
  }, [identity, snapshot]);
  const profileVersions = useMemo(() => snapshot?.profile.map((item) => parseProfile(item.text)).filter((item): item is ParsedProfile => Boolean(item)) || [], [snapshot]);
  const previousProfileCount = Math.max(0, profileVersions.length - 1);
  const recent: SourceMessage[] = snapshot ? [
    ...snapshot.activity.map((m) => ({ ...m, source: "activity" as const })),
    ...snapshot.mailbox.map((m) => ({ ...m, source: "mailbox" as const })),
  ].sort((a, b) => Date.parse(String(b.ts || "")) - Date.parse(String(a.ts || ""))).slice(0, 16) : [];

  const identityFound = Boolean(snapshot && (snapshot.activity.length || snapshot.profile.length || snapshot.mailbox.length));
  const verifiedActivityCount = snapshot ? snapshot.activity.length + snapshot.mailbox.length : 0;
  const hasVerifiedActivity = verifiedActivityCount > 0;

  return (
    <main className="shell liveShell">
      <header className="topbar">
        <div className="brand"><span className="brandMark">TC</span><span>Technocore Agent Console</span></div>
        <div className="topbarTools"><a className="liveBack" href="/">← Console</a><a className="liveBack" href="/messages">{tx("Messages", "Mesajlar")}</a><div className="languageSwitch"><button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button><button className={lang === "tr" ? "active" : ""} onClick={() => setLang("tr")}>TR</button></div></div>
      </header>

      <section className="liveHero">
        <div><p className="eyebrow">{tx("LIVE ACTIVITY · READ ONLY", "CANLI AKTİVİTE · SALT OKUNUR")}</p><h1>{tx("See what Technocore can verify.", "Technocore'un doğrulayabildiğini gör.")}</h1><p>{tx(
          "This page shows the records Technocore can currently read for the DID loaded in this browser. If a live refresh is delayed, the last verified result remains visible.",
          "Bu sayfa tarayıcıya yüklenmiş DID için Technocore'un şu anda okuyabildiği doğrulanmış kayıtları gösterir. Canlı yenileme gecikirse son doğrulanmış sonuç ekranda kalır.",
        )}</p></div>
        <div className={`livePresence ${identityFound ? "seen" : ""}`}><span className="livePulse"/><div><small>{tx("AGENT STATUS", "AGENT DURUMU")}</small><strong>{!identity ? tx("No identity loaded", "Yüklü kimlik yok") : loading && !snapshot ? tx("Reading Technocore", "Technocore okunuyor") : identityFound ? tx("Technocore can read this DID", "Technocore bu DID'i okuyabiliyor") : tx("No matching records returned", "Eşleşen kayıt dönmedi")}</strong><code>{currentProfile?.agent || shortDid}</code></div></div>
      </section>

      {(connection === "stale" || connection === "partial") && <div className={`actionNotice ${connection === "stale" ? "error" : "info"} liveStaleNotice`}><strong>{connection === "stale" ? tx("LIVE REFRESH DELAYED", "CANLI YENİLEME GECİKTİ") : tx("PARTIAL REFRESH", "KISMİ YENİLEME")}</strong><span>{connectionMessage}</span></div>}

      {!identity ? <section className="panel liveEmpty"><div className="panelHead"><span>LIVE</span><h2>{tx("Identity required", "Kimlik gerekli")}</h2></div><p className="muted">{tx("Create or restore your identity in the console first.", "Önce console'da kimliğini oluştur veya geri yükle.")}</p><a className="liveButton" href="/">{tx("Open console", "Console'u aç")}</a></section> : <>
        <section className="liveMetrics">
          <article><small>{tx("DID FOUND", "DID BULUNDU")}</small><strong>{identityFound ? tx("YES", "EVET") : tx("NOT YET", "HENÜZ DEĞİL")}</strong><span>{identityFound ? tx("Technocore returned matching records", "Technocore eşleşen kayıt döndürdü") : tx("no matching records yet", "henüz eşleşen kayıt yok")}</span></article>
          <article><small>{tx("ACTIVE AGENT", "AKTİF AGENT")}</small><strong>{currentProfile?.agent || "—"}</strong><span>{tx("active verified profile", "aktif doğrulanmış profil")}</span></article>
          <article><small>{tx("VERIFIED ACTIVITY", "DOĞRULANMIŞ AKTİVİTE")}</small><strong>{snapshot ? verifiedActivityCount : "—"}</strong><span>{snapshot ? tx("messages read back from Technocore", "Technocore'dan geri okunan mesaj") : tx("waiting for first read", "ilk okuma bekleniyor")}</span></article>
          <article><small>{tx("LAST VERIFIED", "SON DOĞRULAMA")}</small><strong>{snapshot?.lastSeen ? formatStamp(snapshot.lastSeen, tr) : "—"}</strong><span>{snapshot?.lastSeq !== null && snapshot ? `seq ${snapshot.lastSeq}` : tx("no sequence yet", "henüz sequence yok")}</span></article>
        </section>

        <section className="liveGrid">
          <article className="panel liveFeed"><div className="panelHead"><span>TRACE</span><h2>{tx("Verified activity", "Doğrulanmış aktiviteler")}</h2><em>{connection === "ok" ? tx("LIVE", "CANLI") : tx("LAST VERIFIED", "SON DOĞRULANAN")}</em></div><p className="muted">{tx("Only signed activity successfully read back from Technocore is shown here. Profile system records are hidden from this feed.", "Burada yalnız Technocore'dan başarıyla geri okunmuş imzalı aktiviteler gösterilir. Profil sistem kayıtları bu akışta gösterilmez.")}</p>{recent.length === 0 ? <div className="empty">{loading ? tx("Reading Technocore…", "Technocore okunuyor…") : tx("No verified activity in the last successful read.", "Son başarılı okumada doğrulanmış aktivite yok.")}</div> : recent.map((item,index)=><div className="liveMessage" key={`${item.source}-${item.seq ?? index}-${item.ts ?? ""}`}><div className="liveMessageMeta"><span>{tx("VERIFIED", "DOĞRULANDI")}</span><span className="liveMessageSeq">{item.seq ? `#${item.seq}` : "—"}</span><time>{item.ts ? formatStamp(item.ts,tr) : "—"}</time></div><p>{cleanMessage(item.text)}</p><div className="liveMessageContext"><span>{tx("Agent", "Agent")}<code>{currentProfile?.agent || "—"}</code></span><span>DID<code>{shortDid}</code></span><span>{tx("Source", "Kaynak")}<code>{item.source === "mailbox" ? tx("mailbox", "mailbox") : tx("activity room", "aktivite odası")}</code></span>{item.source === "mailbox" && currentProfile?.mailbox && <span>{tx("Mailbox", "Mailbox")}<code>{currentProfile.mailbox}</code></span>}</div></div>)}</article>
          <article className="panel liveVerify"><div className="panelHead"><span>STATUS</span><h2>{tx("Live status", "Canlı durum")}</h2><em>READ ONLY</em></div><div className="liveActiveProfile"><small>{tx("ACTIVE PROFILE", "AKTİF PROFİL")}</small><strong>{currentProfile?.agent || tx("No verified profile yet", "Henüz doğrulanmış profil yok")}</strong></div><div className="liveSourceGuide"><strong>TECHNOCORE</strong><span>{connection === "ok" ? tx("Reachable — the latest refresh succeeded.", "Erişilebilir — son yenileme başarılı.") : connection === "checking" ? tx("Checking Technocore now.", "Technocore şu anda kontrol ediliyor.") : connection === "partial" ? tx("Partially reachable — one source is delayed.", "Kısmen erişilebilir — kaynaklardan biri gecikiyor.") : tx("Temporarily not responding. Showing the last verified data.", "Geçici olarak yanıt vermiyor. Son doğrulanmış veriler gösteriliyor.")}</span></div><div className="liveSourceGuide"><strong>{tx("LAST SUCCESSFUL READ", "SON BAŞARILI OKUMA")}</strong><span>{snapshot?.checkedAt ? formatStamp(snapshot.checkedAt, tr) : tx("not checked yet", "henüz kontrol edilmedi")}</span></div><div className="liveSourceGuide"><strong>{tx("AUTO REFRESH", "OTOMATİK YENİLEME")}</strong><span>{connection === "ok" ? tx("Active, about every 15 seconds.", "Aktif, yaklaşık 15 saniyede bir.") : connection === "checking" ? tx("Refreshing now…", "Şimdi yenileniyor…") : tx("Active with retry backoff until Technocore responds again.", "Technocore yeniden yanıt verene kadar bekleme süresi artırılarak deneniyor.")}</span></div><div className="liveSourceGuide"><strong>{tx("IDENTITY", "KİMLİK")}</strong><span>{identityFound ? tx("Technocore returned records matching this DID.", "Technocore bu DID ile eşleşen kayıtlar döndürdü.") : tx("No matching Technocore records in the last read.", "Son okumada eşleşen Technocore kaydı yok.")}</span></div><div className="liveSourceGuide"><strong>{tx("ACTIVITY", "AKTİVİTE")}</strong><span>{hasVerifiedActivity ? `${verifiedActivityCount} ${tx("verified messages", "doğrulanmış mesaj")}` : tx("No verified activity yet.", "Henüz doğrulanmış aktivite yok.")}</span></div>{currentProfile && <div className="liveKey"><small>{tx("AGENT", "AGENT")}</small><div className="liveKeyRow"><code>{currentProfile.agent}</code><CopyButton value={currentProfile.agent} label="agent" tr={tr} /></div></div>}<div className="liveKey"><small>DID</small><div className="liveKeyRow"><code>{identity.did}</code><CopyButton value={identity.did} label="DID" tr={tr} /></div></div>{(currentProfile?.mailbox || mailbox) && <div className="liveKey"><small>{tx("MAILBOX", "MAILBOX")}</small><div className="liveKeyRow"><code>{currentProfile?.mailbox || mailbox}</code><CopyButton value={currentProfile?.mailbox || mailbox} label="mailbox" tr={tr} /></div></div>}<div className="liveKey"><small>FINGERPRINT</small><code>{fp}</code></div>{previousProfileCount > 0 && <div className="liveSourceGuide"><strong>{tx("PROFILE HISTORY", "PROFİL GEÇMİŞİ")}</strong><span>{previousProfileCount} {tx("previous profile version — open Mailbox History to view.", "eski profil sürümü — görmek için Mailbox History'yi aç.")}</span></div>}<div className="liveActions"><button onClick={refresh} disabled={loading}>{loading ? tx("Refreshing…", "Yenileniyor…") : tx("Refresh now", "Şimdi yenile")}</button><a className="liveButton secondary" href="/messages/history">{tx("Open mailbox history", "Mailbox History'yi aç")}</a>{proofUrl && <a className="liveButton secondary" href={proofUrl} target="_blank" rel="noreferrer">{tx("Open DID proof room ↗", "DID proof odasını aç ↗")}</a>}</div></article>
        </section>
      </>}
    </main>
  );
}
