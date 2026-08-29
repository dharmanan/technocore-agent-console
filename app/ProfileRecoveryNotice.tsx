"use client";

import { useEffect, useState } from "react";
import { loadIdentity, withIdentityProfile } from "../lib/identity";
import { resolveAgentProfileHistory, type AgentProfileVersion } from "../lib/agent-profile";

export default function ProfileRecoveryNotice() {
  const [profiles, setProfiles] = useState<AgentProfileVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const identity = loadIdentity();
    if (!identity || identity.profile) return;

    let cancelled = false;
    setLoading(true);
    setVisible(true);

    resolveAgentProfileHistory(identity.did)
      .then((items) => {
        if (cancelled) return;
        setProfiles(items);
      })
      .catch(() => {
        if (!cancelled) setError("Technocore profil geçmişi şu anda okunamadı. Daha sonra tekrar deneyebilirsin.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  function chooseProfile(profile: AgentProfileVersion) {
    const identity = loadIdentity();
    if (!identity) return;
    withIdentityProfile(identity, profile.agent, profile.mailbox);
    localStorage.setItem("technocore-agent-console.agentName", profile.agent);
    localStorage.setItem("technocore-agent-console.mailbox", profile.mailbox);
    window.location.reload();
  }

  if (!visible) return null;

  return (
    <div className="profileRecoveryBackdrop" role="dialog" aria-modal="true" aria-label="Legacy identity backup profile recovery">
      <section className="profileRecoveryCard">
        <div className="panelHead"><span>RECOVER</span><h2>Bu eski yedek profil adı taşımıyor</h2><em>LEGACY BACKUP</em></div>
        <p className="muted">
          Yüklediğin JSON kriptografik DID anahtarlarını içeriyor, fakat agent adı ve mailbox bilgisi içermiyor. Bu yüzden console senin adına sessizce profil seçmeyecek.
        </p>
        <p className="muted">
          Aşağıda bu DID ile Technocore'a daha önce imzalanmış profil sürümleri var. Geri yüklemek istediğin profili seç. Seçimin bu tarayıcıya kaydedilecek ve yeni yedek dosyalarına da eklenecek.
        </p>

        {loading && <div className="empty">Technocore profil geçmişi okunuyor…</div>}
        {error && <div className="actionNotice error"><strong>OKUNAMADI</strong><span>{error}</span></div>}

        {!loading && !error && profiles.length === 0 && (
          <div className="actionNotice info"><strong>PROFİL BULUNAMADI</strong><span>Bu DID için imzalı profil kaydı bulunamadı. Console'da yeni profil oluşturabilirsin.</span></div>
        )}

        {!loading && profiles.length > 0 && (
          <div className="profileRecoveryList">
            {profiles.map((profile, index) => (
              <button className="profileRecoveryOption" key={`${profile.mailbox}-${profile.seq ?? index}`} onClick={() => chooseProfile(profile)}>
                <span>{index === 0 ? "EN YENİ İMZALI PROFİL" : "ESKİ PROFİL SÜRÜMÜ"}</span>
                <strong>{profile.agent}</strong>
                <code>{profile.mailbox}</code>
                <small>profile seq {profile.seq ?? "—"}</small>
              </button>
            ))}
          </div>
        )}

        <div className="actions">
          <button onClick={() => setVisible(false)}>Şimdi seçme</button>
          <a className="liveButton secondary" href="/messages/history">Profil geçmişini ayrıntılı aç</a>
        </div>
      </section>
    </div>
  );
}
