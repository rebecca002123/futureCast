# Christmas Lockbox 🎄🔒

Squirrel money away every month, locked where you can't touch it — then the
box springs open every year just before Christmas so you can spend it on
presents. Built with [Expo](https://expo.dev) / React Native.

## What it does

- **Monthly auto-deposits** — pick an amount and a day of the month (payday!)
  and the lockbox credits itself automatically every month, even catching up
  on months where you never opened the app.
- **Properly locked** — no withdraw button exists until December. The balance
  just sits there growing, with a countdown to unlock day.
- **Unlocks every year before Christmas** — on your chosen December day
  (1st–24th) the box opens, confetti-snow intensifies, and you can spend from
  it until the end of Boxing Day. Whatever's left rolls over to next year and
  the box locks itself again.
- **Goal tracking** — set a Christmas budget and watch the projected balance
  fill the bar.
- **Top-ups** — add extra any time (in is always allowed; out is not).
- **Emergency unlock** — life happens: you can force it open, but only after
  a 72-hour cooling-off wait you can cancel at any time.
- **Reminders** — a notification on each deposit day and on the December
  morning the box opens.

## The honest bit: how the money actually moves

Apps can't reach into your bank account by themselves — only banks and
licensed payment institutions can move your money. The lockbox is designed to
pair with your bank:

1. Open a separate savings account (or "pot"/"space") in your banking app.
2. Set up a **standing order** for the same amount, on the same day, into it.
3. The lockbox mirrors that money, keeps it locked and out of sight, and
   rings the bell in December. (The in-app "How the money moves" card walks
   through this.)

Everything is stored on your phone. No servers, no accounts, nothing leaves
your device.

## Install and test via expo.dev (EAS)

Christmas Lockbox is its **own app** (slug `christmas-lockbox`, bundle id
`com.christmaslockbox.app`) so it can live on your phone alongside the other
apps built from this repo. It lives on the
`claude/christmas-savings-lockbox-8u7c9g` branch — `main` hosts a different
app.

One-time setup:

1. Sign in at [expo.dev](https://expo.dev) → **Create a project** named
   exactly `christmas-lockbox`.
2. Open the project → **Settings → GitHub** and link the `futureCast`
   repository.
3. Copy the project's ID into `app.json` under `extra.eas.projectId`
   (or run `eas init` locally).

Then to install: **Builds → Build from GitHub**, pick the
`claude/christmas-savings-lockbox-8u7c9g` branch, platform, and the
`preview` profile.

- **Android**: the `preview` build makes an APK you install straight from
  the build page.
- **iOS**: needs your Apple Developer account (new bundle id, so EAS will
  set up fresh provisioning) and can push to TestFlight. The home-screen
  widget ships inside the same build.

## Run locally

```bash
npm install
npx expo start        # scan the QR with Expo Go
npx expo start --web  # or in the browser
```

## Project layout

- `App.js` — UI (setup, vault, spending, settings)
- `src/vault.js` — all the money/locking logic (pure functions)
- `src/storage.js` — on-device persistence
- `src/notify.js` — deposit-day and unlock-day reminders
- `src/Snow.js` — the snow ❄

---

This repository also hosts the privacy/support pages for the FutureCast iOS
app: [PRIVACY.md](PRIVACY.md) · [index.html](index.html) ·
support: rebeccaguntrip2001@gmail.com
