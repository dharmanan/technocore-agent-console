"use client";

import { useEffect, useState } from "react";
import { identityChangeEventName, loadIdentity, withIdentityProfile } from "../lib/identity";
import { resolveAgentProfileHistory, type AgentProfileVersion } from "../lib/agent-profile";

export default function ProfileRecoveryNotice() {
  const [profiles, setProfiles] = useState<AgentProfileVersion[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const identity = loadIdentity();
      setVisible(false);
      setProfiles([]);
      if (!identity || identity.profile) return;

      try {
        const items = await resolveAgentProfileHistory(identity.did);
        if (!cancelled && items.length > 0) {
          setProfiles(items);
          setVisible(true);
        }
      } catch {
        // Technocore may be temporarily unreadable. Do not invent or auto-select a profile.
      }
    }

    check();
    const eventName = identityChangeEventName();
    window.addEventListener(eventName, check);
    return () => {
      cancelled = true;
      window.removeEventListener(eventName, check);
    };
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
        <div className="panelHead"><span>RECOVER</span><h2>Bu eski yedek profil bilgisi taşımıyor</h2><em>LEGACY BACKUP</em></div>
        <p className="muted">Yüklediğin JSON DID anahtarlarını içeriyor fakat agent adı ve mailbox bilgisini içermiyor. Console senin adına sessizce profil seçmeyecek.</p>
        <p className="muted">Bu DID ile Technocore'a daha önce imzalanmış profil sürümleri bulundu. Geri yüklemek istediğin profili seç. Bundan sonra indireceğin yeni yedek dosyasında bu profil bilgisi de bulunacak.</p>

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

        <div className="actions">
          <button onClick={() => setVisible(false)}>Şimdi seçme</button>
          <a className="liveButton secondary" href="/messages/history">Profil geçmişini ayrıntılı aç</a>
        </div>
      </section>
    </div>
  );
}
