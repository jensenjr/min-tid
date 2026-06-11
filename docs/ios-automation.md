# Effortless check-in/out — architecture & iOS roadmap

The goal: track office worktime **without effort**. You should not have to open
an app and press a button — arriving at the office *is* the check-in.

This is how Visma Tid / Fortnox Tid–class products approach it too: the punch
itself is a tiny event that many different triggers can fire, and the app's job
is to apply the business rules (schedule, dedupe, sanity guards) around it.

## How it works today (no native app required)

Everything is built on **URL actions**:

```
https://<your-domain>/?action=in|out|toggle&source=qr|nfc|wifi|shortcut|link
```

Opening that URL punches the clock. `src/lib/actions.ts` parses it,
`PunchClock.tsx` executes it. The URL is stripped from the address bar
immediately, so a reload never re-punches.

Because *anything on an iPhone that can open a URL* becomes a punch trigger,
all three requested mechanisms work without an App Store app:

| Trigger | How | Setup |
|---|---|---|
| **QR code** | iPhone camera scans a printed sign → opens the URL | "Automatisering" sheet in the app → print signs |
| **NFC tag** | iOS Shortcuts personal automation: *When NFC tag is scanned → Open URL* | Genvägar → Automation → NFC |
| **WiFi (automatic)** | iOS Shortcuts personal automation: *When joining "Office-WiFi" → Open URL* (`action=in`), *When leaving → Open URL* (`action=out`) | Genvägar → Automation → WiFi, turn off "Ask before running" |
| **Home-screen shortcut** | PWA app shortcuts (long-press the app icon) declared in `manifest.webmanifest` | Install to home screen |

The in-app **"Automatisera in/ut-checkning"** sheet generates the QR codes and
contains copy-ready links plus step-by-step Shortcuts recipes.

### Business rules applied to every automated punch

- **Schedule-aware:** an automatic check-in on a day the schedule marks as free
  asks for confirmation instead of silently starting a session.
- **Dedupe:** the same action within 2 minutes is ignored — WiFi flapping or a
  double-scanned QR code can't create duplicate sessions.
- **Same guards as the button:** automated check-outs go through the
  short-session (<1 min) and late-punch-out (forgot to check out) flows.
- **Audit trail:** each session records its trigger (`source`) and shows a
  badge in the history (📷 QR, 🏷️ NFC, 📶 WiFi, ⚡ shortcut).
- **Schedule nudges:** if the scheduled start passes without a punch, the clock
  view (and an installed PWA opened later) shows "Enligt schemat började du
  08:00 — checka in?" with a backdated one-tap option; same at the scheduled end.

### PWA

`public/manifest.webmanifest` + `public/sw.js` make the app installable and
offline-capable. Install via Safari → Dela → "Lägg till på hemskärmen".

## Phase 2 — native iOS wrapper (when needed)

Web + Shortcuts covers QR, NFC and WiFi today. A native wrapper becomes worth
it for the things Safari cannot do:

| Capability | Why native |
|---|---|
| **Push notifications** | Reliable "du glömde checka ut"-pushar även när appen är stängd. (iOS ≥16.4 supports Web Push for installed PWAs, but native is more dependable.) |
| **Live Activities** | Pågående pass som live-widget på låsskärmen/Dynamic Island |
| **App Intents / Siri** | "Hej Siri, checka in" + native Shortcuts actions without opening a URL |
| **Geofencing** | Check-in on *arrival at the address* rather than WiFi join — works even if the phone hesitates to join WiFi |
| **Background NFC** | Tag reading without the Shortcuts indirection |

Recommended path: **Capacitor** (capacitorjs.com). The entire React app is
reused as-is:

1. `npm i @capacitor/core @capacitor/ios && npx cap init && npx cap add ios`
2. Point the iOS shell at the deployed URL (or bundle `dist/`).
3. Add plugins incrementally: `@capacitor/push-notifications`,
   `@capacitor/local-notifications`, geolocation for geofencing.
4. URL actions keep working unchanged — deep links (`min-tid://?action=in`)
   map onto the exact same `consumeActionFromUrl()` path.

Requires an Apple Developer account ($99/yr) and Xcode for building; nothing
in the web codebase needs to change ahead of time.
