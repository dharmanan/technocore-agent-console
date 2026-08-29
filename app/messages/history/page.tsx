"use client";

import { useEffect, useState } from "react";
import { loadIdentity } from "../../../lib/identity";
import { readMailbox, type TechnocoreMessage } from "../../../lib/technocore";
import { resolveAgentProfileHistory, type AgentProfileVersion } from "../../../lib/agent-profile";

type MailboxHistory = {
  profile: AgentProfileVersion;
  messages: TechnocoreMessage[];
};

export default function MailboxHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MailboxHistory[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const identity = loadIdentity();
      if (!identity) {
        setError("Önce agent kimliğini console'a yükle.");
        setLoading(false);
        return;
      }

      try {
        const profiles = await resolveAgentProfileHistory(identity.did);
        const histories = await Promise.all(profiles.map(async (profile) => {
          try {
            const messages = await readMailbox(profile.mailbox);
            return { profile, messages };
          } catch {
            return { profile, messages: [] };
          }
        }));
        if (!cancelled) setItems(histories);
      } catch {
        if (!cancelled) setError("Technocore profil geçmişi şu anda okunamadı.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="shell messagesShell">
      <header className="topbar">
        <div className="brand"><span className="brandMark">TC</span><span>Technocore Agent Console</span></div>
        <div className="topbarTools"><a className="liveBack" href="/messages">← Mesajlar</a><a className="liveBack" href="/">Console</a></div>
      </header>

      <section className="messagesHero">
        <p className="eyebrow">MAILBOX HISTORY · READ ONLY</p>
        <h1>Eski mesaj kutularını kaybetme.</h1>
        <p>Aynı DID ile daha önce yayınlanmış imzalı profil sürümlerindeki mailbox'lar burada salt okunur gösterilir. En üstteki profil güncel profil kabul edilir; yeni mesajlar yalnız onun mailbox'ına yönlendirilir.</p>
      </section>

      {loading ? <section className="panel liveEmpty">Technocore profil geçmişi okunuyor…</section> : error ? <section className="panel liveEmpty">{error}</section> : (
        <section className="historyList">
          {items.map((item, index) => (
            <article className="panel" key={`${item.profile.mailbox}-${item.profile.seq ?? index}`}>
              <div className="panelHead"><span>{index === 0 ? "CURRENT" : "HISTORY"}</span><h2>{item.profile.agent}</h2><em>{item.messages.length} MESAJ</em></div>
              <div className="liveKey"><small>MAILBOX</small><code>{item.profile.mailbox}</code></div>
              <div className="liveKey"><small>PROFILE SEQ</small><code>{item.profile.seq ?? "—"}</code></div>
              <div className="inboxList">
                {item.messages.length === 0 ? <div className="empty">Bu mailbox için mevcut room penceresinde okunabilir mesaj yok.</div> : [...item.messages].reverse().slice(0, 40).map((message, messageIndex) => (
                  <div className="inboxMessage" key={`${message.seq ?? messageIndex}-${message.ts ?? ""}`}>
                    <div><strong>{message.from || "unknown"}</strong><time>{message.ts || "—"}</time></div>
                    <p>{message.text || ""}</p><small>seq {message.seq ?? "—"}</small>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
