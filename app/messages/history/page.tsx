"use client";

import { useEffect, useState } from "react";
import { loadIdentity } from "../../../lib/identity";
import { readMailbox, type TechnocoreMessage } from "../../../lib/technocore";
import { resolveAgentProfileHistory, type AgentProfileVersion } from "../../../lib/agent-profile";

type MailboxHistory = {
  profile: AgentProfileVersion;
  messages: TechnocoreMessage[];
  readable: boolean;
};

type HistoryCache = {
  checkedAt: string;
  items: MailboxHistory[];
};

function cacheKey(did: string) {
  return `technocore-agent-console.mailboxHistory.${did}`;
}

function readCache(did: string): HistoryCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(did));
    return raw ? JSON.parse(raw) as HistoryCache : null;
  } catch {
    return null;
  }
}

function writeCache(did: string, items: MailboxHistory[]) {
  localStorage.setItem(cacheKey(did), JSON.stringify({ checkedAt: new Date().toISOString(), items } satisfies HistoryCache));
}

export default function MailboxHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MailboxHistory[]>([]);
  const [notice, setNotice] = useState("");
  const [fatalError, setFatalError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const identity = loadIdentity();
      if (!identity) {
        setFatalError("Önce agent kimliğini console'a yükle.");
        setLoading(false);
        return;
      }

      const cached = readCache(identity.did);
      if (cached?.items?.length) {
        setItems(cached.items);
        setNotice("Son doğrulanmış mailbox geçmişi gösteriliyor. Technocore canlı olarak yeniden kontrol ediliyor.");
      }

      try {
        const profiles = await resolveAgentProfileHistory(identity.did);
        if (!profiles.length) {
          if (!cached?.items?.length) setFatalError("Bu DID için doğrulanmış profil geçmişi bulunamadı.");
          return;
        }

        const settled = await Promise.allSettled(profiles.map((profile) => readMailbox(profile.mailbox)));
        const next = profiles.map((profile, index) => {
          const result = settled[index];
          if (result.status === "fulfilled") {
            return { profile, messages: result.value.filter((message) => message.from === identity.did), readable: true } satisfies MailboxHistory;
          }

          const fallback = cached?.items?.find((item) => item.profile.mailbox === profile.mailbox);
          return {
            profile,
            messages: fallback?.messages || [],
            readable: false,
          } satisfies MailboxHistory;
        });

        if (cancelled) return;
        setItems(next);
        writeCache(identity.did, next);

        const failed = next.filter((item) => !item.readable).length;
        setNotice(failed
          ? `${failed} eski mailbox şu anda cevap vermedi. Bu kutular için son doğrulanmış kayıtlar korunuyor.`
          : "Profil ve mailbox geçmişi Technocore'dan yenilendi.");
        setFatalError("");
      } catch {
        if (!cancelled && !cached?.items?.length) {
          setFatalError("Technocore profil geçmişi şu anda okunamadı. Daha önce doğrulanmış yerel bir geçmiş de bulunamadı.");
        }
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
        <h1>Mesaj kutusu geçmişin.</h1>
        <p>Aynı DID ile yayınlanmış profil sürümleri burada gösterilir. En yeni doğrulanmış profil aktif profildir. Yeni mesajlar yalnız aktif profilin mailbox'ına gider. Eski mailbox'lar yalnız geçmişi okumak içindir.</p>
      </section>

      {notice && !fatalError && <div className="actionNotice info"><strong>DURUM</strong><span>{notice}</span></div>}

      {loading && items.length === 0 ? <section className="panel liveEmpty">Technocore profil geçmişi okunuyor…</section> : fatalError ? <section className="panel liveEmpty">{fatalError}</section> : (
        <section className="historyList">
          {items.map((item, index) => {
            const current = index === 0;
            return (
              <article className="panel" key={`${item.profile.mailbox}-${item.profile.seq ?? index}`}>
                <div className="panelHead">
                  <span>{current ? "AKTİF PROFİL" : "ESKİ PROFİL"}</span>
                  <h2>{item.profile.agent}</h2>
                  <em>{item.messages.length} MESAJ</em>
                </div>
                <p className="muted">{current
                  ? "Bu profil şu anda aktif. Yeni agent mesajları bu mailbox'a yönlendirilir."
                  : "Bu eski bir profil sürümüdür. Yeni mesaj almaz; yalnız mevcut geçmişi okumak için gösterilir."}</p>
                {!item.readable && <div className="actionNotice pending"><strong>CANLI OKUMA GECİKTİ</strong><span>Bu mailbox şu anda cevap vermedi. Son doğrulanmış kayıtlar gösteriliyor.</span></div>}
                <div className="liveKey"><small>MAILBOX</small><code>{item.profile.mailbox}</code></div>
                <div className="liveKey"><small>PROFILE SEQ</small><code>{item.profile.seq ?? "—"}</code></div>
                <div className="inboxList">
                  {item.messages.length === 0 ? <div className="empty">Bu mailbox için doğrulanmış mesaj görünmüyor.</div> : [...item.messages].reverse().slice(0, 40).map((message, messageIndex) => (
                    <div className="inboxMessage" key={`${message.seq ?? messageIndex}-${message.ts ?? ""}`}>
                      <div><strong>{message.from || "unknown"}</strong><time>{message.ts || "—"}</time></div>
                      <p>{message.text || ""}</p><small>seq {message.seq ?? "—"}</small>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
