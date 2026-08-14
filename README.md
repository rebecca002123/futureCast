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

This repo is already linked to the EAS project (`rebecca0021/eclipse-lookout`
— same project as before, the app is now Christmas Lockbox). Merging to
`main` auto-publishes an update via `.eas/workflows/publish-update.yml`.

To install on your phone:

1. Sign in at [expo.dev](https://expo.dev) and open the project.
2. **Builds → Build from GitHub**, pick this branch (or `main` after
   merging), platform, and the `preview` profile.
   - **Android**: the `preview` build makes an APK you install straight from
     the build page.
   - **iOS**: needs your Apple Developer account; EAS walks you through it
     and can push to TestFlight.
3. Because the bundle identifiers are unchanged, the new build installs right
   over the old Eclipse Lookout app.

For a quick look without building: open the project's **Updates** page on
expo.dev after merging and scan the update's QR code with **Expo Go**.

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
