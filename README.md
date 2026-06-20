# Unveil

Unveil is a Next.js demo app for pay-to-reveal media, creator messaging, tips,
and metered voice calls backed by an app balance and Tempo/MPP-style settlement
flows.

## Stack

- Next.js 16 App Router and React 19
- Tailwind CSS
- Drizzle ORM with Postgres
- Vercel Blob or Supabase Storage for private media
- ElevenLabs conversational voice calls
- Tempo testnet settlement helpers through `viem`/`mppx`

## Getting Started

Install dependencies:

```bash
npm install
```

Create `.env.local` with the project secrets for Postgres, storage, auth,
Tempo, and ElevenLabs. Common local variables include:

```bash
DATABASE_URL=
BLOB_READ_WRITE_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=media
PLATFORM_WALLET_ADDRESS=
PLATFORM_PRIVATE_KEY=
CUSTODIAL_KEY_ENCRYPTION_SECRET=
TEMPO_RPC_URL=
NEXT_PUBLIC_VEIL_TOKEN_ADDRESS=
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

Then prepare and run the app:

```bash
npm run db:push
npm run seed
npm run dev
```

Open `http://localhost:3001`.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run db:push
npm run db:studio
npm run seed
npm run reseed
npm run new-post
```

## Demo Notes

- The demo login reset currently clears unlock state and wallet credits for the
  configured demo user so flows can be shown fresh.
- Voice calls use self-hosted ElevenLabs AudioWorklet assets from
  `public/elevenlabs-worklets` to avoid mobile/CSP loading issues.
- Auto-blur upload flows can use mocked sensitive regions for faster demos.
- Testnet/demo keys only. Do not commit real secrets.

## Documentation

More detailed notes live in [docs/README.md](docs/README.md).
