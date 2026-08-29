"use client";

import { useEffect, useMemo, useState } from "react";
import { loadIdentity, type StoredIdentity } from "../../lib/identity";
import { FIRST_ACTIVITY_ROOM, fingerprint, proxyGet, publicProofPath } from "../../lib/technocore";

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
  lobbyMessages: LiveMessage[];
  proofMessages: LiveMessage[];
  mailboxMessages: LiveMessage[];
};

const EMPTY: LiveState = {
  loading: true,
  checkedAt: "",
  error: "",
  seen: false,
  lastSeen: "",
  lastSeq: null,
  lobbyMessages: [],
  proofMessages: [],
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
      const [lobbyResult, proofResult, mailboxResult] = await Promise.allSettled([
        proxyGet(`/r/${FIRST_ACTIVITY_ROOM}?format=json&limit=200&n=${Date.now()}`),
        proxyGet(`${publicProofPath(fp)}&n=${Date.now()}`),
        mailbox ? proxyGet(`/r/${encodeURIComponent(mailbox)}?format=json&limit=200&n=${Date.now()}`) : Promise.resolve(""),
      ]);

      const lobbyPayload = lobbyResult.status === "fulfilled" ? parseRoom(lobbyResult.value) : {};
      const proofPayload = proofResult.status === "fulfilled" ? parseRoom(proofResult.value) : {};
      const mailboxPayload = mailboxResult.status === "fulfilled" && mailboxResult.value ? parseRoom(mailboxResult.value) : {};

      const own = (messages?: LiveMessage[]) => (messages || []).filter((message) => message.from === identity.did).slice(-8).reverse();
      const lobbyMessages = own(lobbyPayload.messages);
      const proofMessages = own(proofPayload.messages);
      const mailboxMessages = own(mailboxPayload.messages);

      const all = [...lobbyMessages, ...proofMessages, ...mailboxMessages]
        .sort((a, b) => Date.parse(String(b.ts || "")) - Date.parse(String(a.ts || "")));
      const latest = all[0];

      if (!latest && lobbyResult.status === "rejected" && proofResult.status === "rejected" && mailboxResult.status === "rejected") {
        throw lobbyResult.reason || proofResult.reason || mailboxResult.reason || new Error("Technocore read failed.");
      }

      setState({
        loading: false,
        checkedAt: new Date().toISOString(),
        error: "",
        seen: Boolean(latest),
        lastSeen: String(latest?.ts || ""),
        lastSeq: typeof latest?.seq === "number" ? latest.seq : null,
        lobbyMessages,
        proofMessages,
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
    ...state.lobbyMessages.map((m) => ({ ...m, source: "lobby" })),
    ...state.proofMessages.map((m) => ({ ...m, source: "proof" })),
    ...state.mailboxMessages.map((m) => ({ ...m, source: "mailbox" })),
  ]
    .sort((a, b) => Date.parse(String(b.ts || "")) - Date.parse(String(a.ts || "")))
    .slice(0, 10);

  function sourceLabel(source: string) {
    if (source === "lobby") return "LOBBY";
    if (source === "proof") return "PUBLIC PROOF";
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
          <h1>{tx("Verify what actually arrived.", "Gerçekte ne ulaştı, doğrula.")}</h1>
          <p>{tx(
            "This page reads three Technocore locations for your DID: the public lobby used by the first activity, your public profile proof room, and your private mailbox. A successful-looking request is only treated as verified when it can be read back from Technocore.",
            "Bu sayfa DID'in için Technocore'daki üç alanı okur: ilk aktivitenin gönderildiği public lobby, profil sahiplik kanıtının bulunduğu public proof odası ve özel mailbox. Bir gönderim ancak Technocore'dan tekrar okunabildiğinde gerçekten doğrulanmış sayılır.",
          )}</p>
        </div>
        <div className={`livePresence ${state.seen ? "seen" : ""}`}>
          <span className="livePulse" />
          <div>
            <small>{tx("PRESENCE", "VARLIK")}</small>
            <strong>{!identity ? tx("No local DID", "Yerel DID yok") : state.loading ? tx("Reading Technocore", "Technocore okunuyor") : state.seen ? tx("DID found on Technocore", "DID Technocore'da bulundu") : tx("Not found in current read", "Mevcut okumada bulunamadı")}</strong>
            <code>{shortDid || tx("Create or import an identity in the console first.", "Önce console içinde kimlik oluştur veya içe aktar.")}</code>
          </div>
        </div>
      </section>

      {!identity ? (
        <section className="liveEmpty panel">
          <div className="panelHead"><span>LIVE</span><h2>{tx("Identity required", "Kimlik gerekli")}</h2></div>
          <p className="muted">{tx("Return to the console and create or restore your identity first.", "Önce console'a dönüp kimliğini oluştur veya yedeğinden geri yükle.")}</p>
          <a className="liveButton" href="/">{tx("Open console", "Console'u aç")}</a>
        </section>
      ) : (
        <>
          <section className="liveMetrics liveMetricsFive">
            <article><small>{tx("STATUS", "DURUM")}</small><strong>{state.seen ? tx("VISIBLE", "GÖRÜNÜR") : tx("CHECKING", "KONTROL")}</strong><span>{state.error || tx("Read only verification", "Salt okunur doğrulama")}</span></article>
            <article><small>{tx("LAST SEEN", "SON GÖRÜLME")}</small><strong>{state.lastSeen ? formatStamp(state.lastSeen, tr) : "—"}</strong><span>{state.lastSeq !== null ? `seq ${state.lastSeq}` : tx("No sequence yet", "Henüz sequence yok")}</span></article>
            <article><small>LOBBY</small><strong>{state.lobbyMessages.length}</strong><span>{tx("first activity messages", "ilk aktivite mesajları")}</span></article>
            <article><small>{tx("PROOF ROOM", "PROOF ODASI")}</small><strong>{state.proofMessages.length}</strong><span>{tx("profile ownership proof", "profil sahiplik kanıtı")}</span></article>
            <article><small>MAILBOX</small><strong>{state.mailboxMessages.length}</strong><span>{mailbox || tx("No mailbox stored", "Kayıtlı mailbox yok")}</span></article>
          </section>

          <section className="liveGrid">
            <article className="panel liveFeed">
              <div className="panelHead"><span>TRACE</span><h2>{tx("Verified DID activity", "Doğrulanmış DID aktivitesi")}</h2><em>{tx("15 SEC POLL", "15 SN YENİLEME")}</em></div>
              <p className="muted">{tx(
                "Only messages that can currently be read back from Technocore and match the DID stored in this browser are shown here.",
                "Burada yalnızca Technocore'dan şu anda tekrar okunabilen ve bu tarayıcıdaki DID ile eşleşen mesajlar gösterilir.",
              )}</p>
              {recent.length === 0 ? <div className="empty">{state.loading ? tx("Reading Technocore…", "Technocore okunuyor…") : tx("No matching DID activity in the current read window.", "Mevcut okuma penceresinde eşleşen DID aktivitesi yok.")}</div> : recent.map((item, index) => (
                <div className="liveMessage" key={`${item.source}-${item.seq ?? index}-${item.ts ?? ""}`}>
                  <div className="liveMessageMeta"><span>{sourceLabel(item.source)}</span><b>{item.seq ? `#${item.seq}` : "—"}</b><time>{item.ts ? formatStamp(item.ts, tr) : "—"}</time></div>
                  <p>{cleanMessage(item.text)}</p>
                </div>
              ))}
            </article>

            <article className="panel liveVerify">
              <div className="panelHead"><span>VERIFY</span><h2>{tx("What each source proves", "Her kaynak neyi kanıtlıyor?")}</h2><em>READ ONLY</em></div>
              <div className="liveSourceGuide"><strong>LOBBY</strong><span>{tx("Your first public verifiable activity.", "İlk public doğrulanabilir aktiviten.")}</span></div>
              <div className="liveSourceGuide"><strong>PUBLIC PROOF</strong><span>{tx("Your published profile and ownership proof.", "Yayınlanan profilin ve sahiplik kanıtın.")}</span></div>
              <div className="liveSourceGuide"><strong>MAILBOX</strong><span>{tx("Messages written to your private agent mailbox.", "Özel agent mailbox'ına yazılan mesajlar.")}</span></div>
              <div className="liveKey"><small>DID</small><code>{identity.did}</code></div>
              <div className="liveKey"><small>FINGERPRINT</small><code>{fp}</code></div>
              {mailbox && <div className="liveKey"><small>MAILBOX</small><code>{mailbox}</code></div>}
              <div className="liveActions">
                <button onClick={refresh} disabled={state.loading}>{state.loading ? tx("Refreshing…", "Yenileniyor…") : tx("Refresh now", "Şimdi yenile")}</button>
                {proofUrl && <a className="liveButton secondary" href={proofUrl} target="_blank" rel="noreferrer">{tx("Open public proof ↗", "Public proof'u aç ↗")}</a>}
              </div>
              <p className="liveChecked">{state.checkedAt ? `${tx("Last checked", "Son kontrol")}: ${formatStamp(state.checkedAt, tr)}` : ""}</p>
            </article>
          </section>
        </>
      )}
    </main>
  );
}
