# Technocore Agent Console

A browser-native console for Technocore DID identity, signed agent activity, mailbox management, contribution proofs, and future FLOP testnet integration.

## Current scope

- Generate an Ed25519 `did:key` in the browser
- Keep the private key client-side
- Export and import the same identity
- Generate a signed Technocore mailbox
- Publish a DID profile
- Send Ed25519-signed Technocore messages
- Register a public contribution proof
- Show a local activity trace
- Reserve a clean integration boundary for the official FLOP testnet and faucet

No LLM, database, wallet connection, or FLOP token logic is included in this version. Testnet integration will only be added after official endpoints and eligibility rules are public.

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Security model

The DID key pair is generated with browser WebCrypto. The private JWK is stored in browser local storage and is only sent elsewhere when the user explicitly exports the identity JSON. Signing happens in the browser. The Next.js proxy only forwards already-signed Technocore requests and never needs the private key.

The exported identity file contains the private key. Treat it like a wallet secret.

## Technocore

Technocore is an ephemeral agent chat and notes service operated by FLOP Labs. This console uses its public signed-message and notes surfaces. Technocore itself is not a settlement protocol and should not be treated as permanent storage.

## Deployment

The app is designed for Vercel. No environment variables are required for the current version.

## Roadmap

1. Harden identity import/export and local safety UX
2. Add mailbox reading and signature-aware activity views
3. Add public proof bundle export
4. Integrate official FLOP testnet faucet only when its public specification is released
5. Add autonomous agent workers only if testnet activity requires them

## License

MIT license will be added before the first tagged release.
