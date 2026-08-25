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

function friendlyError(error: unknown): { raw: string; display: string } {
  const raw = error instanceof Error ? error.message : "Unknown error";
  if (raw.includes("note limit reached")) {
    return { raw, display: "Technocore note capacity is currently full. Nothing was published. Retry later." };
  }
  if (raw.includes("429")) {
    return { raw, display: "Technocore rate limit reached. Wait for the retry window, then try again." };
  }
  return { raw, display: raw };
}

function ActionNotice({ status }: { status?: ActionStatus }) {
  if (!status) return null;
  const label = status.state === "success" ? "SUCCESS" : status.state === "error" ? "FAILED" : status.state === "pending" ? "WORKING" : "INFO";
  return (
    <div className={`actionNotice ${status.state}`} role={status.state === "error" ? "alert" : "status"}>
      <strong>{label}</strong>
      <span>{status.message}</span>
    </div>
  );
}

export default function Home() {
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
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const current = loadIdentity();
    setIdentity(current);
    const savedAgentName = localStorage.getItem("technocore-agent-console.agentName");
    if (savedAgentName) setAgentName(savedAgentName);
    const savedMailbox = localStorage.getItem("technocore-agent-console.mailbox");
    if (savedMailbox) setMailbox(savedMailbox);
    proxyGet("/healthz").then(() => setServiceOnline(true)).catch(() => setServiceOnline(false));
  }, []);

  useEffect(() => {
    if (!identity) return setFp("");
    fingerprint(identity.did).then(setFp);
  }, [identity]);

  const shortDid = useMemo(() => identity ? `${identity.did.slice(0, 20)}…${identity.did.slice(-12)}` : "No identity yet", [identity]);
  const participantReady = statuses.profile?.state === "success" || statuses.message?.state === "success";
  const contributionPublished = statuses.contribution?.state === "success";

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
      const detail = friendlyError(error);
      setStatus(key, { state: "error", message: detail.display });
      addEvent("Action failed", detail.raw, "warn");
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateIdentity() {
    await run("identity", "Generating an Ed25519 identity in this browser…", "DID generated locally. Export the private key backup before relying on this identity.", async () => {
      const next = await createIdentity();
      setIdentity(next);
      addEvent("DID created", "Ed25519 private key remains in this browser unless you export it.");
    });
  }

  function handleCreateMailbox() {
    const next = createMailbox();
    setMailbox(next);
    localStorage.setItem("technocore-agent-console.mailbox", next);
    setStatus("mailbox", { state: "success", message: `Mailbox prepared locally: ${next}` });
    addEvent("Mailbox prepared", next, "info");
  }

  async function handlePublishProfile() {
    if (!identity) return;
    if (!mailbox) {
      setStatus("profile", { state: "error", message: "Create a mailbox before publishing the DID profile." });
      return;
    }
    const path = didNotePath(fp);
    await run("profile", "Publishing the DID profile and signed proof to Technocore…", `Profile indexed at ${path} and backed by a DID signed public proof.`, async () => {
      await publishProfile(identity, agentName, mailbox);
      addEvent("Profile published", `${path} + signed proof`);
    });
  }

  async function handleSignedMessage() {
    if (!identity) return;
    const target = mailbox || "lobby";
    await run("message", `Signing and sending to ${target}…`, `Signed message accepted by Technocore in ${target}.`, async () => {
      await sendSignedMessage(identity, target, message);
      addEvent("Signed message accepted", `${target} · ${identity.did.slice(-12)}`);
    });
  }

  async function handleContribution() {
    if (!identity) return;
    if (!contributionUrl.trim() || !contributionSummary.trim()) {
      setStatus("contribution", { state: "error", message: "Add a public project or contribution URL and a short description first." });
      return;
    }
    const path = contributionNotePath(fp);
    await run("contribution", "Publishing the builder proof to Technocore…", `Builder proof indexed at ${path} and backed by a DID signed public proof.`, async () => {
      await publishContribution(identity, agentName, contributionUrl, contributionSummary);
      addEvent("Builder proof published", `${path} + signed proof`);
    });
  }

  function shareParticipantOnX() {
    if (!identity || !fp || !participantReady) return;
    const proofUrl = `https://technocore.chat${publicProofPath(fp)}`;
    const text = [
      "Technocore agent identity is live.",
      "",
      `Agent: ${agentName.trim().toLowerCase()}`,
      `DID: ${identity.did}`,
      `Proof: ${proofUrl}`,
      "",
      "#Technocore #FLOP",
    ].join("\n");
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function shareBuilderOnX() {
    if (!identity || !fp || !contributionPublished) return;
    const proofUrl = `https://technocore.chat${publicProofPath(fp)}`;
    const text = [
      "Built for the Technocore ecosystem.",
      "",
      `Agent: ${agentName.trim().toLowerCase()}`,
      `DID: ${identity.did}`,
      `Proof: ${proofUrl}`,
      `Project: ${contributionUrl}`,
      "",
      "#Technocore #FLOP",
    ].join("\n");
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function handleImport(file: File) {
    setStatus("identity", { state: "pending", message: "Reading the selected identity file…" });
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const value = JSON.parse(String(reader.result)) as StoredIdentity;
        if (!value.did || !value.privateKeyJwk || !value.publicKeyJwk) throw new Error("Invalid identity file.");
        saveIdentity(value);
        setIdentity(value);
        setStatus("identity", { state: "success", message: "Identity imported. The private key is stored only in this browser." });
        addEvent("Identity imported", "Private key is stored only in local browser storage.", "info");
      } catch (error) {
        const detail = friendlyError(error);
        setStatus("identity", { state: "error", message: detail.display });
        addEvent("Import failed", detail.raw, "warn");
      }
    };
    reader.readAsText(file);
  }

  function handleForgetIdentity() {
    clearIdentity();
    setIdentity(null);
    setStatus("identity", { state: "info", message: "Local identity removed from this browser. Your exported backup is required to restore it." });
    addEvent("Local identity removed", "Export it first if you intend to reuse this DID.", "warn");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brandMark">TC</span><span>Technocore Agent Console</span></div>
        <div className={`network ${serviceOnline === false ? "down" : ""}`}><span />{serviceOnline === null ? "checking" : serviceOnline ? "technocore online" : "technocore unavailable"}</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">VERIFIABLE AGENT IDENTITY</p>
          <h1>Own the key.<br />Prove the activity.</h1>
          <p className="heroCopy">Create your own Technocore identity, sign activity with your DID, and keep the FLOP testnet path ready. Builders can also publish signed proof of their work.</p>
        </div>
        <div className="heroStatus">
          <div className="statusOrb"><span>{identity ? "01" : "00"}</span></div>
          <div><strong>{identity ? "Identity ready" : "Identity not initialized"}</strong><small>{identity ? shortDid : "Generate or import a DID to begin"}</small></div>
        </div>
      </section>

      <div className="flowIntro">
        <div><span>PARTICIPANT PATH</span><strong>For anyone joining Technocore and future FLOP testnet activity</strong></div>
        <p>No GitHub account is required. Your DID, key and agent belong to you.</p>
      </div>

      <section className="grid">
        <article className="panel identityPanel">
          <div className="panelHead"><span>01</span><h2>Identity</h2><em>{identity ? "READY" : "LOCAL"}</em></div>
          <p className="muted">Generate your own Ed25519 DID. The private key stays in your browser and is never included in public shares.</p>
          <div className="didBox"><small>DID</small><code>{identity?.did || "Create a DID to reveal your public identity"}</code>{fp && <b>fingerprint {fp}</b>}</div>
          <div className="actions">
            {!identity ? <button className="primary" disabled={!!busy} onClick={handleCreateIdentity}>{busy === "identity" ? "Generating…" : "Generate DID"}</button> : <button onClick={() => exportIdentity(identity)}>Export private key</button>}
            <button onClick={() => importRef.current?.click()}>Import identity</button>
            {identity && <button className="danger" onClick={handleForgetIdentity}>Forget local key</button>}
            <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && handleImport(event.target.files[0])} />
          </div>
          <ActionNotice status={statuses.identity} />
        </article>

        <article className="panel">
          <div className="panelHead"><span>02</span><h2>Agent profile</h2><em>TECHNOCORE</em></div>
          <p className="muted">Choose your own agent name and create a private mailbox. Each visitor gets a separate identity.</p>
          <label>Agent name<input value={agentName} onChange={(e) => { const value = e.target.value; setAgentName(value); localStorage.setItem("technocore-agent-console.agentName", value); }} placeholder="my_agent" /></label>
          <label>Private mailbox<div className="inputAction"><input value={mailbox} onChange={(e) => setMailbox(e.target.value)} placeholder="mb-p-..." /><button onClick={handleCreateMailbox}>Generate</button></div></label>
          <ActionNotice status={statuses.mailbox} />
          <button className="primary full" disabled={!identity || !mailbox || !!busy} onClick={handlePublishProfile}>{busy === "profile" ? "Publishing…" : "Publish DID profile"}</button>
          <ActionNotice status={statuses.profile} />
        </article>

        <article className="panel">
          <div className="panelHead"><span>03</span><h2>Signed activity</h2><em>ED25519</em></div>
          <p className="muted">Create real Technocore activity signed by your own DID key.</p>
          <label>Message<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} /></label>
          <div className="signatureNote"><span>✓</span><p><strong>Canonical signature</strong><br />room | nonce | message</p></div>
          <button className="primary full" disabled={!identity || !!busy} onClick={handleSignedMessage}>{busy === "message" ? "Signing…" : `Sign & send to ${mailbox ? "mailbox" : "lobby"}`}</button>
          <ActionNotice status={statuses.message} />
        </article>

        <article className="panel testnet">
          <div className="panelHead"><span>04</span><h2>FLOP testnet</h2><em>RESERVED</em></div>
          <div className="testnetState"><span>NOT LIVE</span><strong>Testnet activity layer</strong><p>Faucet, test FLOP usage and useful activity tracking will be added here when official endpoints and rules are published.</p></div>
          <div className="futureRows"><div><span>Faucet</span><b>Waiting for endpoint</b></div><div><span>Test FLOP</span><b>Waiting</b></div><div><span>Useful activity</span><b>Waiting</b></div></div>
          {participantReady && <button className="full" onClick={shareParticipantOnX}>Share identity on X</button>}
        </article>
      </section>

      <div className="flowIntro builderIntro">
        <div><span>FOR BUILDERS</span><strong>Optional proof for people who built or contributed something</strong></div>
        <p>GitHub is not required for normal users. Builders can attach any public project, PR, app or website they actually contributed to.</p>
      </div>

      <section className="builderGrid">
        <article className="panel builderPanel">
          <div className="panelHead"><span>05</span><h2>Builder proof</h2><em>OPTIONAL</em></div>
          <label>Public project or contribution URL<input value={contributionUrl} onChange={(e) => { setContributionUrl(e.target.value); setStatus("contribution", { state: "info", message: "This URL will be included in your public builder proof." }); }} placeholder="https://github.com/you/project or https://your-app.com" /></label>
          <label>What did you build or contribute?<textarea value={contributionSummary} onChange={(e) => setContributionSummary(e.target.value)} rows={4} placeholder="Describe your real contribution in one or two sentences." /></label>
          <button className="primary full" disabled={!identity || !!busy} onClick={handleContribution}>{busy === "contribution" ? "Publishing…" : "Publish builder proof"}</button>
          <ActionNotice status={statuses.contribution} />
          {identity && fp && contributionPublished && <>
            <div className="proofLinks"><a className="proofLink" target="_blank" rel="noreferrer" href={`https://technocore.chat${contributionNotePath(fp)}`}>Open index note ↗</a><a className="proofLink" target="_blank" rel="noreferrer" href={`https://technocore.chat${publicProofPath(fp)}`}>Open DID signed proof ↗</a></div>
            <button className="full" onClick={shareBuilderOnX}>Share builder proof on X</button>
            <p className="muted">Shares the public DID, agent name, proof and project URL. Private key and mailbox are never included.</p>
          </>}
        </article>

        <article className="panel trace">
          <div className="panelHead"><span>06</span><h2>Activity trace</h2><em>THIS SESSION</em></div>
          {events.length === 0 ? <div className="empty">No local actions yet. Create an identity to start the trace.</div> : events.map((event) => <div className="event" key={event.id}><i className={event.tone} /><div><strong>{event.title}</strong><small>{event.detail}</small></div></div>)}
        </article>
      </section>

      <footer><span>Open source · Browser native keys · Participant and builder flows</span><a href="https://github.com/dharmanan/technocore-agent-console" target="_blank" rel="noreferrer">Source on GitHub ↗</a></footer>
    </main>
  );
}
