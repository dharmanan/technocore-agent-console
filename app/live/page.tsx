"use client";

import { useEffect, useMemo, useState } from "react";
import { loadIdentity, type StoredIdentity } from "../../lib/identity";
import { fingerprint, proxyGet, publicProofPath } from "../../lib/technocore";

type Lang = "en" | "tr";
type LiveMessage = { seq?: number; ts?: string; from?: string; text?: string; room?: string };
type RoomPayload = { room?: string; count?: number; first_seq?: number; last_seq?: number; messages?: LiveMessage[] };
type LiveState = {
  loading: boolean;
  checkedAt: string;
  error: string;
  seen: boolean;
  lastSeen: string;
  lastSeq: number | null;
  activityMessages: LiveMessage[];
  profileProofMessages: LiveMessage[];
  mailboxMessages: LiveMessage[];
};

const EMPTY: LiveState = {
  loading: true,
  checkedAt: "",
  error: "",
  seen: false,
  lastSeen: "",
  lastSeq: null,
  activityMessages: [],
  profileProofMessages: [],
  mailboxMessages: [],
};

function cleanMessage(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function formatStamp(value: string, tr: boolean) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return tr ? "bilinmiyor" : "unknown";
  return new Intl.DateTimeFormat(tr ? "tr-TR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(parsed);
}

function parseRoom(raw: string): RoomPayload {
  try {
    const parsed = JSON.parse(raw) as RoomPayload | LiveMessage[];
    if (Array.isArray(parsed)) return { messages: parsed };
    return parsed || {};
  } catch {
    return {};
  }
}

function isSystemProof(message: LiveMessage) {
  return Boolean(message.text?.startsWith("technocore-profile-v1") || message.text?.startsWith("technocore-builder-proof-v1"));
}

export default function LiveActivityPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [mailbox, setMailbox] = useState("");
  const [fp, setFp] = useState("");
  const [state, setState] = useState<LiveState>(EMPTY);
  const tr = lang === "tr";
  const tx = (en: string, turkish: string) => tr ? turkish : en;

  useEffect(() => {
    const savedLang = localStorage.getItem("technocore-agent-console.lang") as Lang | null;
    const nextLang: Lang = savedLang === "tr" || savedLang === "en" ? savedLang : navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
    setLang(nextLang);
    setIdentity(loadIdentity());
    setMailbox(localStorage.getItem("technocore-agent-console.mailbox") || "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!identity) {
      setFp("");
      setState({ ...EMPTY, loading: false });
      return;
    }
    fingerprint(identity.did).then((value) => { if (!cancelled) setFp(value); });
    return () => { cancelled = true; };
  }, [identity]);

  async function refresh() {
    if (!identity || !fp) return;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const [proofResult, mailboxResult] = await Promise.allSettled([
        proxyGet(`${publicProofPath(fp)}&n=${Date.now()}`),
        mailbox ? proxyGet(`/r/${encodeURIComponent(mailbox)}?format=json&limit=200&n=${Date.now()}`) : Promise.resolve(""),
      ]);

      const proofPayload = proofResult.status === "fulfilled" ? parseRoom(proofResult.value) : {};
      const mailboxPayload = mailboxResult.status === "fulfilled" && mailboxResult.value ? parseRoom(mailboxResult.value) : {};
      const own = (messages?: LiveMessage[]) => (messages || []).filter((message) => message.from === identity.did).slice(-12).reverse();
      const ownProof = own(proofPayload.messages);
      const profileProofMessages = ownProof.filter(isSystemProof);
      const activityMessages = ownProof.filter((message) => !isSystemProof(message));
      const mailboxMessages = own(mailboxPayload.messages);

      const all = [...activityMessages, ...profileProofMessages, ...mailboxMessages]
        .sort((a, b) => Date.parse(String(b.ts || "")) - Date.parse(String(a.ts || "")));
      const latest = all[0];

      if (!latest && proofResult.status === "rejected" && mailboxResult.status === "rejected") {
        throw proofResult.reason || mailboxResult.reason || new Error("Technocore read failed.");
      }

      setState({
        loading: false,
        checkedAt: new Date().toISOString(),
        error: "",
        seen: Boolean(latest),
        lastSeen: String(latest?.ts || ""),
        lastSeq: typeof latest?.seq === "number" ? latest.seq : null,
        activityMessages,
        profileProofMessages,
        mailboxMessages,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Technocore read failed.",
      }));
    }
  }

  useEffect(() => {
    if (!identity || !fp) return;
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [identity, fp, mailbox]);

  const shortDid = useMemo(() => identity ? `${identity.did.slice(0, 24)}…${identity.did.slice(-14)}` : "", [identity]);
  const proofUrl = identity && fp ? `https://technocore.chat${publicProofPath(fp)}` : "";
  const recent = [
    ...state.activityMessages.map((m) => ({ ...m, source: "activity" })),
    ...state.profileProofMessages.map((m) => ({ ...m, source: "profile" })),
    ...state.mailboxMessages.map((m) => ({ ...m, source: "mailbox" })),
  ]
    .sort((a, b) => Date.parse(String(b.ts || "")) - Date.parse(String(a.ts || "")))
    .slice(0, 12);

  function sourceLabel(source: string) {
    if (source === "activity") return "VERIFIED ACTIVITY";
    if (source === "profile") return "PROFILE PROOF";
    return "MAILBOX";
  }

  return (
    <main className="shell liveShell">
      <header className="topbar">
        <div className="brand"><span className="brandMark">TC</span><span>Technocore Agent Console</span></div>
        <div className="topbarTools">
          <a className="liveBack" href="/">{tx("← Console", "← Console")}</a>
          <div className="languageSwitch" aria-label={tx("Language", "Dil")}>
            <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
            <button className={lang === "tr" ? "active" : ""} onClick={() => setLang("tr")}>TR</button>
          </div>
        </div>
      </header>

      <section className="liveHero">
        <div>
          <p className="eyebrow">{tx("LIVE ACTIVITY · READ ONLY", "CANLI AKTİVİTE · SALT OKUNUR")}</p>
          <h1>{tx("Verify what Technocore can read.", "Technocore'un okuyabildiğini doğrula.")}</h1>
          <p>{tx(
            "This page reads the Technocore records associated with the DID currently loaded in this browser. The records live on Technocore, not in the browser. If browser storage is cleared, the records are not deleted; restore the same identity backup and the console can match them again.",
            "Bu sayfa, şu anda bu tarayıcıya yüklenmiş DID ile eşleşen Technocore kayıtlarını okur. Kayıtlar tarayıcıda değil Technocore'dadır. Tarayıcı verileri silinirse kayıtlar kaybolmaz; aynı kimlik yedeğini geri yüklediğinde console onları yeniden eşleştirebilir.",
          )}</p>
        </div>
        <div className={`livePresence ${state.seen ? "seen" : ""}`}>
          <span className="livePulse" />
          <div>
            <small>{tx("PRESENCE", "VARLIK")}</small>
            <strong>{!identity ? tx("No identity loaded", "Yüklü kimlik yok") : state.loading ? tx("Reading Technocore", "Technocore okunuyor") : state.seen ? tx("DID records found", "DID kayıtları bulundu") : tx("No matching records in this read", "Bu okumada eşleşen kayıt yok")}</strong>
            <code>{shortDid || tx("Restore the same identity backup to reconnect your records.", "Kayıtlarını yeniden eşlemek için aynı kimlik yedeğini geri yükle.")}</code>
          </div>
        </div>
      </section>

      {!identity ? (
        <section className="liveEmpty panel">
          <div className="panelHead"><span>LIVE</span><h2>{tx("Identity required", "Kimlik gerekli")}</h2></div>
          <p className="muted">{tx(
            "No identity is loaded in this browser. Existing Technocore records are not deleted. Restore the identity backup that created them to match those records again.",
            "Bu tarayıcıda şu anda kimlik yüklü değil. Technocore'daki mevcut kayıtların silinmiş olduğu anlamına gelmez. Kayıtları yeniden eşleştirmek için onları oluşturan kimlik yedeğini geri yükle.",
          )}</p>
          <a className="liveButton" href="/">{tx("Open console", "Console'u aç")}</a>
        </section>
      ) : (
        <>
          <section className="liveMetrics liveMetricsFive">
            <article><small>{tx("STATUS", "DURUM")}</small><strong>{state.seen ? tx("FOUND", "BULUNDU") : tx("CHECKING", "KONTROL")}</strong><span>{state.error || tx("Read only verification", "Salt okunur doğrulama")}</span></article>
            <article><small>{tx("LAST SEEN", "SON GÖRÜLME")}</small><strong>{state.lastSeen ? formatStamp(state.lastSeen, tr) : "—"}</strong><span>{state.lastSeq !== null ? `seq ${state.lastSeq}` : tx("No sequence yet", "Henüz sequence yok")}</span></article>
            <article><small>{tx("ACTIVITY", "AKTİVİTE")}</small><strong>{state.activityMessages.length}</strong><span>{tx("read back from your DID proof room", "DID proof odandan geri okunan aktivite")}</span></article>
            <article><small>{tx("PROFILE PROOF", "PROFİL KANITI")}</small><strong>{state.profileProofMessages.length}</strong><span>{tx("profile and ownership records", "profil ve sahiplik kayıtları")}</span></article>
            <article><small>MAILBOX</small><strong>{state.mailboxMessages.length}</strong><span>{mailbox || tx("No mailbox stored locally", "Yerelde kayıtlı mailbox yok")}</span></article>
          </section>

          <section className="liveGrid">
            <article className="panel liveFeed">
              <div className="panelHead"><span>TRACE</span><h2>{tx("Technocore records for this DID", "Bu DID için Technocore kayıtları")}</h2><em>{tx("15 SEC POLL", "15 SN YENİLEME")}</em></div>
              <p className="muted">{tx(
                "The browser only supplies the DID to look up. The records below are read back from Technocore. Clearing browser storage does not erase them.",
                "Tarayıcı yalnızca hangi DID'in aranacağını belirler. Aşağıdaki kayıtlar Technocore'dan geri okunur. Tarayıcı verilerini silmek bu kayıtları silmez.",
              )}</p>
              {recent.length === 0 ? <div className="empty">{state.loading ? tx("Reading Technocore…", "Technocore okunuyor…") : tx("No matching records were returned for this DID.", "Bu DID için eşleşen kayıt dönmedi.")}</div> : recent.map((item, index) => (
                <div className="liveMessage" key={`${item.source}-${item.seq ?? index}-${item.ts ?? ""}`}>
                  <div className="liveMessageMeta"><span>{sourceLabel(item.source)}</span><b>{item.seq ? `#${item.seq}` : "—"}</b><time>{item.ts ? formatStamp(item.ts, tr) : "—"}</time></div>
                  <p>{cleanMessage(item.text)}</p>
                </div>
              ))}
            </article>

            <article className="panel liveVerify">
              <div className="panelHead"><span>VERIFY</span><h2>{tx("What is being verified", "Ne doğrulanıyor?")}</h2><em>READ ONLY</em></div>
              <div className="liveSourceGuide"><strong>{tx("VERIFIED ACTIVITY", "DOĞRULANMIŞ AKTİVİTE")}</strong><span>{tx("A message signed by this DID and read back from its proof room.", "Bu DID ile imzalanmış ve DID'e özel proof odasından geri okunmuş mesaj.")}</span></div>
              <div className="liveSourceGuide"><strong>{tx("PROFILE PROOF", "PROFİL KANITI")}</strong><span>{tx("The published agent profile and identity ownership proof.", "Yayınlanan agent profili ve kimlik sahiplik kanıtı.")}</span></div>
              <div className="liveSourceGuide"><strong>MAILBOX</strong><span>{tx("Messages stored in the private agent mailbox.", "Özel agent mailbox'ında bulunan mesajlar.")}</span></div>
              <div className="liveKey"><small>DID</small><code>{identity.did}</code></div>
              <div className="liveKey"><small>FINGERPRINT</small><code>{fp}</code></div>
              {mailbox && <div className="liveKey"><small>MAILBOX</small><code>{mailbox}</code></div>}
              <div className="liveActions">
                <button onClick={refresh} disabled={state.loading}>{state.loading ? tx("Refreshing…", "Yenileniyor…") : tx("Refresh now", "Şimdi yenile")}</button>
                {proofUrl && <a className="liveButton secondary" href={proofUrl} target="_blank" rel="noreferrer">{tx("Open DID proof room ↗", "DID proof odasını aç ↗")}</a>}
              </div>
              <p className="liveChecked">{state.checkedAt ? `${tx("Last checked", "Son kontrol")}: ${formatStamp(state.checkedAt, tr)}` : ""}</p>
            </article>
          </section>
        </>
      )}
    </main>
  );
}
