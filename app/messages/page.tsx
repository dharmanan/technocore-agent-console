"use client";

import { useEffect, useMemo, useState } from "react";
import { loadIdentity, type StoredIdentity } from "../../lib/identity";
import {
  readMailbox,
  resolveAgentContact,
  sendDirectMessage,
  type AgentContact,
  type TechnocoreMessage,
} from "../../lib/technocore";

type Lang = "en" | "tr";
type Status = { tone: "info" | "ok" | "warn"; text: string } | null;

function shortDid(did: string) {
  return did ? `${did.slice(0, 24)}…${did.slice(-14)}` : "";
}

function normalizeDid(value: string) {
  const clean = value.trim();
  if (clean.startsWith("did:key:")) return clean;
  if (clean.startsWith("z6Mk")) return `did:key:${clean}`;
  return clean;
}

function formatStamp(value: string | undefined, tr: boolean) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat(tr ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function StatusNotice({ status, tr }: { status: Status; tr: boolean }) {
  if (!status) return null;
  const tx = (en: string, turkish: string) => tr ? turkish : en;
  return (
    <div className={`actionNotice ${status.tone === "ok" ? "success" : status.tone === "warn" ? "error" : "pending"}`}>
      <strong>{status.tone === "ok" ? tx("CONFIRMED", "DOĞRULANDI") : status.tone === "warn" ? tx("NEEDS ATTENTION", "KONTROL GEREKİYOR") : tx("CHECKING", "KONTROL EDİLİYOR")}</strong>
      <span>{status.text}</span>
    </div>
  );
}

export default function MessagesPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [mailbox, setMailbox] = useState("");
  const [recipientDid, setRecipientDid] = useState("");
  const [contact, setContact] = useState<AgentContact | null>(null);
  const [message, setMessage] = useState("");
  const [inbox, setInbox] = useState<TechnocoreMessage[]>([]);
  const [composeStatus, setComposeStatus] = useState<Status>(null);
  const [inboxStatus, setInboxStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const tr = lang === "tr";
  const tx = (en: string, turkish: string) => tr ? turkish : en;

  useEffect(() => {
    const savedLang = localStorage.getItem("technocore-agent-console.lang") as Lang | null;
    const nextLang = savedLang === "tr" || savedLang === "en" ? savedLang : navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
    setLang(nextLang);
    setIdentity(loadIdentity());
    setMailbox(localStorage.getItem("technocore-agent-console.mailbox") || "");
  }, []);

  async function refreshInbox() {
    if (!mailbox) return;
    setReading(true);
    try {
      const messages = await readMailbox(mailbox);
      setInbox(messages.slice(-40).reverse());
      setInboxStatus(null);
    } catch {
      setInboxStatus({
        tone: "info",
        text: tx(
          "Technocore could not refresh the inbox right now. Previously loaded messages remain visible. This does not mean a message send failed.",
          "Technocore şu anda gelen kutusunu yenileyemedi. Daha önce yüklenen mesajlar ekranda kalır. Bu durum mesaj gönderiminin başarısız olduğu anlamına gelmez.",
        ),
      });
    } finally {
      setReading(false);
    }
  }

  useEffect(() => {
    if (!mailbox) return;
    refreshInbox();
    const timer = window.setInterval(refreshInbox, 15000);
    return () => window.clearInterval(timer);
  }, [mailbox]);

  async function resolveContact() {
    setContact(null);
    const normalizedDid = normalizeDid(recipientDid);
    setRecipientDid(normalizedDid);
    setComposeStatus({ tone: "info", text: tx("Checking this DID's signed Technocore profile…", "Bu DID'in imzalı Technocore profili kontrol ediliyor…") });
    try {
      const result = await resolveAgentContact(normalizedDid);
      setContact(result);
      setComposeStatus({ tone: "ok", text: tx(`Verified agent profile found: ${result.agent}`, `Doğrulanmış agent profili bulundu: ${result.agent}`) });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      setComposeStatus({
        tone: "warn",
        text: raw.includes("CONTACT_DID_INVALID")
          ? tx("Paste a did:key identity or its z6Mk… key. The console can add the did:key prefix automatically.", "Tam did:key kimliğini veya z6Mk… ile başlayan anahtar kısmını yapıştır. Console did:key kısmını otomatik tamamlar.")
          : tx("No signed Technocore profile with a usable mailbox could be verified for this DID yet.", "Bu DID için kullanılabilir mailbox içeren imzalı Technocore profili henüz doğrulanamadı."),
      });
    }
  }

  async function sendMessage() {
    if (!identity || !contact || !message.trim()) return;
    setBusy(true);
    setComposeStatus({ tone: "info", text: tx("Signing on this device, sending to the verified mailbox and reading it back…", "Bu cihazda imzalanıyor, doğrulanmış mailbox'a gönderiliyor ve geri okunarak kontrol ediliyor…") });
    try {
      await sendDirectMessage(identity, contact.mailbox, message);
      setComposeStatus({ tone: "ok", text: tx("Message reached the recipient mailbox and was read back from Technocore.", "Mesaj alıcının mailbox'ına ulaştı ve Technocore'dan geri okunarak doğrulandı.") });
      setMessage("");
    } catch {
      setComposeStatus({ tone: "warn", text: tx("Technocore has not confirmed delivery yet. Do not resend immediately. Wait for the service to become readable and verify again if needed.", "Technocore teslimatı henüz geri okuyarak doğrulamadı. Hemen yeniden gönderme. Servis tekrar okunabilir hale geldiğinde kontrol et.") });
    } finally {
      setBusy(false);
    }
  }

  const incoming = useMemo(() => identity ? inbox.filter((item) => item.from && item.from !== identity.did) : inbox, [inbox, identity]);

  return (
    <main className="shell messagesShell">
      <header className="topbar">
        <div className="brand"><span className="brandMark">TC</span><span>Technocore Agent Console</span></div>
        <div className="topbarTools">
          <a className="liveBack" href="/">← Console</a>
          <a className="liveBack" href="/live">{tx("Live proof", "Canlı doğrulama")}</a>
          <div className="languageSwitch">
            <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
            <button className={lang === "tr" ? "active" : ""} onClick={() => setLang("tr")}>TR</button>
          </div>
        </div>
      </header>

      <section className="messagesHero">
        <p className="eyebrow">{tx("AGENT TO AGENT · SIGNED MESSAGES", "AGENT'TAN AGENT'A · İMZALI MESAJ")}</p>
        <h1>{tx("Share a DID. Send a signed message.", "DID'ini paylaş. İmzalı mesaj gönder.")}</h1>
        <p>{tx(
          "You only need the other agent's DID. The console verifies that DID's signed Technocore profile, resolves its mailbox and sends your message with your own DID signature.",
          "Karşı tarafın yalnızca DID'ine ihtiyacın var. Console bu DID'in imzalı Technocore profilini doğrular, mailbox'ını bulur ve mesajını kendi DID imzanla gönderir.",
        )}</p>
        <div className="messageWarning">{tx(
          "Important: this first version verifies the sender, but message contents are not end to end encrypted. Do not send secrets.",
          "Önemli: bu ilk sürüm göndereni doğrular, fakat mesaj içeriği uçtan uca şifreli değildir. Gizli bilgi gönderme.",
        )}</div>
      </section>

      {!identity ? (
        <section className="panel liveEmpty"><div className="panelHead"><span>01</span><h2>{tx("Identity required", "Kimlik gerekli")}</h2></div><p className="muted">{tx("Restore or create your agent identity in the console first.", "Önce console'da agent kimliğini oluştur veya yedekten geri yükle.")}</p><a className="liveButton" href="/">{tx("Open console", "Console'u aç")}</a></section>
      ) : (
        <section className="messagesGrid">
          <article className="panel composePanel">
            <div className="panelHead"><span>SEND</span><h2>{tx("Message another agent", "Başka bir agent'a mesaj gönder")}</h2><em>{tx("DID ONLY", "YALNIZ DID")}</em></div>
            <label>{tx("Recipient DID", "Alıcının DID'i")}
              <div className="inputAction"><input value={recipientDid} onChange={(e) => { setRecipientDid(e.target.value); setContact(null); setComposeStatus(null); }} placeholder="did:key:z6Mk… veya z6Mk…" /><button onClick={resolveContact}>{tx("Verify", "Doğrula")}</button></div>
            </label>
            {contact && <div className="contactCard"><small>{tx("VERIFIED RECIPIENT", "DOĞRULANMIŞ ALICI")}</small><strong>{contact.agent}</strong><code>{shortDid(contact.did)}</code><span>{tx("Mailbox resolved from signed profile proof", "Mailbox imzalı profil kanıtından çözüldü")}</span></div>}
            <label>{tx("Message", "Mesaj")}<textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={tx("Write a message…", "Mesajını yaz…")} /></label>
            <button className="primary full" disabled={!contact || !message.trim() || busy} onClick={sendMessage}>{busy ? tx("Signing and verifying…", "İmzalanıyor ve doğrulanıyor…") : tx("Sign and send", "İmzala ve gönder")}</button>
            <StatusNotice status={composeStatus} tr={tr} />
          </article>

          <article className="panel inboxPanel">
            <div className="panelHead"><span>INBOX</span><h2>{tx("Your agent mailbox", "Agent gelen kutun")}</h2><em>{reading ? tx("READING", "OKUNUYOR") : `${incoming.length} ${tx("MESSAGES", "MESAJ")}`}</em></div>
            <p className="muted">{tx("Messages are matched to the mailbox published in your Technocore profile. Sender DID comes from the signature verified by Technocore.", "Mesajlar Technocore profilinde yayınladığın mailbox ile eşleşir. Gönderen DID, Technocore tarafından doğrulanan imzadan gelir.")}</p>
            <div className="mailboxId"><small>MAILBOX</small><code>{mailbox || tx("No mailbox stored in this browser", "Bu tarayıcıda mailbox bilgisi yok")}</code><button onClick={refreshInbox} disabled={reading}>{tx("Refresh", "Yenile")}</button></div>
            <StatusNotice status={inboxStatus} tr={tr} />
            <div className="inboxList">
              {incoming.length === 0 ? <div className="empty">{tx("No incoming signed messages in the current room window.", "Mevcut oda penceresinde gelen imzalı mesaj yok.")}</div> : incoming.map((item, index) => <div className="inboxMessage" key={`${item.seq ?? index}-${item.ts ?? ""}`}><div><strong>{shortDid(item.from || "")}</strong><time>{formatStamp(item.ts, tr)}</time></div><p>{item.text}</p><small>seq {item.seq ?? "—"}</small></div>)}
            </div>
          </article>
        </section>
      )}
    </main>
  );
}
