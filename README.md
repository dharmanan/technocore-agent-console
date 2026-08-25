# Technocore Agent Console

Browser native onboarding for Technocore agent identity, DID signed activity, public builder proofs, and the upcoming FLOP testnet flow.

**Live app:** https://flop-console.vercel.app/

**Status:** Phase 1 is live. FLOP faucet and testnet actions are not live yet.

## What this is

Technocore Agent Console gives a non technical user a guided way to prepare a Technocore agent identity before the official FLOP testnet flow becomes available.

The current product has two separate paths.

### Participant path

For anyone preparing for future FLOP testnet activity. No GitHub account is required.

1. Generate an Ed25519 `did:key` in the browser.
2. Export the private key backup and store it safely.
3. Choose an agent name.
4. Generate an agent mailbox.
5. Publish the DID profile to Technocore.
6. Create Technocore activity signed with the DID private key.
7. Keep the same DID and private key for Phase 2.

Completing these steps does **not** mean the user has joined the FLOP testnet. It completes the identity and signed activity preparation layer.

### Phase 2

The FLOP testnet module is intentionally reserved until official faucet endpoints, authentication requirements, supported actions, and eligibility rules are public.

The intended continuation is:

`Existing DID → official faucet → test FLOP → supported testnet activity → activity tracking`

The console will use the same identity created in Phase 1 where the official FLOP specification allows it.

There is no claim that Phase 1 activity alone guarantees a FLOP airdrop or any future eligibility.

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
* Guided Phase 1 progress with animated active step cues
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
* Phase 1 status
* the live console URL
* a reference to `@flop_labs`

Builder sharing additionally includes the contribution description and public project URL.

The private key is never included in the generated share text.

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

No database, LLM, wallet connection, or FLOP token logic is required for Phase 1.

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
* test FLOP balance and usage
* supported testnet actions
* useful activity tracking
* eligibility related UI only where official rules make it possible to calculate truthfully

Potential later additions:

* richer signed activity history
* proof verification UI
* autonomous agent workers if the official testnet flow benefits from them

## Important disclaimer

This is an independent open source tool built around public Technocore interfaces. It is not an official FLOP Labs product and does not promise, calculate, or guarantee airdrop eligibility.

Official FLOP testnet rules and endpoints should remain the source of truth when Phase 2 becomes available.

## Repository

Source code:

https://github.com/dharmanan/technocore-agent-console

Designed by Koray Cifci:

https://koraycifci.com

## License

A license file has not been added yet. Choose and add a license before treating third party reuse rights as granted.
