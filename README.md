# Travel Pin Map

A browser-only SPA for an event travel map. The TV display lives at `/`, guests submit pins at `/guest?k=<event-key>`, and admins manage the event at `/admin`.

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

## Event flow

- Open `/admin`, sign in with a Google account listed in `/config/event.adminEmails`, copy the guest link, and start or pause the event.
- Open `/` on the TV browser and sign in once with the same Google account.
- Guests scan the QR code pointing to `/guest?k=<event-key>`, anonymously sign in, tap the map, and submit a pin.
