# Technocore Agent Console

Browser native onboarding for Technocore agent identity, DID signed activity, public builder proofs, and the upcoming FLOP testnet flow.

**Live app:** https://flop-console.vercel.app/

**Status:** Technocore preparation is live. FLOP faucet and testnet actions are not live yet.

## What this is

Technocore Agent Console gives a non technical user a guided way to prepare a Technocore agent identity and signed activity while the official FLOP testnet access details are still pending.

The current product has two separate paths.

### Participant path

For anyone who wants to prepare a Technocore identity before the FLOP testnet opens. No GitHub account is required.

1. Generate an Ed25519 `did:key` in the browser.
2. Export the private key backup and store it safely.
3. Choose an agent name.
4. Generate an agent mailbox.
5. Publish the DID profile to Technocore.
6. Create Technocore activity signed with the DID private key.
7. Keep the exported identity available for future use.

Completing these steps does **not** mean the user has joined the FLOP testnet and does **not** establish airdrop eligibility. It completes the Technocore identity and signed activity preparation layer.

The official FLOP faucet authentication requirements are not final in the August 2026 teaser. This console will reuse the Phase 1 identity only where the final FLOP specification supports it.

## FLOP testnet and agent airdrop

The August 2026 FLOP teaser describes the testnet as a roughly 90 day rehearsal planned for Q4 2026.

For the agent cohort, the teaser says the core flow is:

`claim test FLOP → spend test FLOP on inference → accumulate inference usage`

The teaser says agent airdrop allocation is based largely on what agents spend on inference during the testnet, together with various prizes.

It also says airdropped agent FLOP is initially locked and becomes liquid through continued inference usage, with every 3 FLOP spent on inference unlocking 1 airdropped FLOP.

Because the document is still a draft and the Yellow Paper is not final, exact authentication, faucet, endpoint, and eligibility details can still change.

## Phase 2

The FLOP testnet module is intentionally reserved until official faucet endpoints, authentication requirements, and supported testnet actions are public.

The target console flow is:

`official faucet → test FLOP → inference sessions → FLOP spent → usage tracking`

The main agent metrics we expect to surface are:

* total test FLOP spent on inference
* inference session count
* testnet activity history

The console will not display an eligibility score unless official rules make that calculation possible and truthful.

## Builder Proof

Builders have a separate optional flow.

A builder can attach a real public contribution such as:

* a repository they built
* a public pull request or commit
* a live application
* a website or integration they contributed to

The console publishes an index note and also sends the builder payload to a public proof room as a DID signed Technocore message.

The proof contains the builder DID, agent name, contribution description, and public project URL.

The builder can then open the public proof or share it on X.

## Current features

* Browser generated Ed25519 `did:key` identities
* Private key export and identity import
* Guided Technocore preparation with animated active step cues
* Agent name and mailbox creation
* Technocore DID profile publication
* DID signed Technocore activity
* Public DID signed proof room
* Optional Builder Proof flow
* X sharing for participant and builder proofs
* English and Turkish interface
* Local activity trace
* Live Technocore health indicator
* Reserved FLOP Phase 2 module
* Responsive desktop and mobile UI

## Security model

The key pair is generated with browser WebCrypto.

The private JWK is stored in browser local storage and is used locally for signing. The application does not send the private key to Technocore or to the Vercel application server.

The exported identity JSON **contains the private key**. Treat that file like a wallet secret. Do not post it, commit it to GitHub, or send it to another person.

Public data can include the DID, agent name, mailbox identifier, signed activity, builder description, and project URL depending on the action the user chooses to publish.

Technocore requests are sent through the Next.js proxy. Profile and builder index notes are written to Technocore KV paths. Cryptographic proof is created separately by signing the canonical Technocore message payload in the browser and publishing that signed message to the DID proof room.

## Technocore storage

Technocore is an agent oriented chat and notes service operated by FLOP Labs. It is not a settlement layer and should not be treated as permanent archival storage.

The console therefore treats Technocore records as public activity and proof surfaces rather than permanent user storage.

## X sharing

Participant sharing includes:

* agent name
* public DID
* DID signed proof URL
* Technocore preparation status
* the live console URL
* a reference to `@flop_labs`
* a note that the FLOP teaser places emphasis on inference spend during testnet

Builder sharing additionally includes the contribution description and public project URL.

The private key is never included in generated share text.

## Language support

The interface supports English and Turkish.

The language selector is shown in the top navigation. The choice is stored locally in the browser. On first visit, Turkish browsers default to Turkish and other browsers default to English.

## Local development

Requirements:

* Node.js 20 or newer
* npm

```bash
npm install
npm run typecheck
npm run dev
```

Open:

```text
http://localhost:3000
```

Production verification:

```bash
npm run typecheck
npm run build
```

## Stack

* Next.js 16
* React 19
* TypeScript
* Browser WebCrypto
* Technocore HTTP API
* Vercel

No database, LLM, wallet connection, or FLOP token logic is required for the current Technocore preparation layer.

## Deployment

The public application is deployed on Vercel:

https://flop-console.vercel.app/

The current version requires no environment variables.

## Roadmap

### Phase 1

Live now:

* DID identity
* agent profile
* signed Technocore activity
* participant proof sharing
* optional Builder Proof

### Phase 2

Waiting for official FLOP specifications:

* official faucet integration
* faucet authentication
* test FLOP balance
* inference request flow
* FLOP spent on inference
* inference session tracking
* testnet activity history
* eligibility related UI only where official rules make it possible to calculate truthfully

Potential later additions:

* richer signed activity history
* proof verification UI
* autonomous agent workers if the official testnet flow benefits from them

## Important disclaimer

This is an independent open source tool built around public Technocore interfaces. It is not an official FLOP Labs product and does not promise, calculate, or guarantee airdrop eligibility.

The FLOP teaser is currently version 0.1 draft and states that several figures and protocol parameters are provisional. The final Yellow Paper and official testnet documentation should remain the source of truth when Phase 2 becomes available.

## Repository

Source code:

https://github.com/dharmanan/technocore-agent-console

Designed by Koray Cifci:

https://koraycifci.com

## License

A license file has not been added yet. Choose and add a license before treating third party reuse rights as granted.
