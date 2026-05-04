# Travel Pin Map

A browser-only SPA for an event travel map. The TV display lives at `/`, guests submit pins at `/guest?k=<event-key>`, and admins manage the event at `/admin`.

City search data is derived from [Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database), licensed under ODbL-1.0.

Regenerate the reduced local city index with `npm run build:city-index`; the script downloads the upstream city export and writes `public/cities.min.json`.

## Setup

1. Create a Firebase project, enable Authentication providers for Google and Anonymous, and enable Firestore.
2. Copy `.env.example` to `.env` and fill in your Firebase web app config.
3. Run `npm install`, then `npm run dev` for local development.
4. Create `/config/event` in Firestore from a trusted backend/admin context:

```json
{
  "eventKey": "<base64 secret, ~24 bytes>",
  "eventName": "Event 2026",
  "active": false,
  "adminEmails": ["admin@example.com"]
}
```

5. Deploy rules and hosting with Firebase CLI:

```sh
firebase deploy --only firestore:rules
npm run build
firebase deploy --only hosting
```

The admin allowlist lives in `/config/event.adminEmails` and is enforced by Firestore rules. It is not hardcoded in the frontend.

Guest submissions automatically censor English profanities before they are written to Firestore. Standalone profanity is masked, and common inflected forms are masked only on the profane portion, for example `shit` -> `****` and `shitting` -> `****ting`.

## Demo pin seeding

Generate realistic Asia travel pins with Firebase anonymous auth and the Firestore REST API:

```sh
EVENT_KEY="<event-key>" npm run seed:asia-pins
```

By default, the script creates 200 pins and writes one pin every 3 seconds. For a faster one-off seed, override the interval:

```sh
EVENT_KEY="<event-key>" npm run seed:asia-pins -- --count 200 --interval-ms 0
```

The script reads Firebase web config from `.env.local` or `.env`, signs in anonymously, and each generated pin is still validated by the Firestore security rules.

## Event flow

- Open `/admin`, sign in with a Google account listed in `/config/event.adminEmails`, copy the guest link, and start or pause the event.
- Open `/` on the TV browser and sign in once with the same Google account.
- Guests scan the QR code pointing to `/guest?k=<event-key>`, anonymously sign in, tap the map, and submit a pin.
