"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadIdentity, type StoredIdentity } from "../../lib/identity";
import { fingerprint, proxyGet, publicProofPath } from "../../lib/technocore";

type Lang = "en" | "tr";
type LiveMessage = { seq?: number; ts?: string; from?: string; text?: string };
type RoomPayload = { messages?: LiveMessage[] } | LiveMessage[];
type SourceMessage = LiveMessage & { source: "activity" | "profile" | "mailbox" };
type Snapshot = {
  checkedAt: string;
  lastSeen: string;
  lastSeq: number | null;
  activity: LiveMessage[];
  profile: LiveMessage[];
  mailbox: LiveMessage[];
};

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

export default function LiveActivityPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [mailbox, setMailbox] = useState("");
  const [fp, setFp] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<"checking" | "ok" | "stale">("checking");
  const [connectionMessage, setConnectionMessage] = useState("");
  const retryMs = useRef(15000);
  const timerRef = useRef<number | null>(null);
  const tr = lang === "tr";
  const tx = (en: string, turkish: string) => tr ? turkish : en;

  useEffect(() => {
    const saved = localStorage.getItem("technocore-agent-console.lang") as Lang | null;
    const next: Lang = saved === "tr" || saved === "en" ? saved : navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
    setLang(next);
    setIdentity(loadIdentity());
    setMailbox(localStorage.getItem("technocore-agent-console.mailbox") || "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!identity) { setFp(""); setLoading(false); return; }
    fingerprint(identity.did).then((value) => { if (!cancelled) setFp(value); });
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
    try {
      const proofPromise = proxyGet(`${publicProofPath(fp)}&n=${Date.now()}`);
      const mailboxPromise = mailbox ? proxyGet(`/r/${encodeURIComponent(mailbox)}?format=json&limit=200&n=${Date.now()}`) : Promise.resolve("");
      const [proofRaw, mailboxRaw] = await Promise.all([proofPromise, mailboxPromise]);
      const own = (messages: LiveMessage[]) => messages.filter((m) => m.from === identity.did);
      const proofMessages = own(parseRoom(proofRaw));
      const activity = proofMessages.filter((m) => !isSystemProof(m));
      const profile = proofMessages.filter(isSystemProof);
      const mailboxMessages = own(parseRoom(mailboxRaw));
      const all = [...activity, ...profile, ...mailboxMessages].sort((a, b) => Date.parse(String(b.ts || "")) - Date.parse(String(a.ts || "")));
      const latest = all[0];
      setSnapshot({
        checkedAt: new Date().toISOString(),
        lastSeen: String(latest?.ts || ""),
        lastSeq: typeof latest?.seq === "number" ? latest.seq : null,
        activity,
        profile,
        mailbox: mailboxMessages,
      });
      setConnection("ok");
      setConnectionMessage("");
      retryMs.current = 15000;
    } catch (error) {
      setConnection("stale");
      setConnectionMessage(tx(
        "Technocore could not be refreshed right now. The last successfully verified data remains on screen.",
        "Technocore şu anda yenilenemedi. Son başarıyla doğrulanan veriler ekranda tutuluyor.",
      ));
      retryMs.current = Math.min(retryMs.current === 15000 ? 30000 : retryMs.current * 2, 60000);
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
  const recent: SourceMessage[] = snapshot ? [
    ...snapshot.activity.map((m) => ({ ...m, source: "activity" as const })),
    ...snapshot.profile.map((m) => ({ ...m, source: "profile" as const })),
    ...snapshot.mailbox.map((m) => ({ ...m, source: "mailbox" as const })),
  ].sort((a, b) => Date.parse(String(b.ts || "")) - Date.parse(String(a.ts || ""))).slice(0, 16) : [];

  function sourceLabel(source: SourceMessage["source"]) {
    if (source === "activity") return tx("VERIFIED ACTIVITY", "DOĞRULANMIŞ AKTİVİTE");
    if (source === "profile") return tx("PROFILE PROOF", "PROFİL KANITI");
    return "MAILBOX";
  }

  const identityFound = Boolean(snapshot && (snapshot.activity.length || snapshot.profile.length || snapshot.mailbox.length));
  const hasVerifiedActivity = Boolean(snapshot?.activity.length);

  return (
    <main className="shell liveShell">
      <header className="topbar">
        <div className="brand"><span className="brandMark">TC</span><span>Technocore Agent Console</span></div>
        <div className="topbarTools"><a className="liveBack" href="/">← Console</a><a className="liveBack" href="/messages">{tx("Messages", "Mesajlar")}</a><div className="languageSwitch"><button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button><button className={lang === "tr" ? "active" : ""} onClick={() => setLang("tr")}>TR</button></div></div>
      </header>

      <section className="liveHero">
        <div><p className="eyebrow">{tx("LIVE ACTIVITY · READ ONLY", "CANLI AKTİVİTE · SALT OKUNUR")}</p><h1>{tx("Verify what Technocore can read.", "Technocore'un okuyabildiğini doğrula.")}</h1><p>{tx(
          "This page matches the DID loaded in this browser with records currently readable from Technocore. Clearing browser storage does not itself delete Technocore records, but room records are not a guaranteed permanent archive. Restoring the same identity lets the console look for the same DID again.",
          "Bu sayfa tarayıcıya yüklenmiş DID'i, Technocore'dan şu anda okunabilen kayıtlarla eşleştirir. Tarayıcı verilerini silmek Technocore kayıtlarını doğrudan silmez; ancak room kayıtları kalıcı arşiv garantisi taşımaz. Aynı kimliği geri yüklediğinde console aynı DID'i yeniden arayabilir.",
        )}</p></div>
        <div className={`livePresence ${identityFound ? "seen" : ""}`}><span className="livePulse"/><div><small>{tx("IDENTITY", "KİMLİK")}</small><strong>{!identity ? tx("No identity loaded", "Yüklü kimlik yok") : loading && !snapshot ? tx("Reading Technocore", "Technocore okunuyor") : identityFound ? tx("DID records found", "DID kayıtları bulundu") : tx("No matching records returned", "Eşleşen kayıt dönmedi")}</strong><code>{shortDid}</code></div></div>
      </section>

      {connection === "stale" && <div className="actionNotice error liveStaleNotice"><strong>{tx("LIVE REFRESH DELAYED", "CANLI YENİLEME GECİKTİ")}</strong><span>{connectionMessage}</span></div>}

      {!identity ? <section className="panel liveEmpty"><div className="panelHead"><span>LIVE</span><h2>{tx("Identity required", "Kimlik gerekli")}</h2></div><p className="muted">{tx("Create or restore your identity in the console first.", "Önce console'da kimliğini oluştur veya geri yükle.")}</p><a className="liveButton" href="/">{tx("Open console", "Console'u aç")}</a></section> : <>
        <section className="liveMetrics liveMetricsFive">
          <article><small>{tx("IDENTITY", "KİMLİK")}</small><strong>{identityFound ? tx("FOUND", "BULUNDU") : snapshot ? tx("NOT FOUND", "BULUNAMADI") : "—"}</strong><span>{tx("records matching this DID", "bu DID ile eşleşen kayıtlar")}</span></article>
          <article><small>{tx("VERIFIED ACTIVITY", "DOĞRULANMIŞ AKTİVİTE")}</small><strong>{snapshot ? (hasVerifiedActivity ? tx("YES", "VAR") : tx("NO", "YOK")) : "—"}</strong><span>{snapshot ? `${snapshot.activity.length} ${tx("read back", "geri okundu")}` : tx("waiting for first read", "ilk okuma bekleniyor")}</span></article>
          <article><small>{tx("LAST VERIFIED", "SON DOĞRULAMA")}</small><strong>{snapshot?.lastSeen ? formatStamp(snapshot.lastSeen, tr) : "—"}</strong><span>{snapshot?.lastSeq !== null && snapshot ? `seq ${snapshot.lastSeq}` : tx("no sequence yet", "henüz sequence yok")}</span></article>
          <article><small>{tx("PROFILE PROOF", "PROFİL KANITI")}</small><strong>{snapshot ? snapshot.profile.length : "—"}</strong><span>{tx("profile ownership records", "profil sahiplik kayıtları")}</span></article>
          <article><small>MAILBOX</small><strong>{snapshot ? snapshot.mailbox.length : "—"}</strong><span>{mailbox || tx("no local mailbox reference", "yerel mailbox referansı yok")}</span></article>
        </section>

        <section className="liveGrid">
          <article className="panel liveFeed"><div className="panelHead"><span>TRACE</span><h2>{tx("Technocore records for this DID", "Bu DID için Technocore kayıtları")}</h2><em>{connection === "ok" ? tx("LIVE", "CANLI") : tx("LAST VERIFIED", "SON DOĞRULANAN")}</em></div><p className="muted">{tx("Only records successfully read back from Technocore are shown here.", "Burada yalnız Technocore'dan başarıyla geri okunmuş kayıtlar gösterilir.")}</p>{recent.length === 0 ? <div className="empty">{loading ? tx("Reading Technocore…", "Technocore okunuyor…") : tx("No matching records in the last successful read.", "Son başarılı okumada eşleşen kayıt yok.")}</div> : recent.map((item,index)=><div className="liveMessage" key={`${item.source}-${item.seq ?? index}-${item.ts ?? ""}`}><div className="liveMessageMeta"><span>{sourceLabel(item.source)}</span><b>{item.seq ? `#${item.seq}` : "—"}</b><time>{item.ts ? formatStamp(item.ts,tr) : "—"}</time></div><p>{cleanMessage(item.text)}</p></div>)}</article>
          <article className="panel liveVerify"><div className="panelHead"><span>VERIFY</span><h2>{tx("What is being verified", "Ne doğrulanıyor?")}</h2><em>READ ONLY</em></div><div className="liveSourceGuide"><strong>{tx("IDENTITY FOUND", "KİMLİK BULUNDU")}</strong><span>{tx("Technocore returned records matching this DID.", "Technocore bu DID ile eşleşen kayıtlar döndürdü.")}</span></div><div className="liveSourceGuide"><strong>{tx("VERIFIED ACTIVITY", "DOĞRULANMIŞ AKTİVİTE")}</strong><span>{tx("A message signed by this DID and read back from its proof room.", "Bu DID ile imzalanmış ve proof odasından geri okunmuş mesaj.")}</span></div><div className="liveSourceGuide"><strong>{tx("CONNECTION", "BAĞLANTI")}</strong><span>{connection === "ok" ? tx("The latest refresh succeeded.", "Son yenileme başarılı.") : connection === "checking" ? tx("Checking Technocore now.", "Technocore şu anda kontrol ediliyor.") : tx("The latest refresh failed; verified data above is preserved.", "Son yenileme başarısız; yukarıdaki doğrulanmış veriler korunuyor.")}</span></div><div className="liveKey"><small>DID</small><code>{identity.did}</code></div><div className="liveKey"><small>FINGERPRINT</small><code>{fp}</code></div>{mailbox && <div className="liveKey"><small>MAILBOX</small><code>{mailbox}</code></div>}<div className="liveActions"><button onClick={refresh} disabled={loading}>{loading ? tx("Refreshing…", "Yenileniyor…") : tx("Refresh now", "Şimdi yenile")}</button>{proofUrl && <a className="liveButton secondary" href={proofUrl} target="_blank" rel="noreferrer">{tx("Open DID proof room ↗", "DID proof odasını aç ↗")}</a>}</div><p className="liveChecked">{snapshot?.checkedAt ? `${tx("Last successful read", "Son başarılı okuma")}: ${formatStamp(snapshot.checkedAt,tr)}` : ""}</p></article>
        </section>
      </>}
    </main>
  );
}
