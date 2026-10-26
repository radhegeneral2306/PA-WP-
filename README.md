# PA-WP: WhatsApp Task Bot

WhatsApp-based task management for staff across branches, built on the Interakt
WhatsApp Business API, Cloudflare Workers and Firebase (Firestore).

## Layout

```
worker/                 Cloudflare Worker (webhook receiver + bot)
  src/index.ts          routing, secret/org checks, dedup, dispatch
  src/interakt/parse.ts webhook body -> IncomingMessage
  src/interakt/send.ts  Text / InteractiveList / InteractiveButton senders
  src/firebase/         service-account auth + minimal Firestore REST client
  src/batch0.ts         Batch 0 test bot (to be replaced by the real menu)
docs/SETUP-batch0.md    setup guide (Firebase, Cloudflare, Interakt webhook)
```

## Development

```
cd worker
npm install
npm test          # unit tests
npm run typecheck
```

## Status

- **Batch 0** (current): verify list/button session messages and reply payloads.
