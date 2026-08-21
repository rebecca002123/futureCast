# Atlantic Storm Watch 🌀🇬🇧

Live Atlantic hurricane tracking with a UK slant, built with
[Expo](https://expo.dev) / React Native: every storm the National Hurricane
Center is advising on, everything that might still form, and an honest answer
to the question that actually matters here — **is any of it coming for us?**

## What it does

- **Every active Atlantic storm** — positions, category, sustained winds
  (mph), central pressure and movement, straight from the NHC's live feed,
  with the distance from the UK.
- **Official forecast tracks** — each storm's NHC Forecast/Advisory is parsed
  into its 5-day track and drawn on the map (solid line), with the forecast
  intensity at each point.
- **UK risk score** — the app extends the official track along the heading and
  speed of its final leg (dashed line: the app's own extrapolation, *not* an
  NHC forecast), finds the closest that path comes to the UK and when, and
  scores it against how well the storm is aimed at us, whether it's recurving
  north-east, and how strong it is. Tap any storm to see exactly how the score
  was worked out.
- **Formation watch** — the NHC Tropical Weather Outlook: areas of disturbed
  weather with their 2-day and 7-day chances of developing, and a note on
  whether they're in the part of the Atlantic that can send systems our way.
- **UK wind outlook** — 16 days of maximum forecast gusts across nine UK
  locations from the Open-Meteo global model. This is where an ex-hurricane
  actually shows up for us: once a storm is being dragged across the Atlantic,
  the models put the wind into this chart days before it arrives.
- **Official UK weather warnings** — the Met Office's live yellow/amber/red
  warnings (via MeteoAlarm's keyless feed), including the storm's name when
  one is named ("Storm Floris"). Red and amber warnings take over the top
  banner and arrive as time-sensitive notifications.
- **Risk for my location** — pick your town (no GPS permission needed; ~100
  UK & Irish towns bundled) and the app shows how close each storm's track
  passes to *you*, when, and your own 16-day gust outlook.
- **Flood warnings** — live Environment Agency flood alerts and warnings
  (England only — Wales and Scotland publish separately), with severe flood
  warnings as urgent notifications.
- **Season context** — how many systems this season has produced versus the
  1991–2020 average for the date, days to the 10 September climatological
  peak, a running log of every storm the app has tracked this season, and
  the ex-hurricanes that actually reached the UK before.
- **Atlantic lows radar** — a model-grid scan of the whole North Atlantic
  that finds every deep low in the 7-day forecast and follows it: crucially,
  this keeps tracking an **ex-hurricane after the NHC stops advising on it**
  (the exact phase in which one threatens the UK), links it back to the
  named storm it used to be ("Ex-Fiona"), and catches non-tropical
  windstorms too. Labelled as model estimates throughout.
- **Alerts** — notifications when a storm's UK risk reaches your chosen level
  (Watch / Elevated / High), when a new named storm forms or an area is likely
  to develop, and when gales appear in the UK forecast. Storms at Elevated or
  High risk arrive as **time-sensitive** notifications that break through Focus
  modes; everything else is a normal alert, and routine alerts are held
  overnight (23:00–07:00) unless they're urgent. Each storm alert carries a
  **Mute for 24h** button for a system that sits over the Atlantic for a week.
  There's a **Send a test notification** button in Alerts so you can prove it
  all works without waiting for a hurricane.
- **Home Screen and Lock Screen widgets** — a WidgetKit extension showing the
  highest UK risk at a glance. Small: the risk band and the storm behind it.
  Medium: adds the closest approach and the next windy UK day. Lock Screen:
  circular, rectangular and inline versions. Requires a real build — see below.

## Widgets

The widget lives in `targets/storm-widget` (SwiftUI + WidgetKit) and is built
into the app by [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets).

It can't run the app's JavaScript, so the app writes a small JSON snapshot into
a shared **App Group** (`group.com.eclipselookout.app`) after every refresh —
foreground *and* the background checks while the app is closed — and then asks
WidgetKit to reload. The widget renders that snapshot and shows how old it is,
so a stale widget is obvious rather than misleading.

To build it:

1. **Set your Apple Team ID.** Either export `APPLE_TEAM_ID=XXXXXXXXXX` (as an
   EAS environment variable for cloud builds, or in your shell before
   `npx expo prebuild`), or paste it into `app.json` under
   `expo.ios.appleTeamId`. Find it in Xcode → Signing & Capabilities, or on
   [developer.apple.com](https://developer.apple.com/account) under Membership.
   Without it the app still builds, but the widget target won't sign.
2. **Make a new native build** — `eas build` (or `npx expo prebuild -p ios &&
   npx expo run:ios`). The widget is native code, so an over-the-air update
   *cannot* deliver it: merging to `main` publishes JS only.
3. On the phone: long-press the Home Screen → **+** → search for **Storm
   Watch**. For the Lock Screen: Customise → the widget slot under the clock.

EAS Build creates the App Group and the time-sensitive notification capability
on the App ID as part of the build. Widgets never appear in Expo Go.

## Data sources & accuracy

| Source | What | Notes |
| --- | --- | --- |
| [NHC `CurrentStorms.json`](https://www.nhc.noaa.gov/CurrentStorms.json) | Active storm positions, intensity, movement | Keyless public feed |
| NHC Forecast/Advisory (TCM) | Official forecast track to 5 days | One text product per storm, parsed in-app |
| [NHC Tropical Weather Outlook](https://www.nhc.noaa.gov/gtwo.php?basin=atlc&fdays=7) | 2-day / 7-day formation chances | `TWOAT.xml` |
| [Open-Meteo](https://open-meteo.com/) | 16-day UK wind and gust forecast | Free, no API key |
| [MeteoAlarm](https://meteoalarm.org/) | Official Met Office weather warnings | Keyless ATOM feed |
| [Environment Agency](https://environment.data.gov.uk/flood-monitoring/doc/reference) | Live flood warnings | England only, keyless |
| Open-Meteo grid scan | Deep Atlantic lows / ex-hurricane tracking | 50-point pressure grid, 7 days |

Honest limitations, shown in-app too:

- Advisories are issued every **6 hours** (03/09/15/21 UTC) with intermediate
  position updates in between, so a storm's position can be up to ~3 hours old.
- The NHC **does not forecast beyond 5 days**. Everything past that — every
  dashed track, and any "closest approach" more than five days out — is this
  app's own extrapolation. Real storms wobble, stall, get absorbed and
  recurve; treat the score as *"how much attention is this worth today"*, not
  a forecast of what will happen.
- Storms that do reach us have almost always stopped being hurricanes on the
  way: they arrive as **ex-hurricane windstorms** — strong wind and heavy rain,
  not a hurricane landfall.
- Formation chances come from the NHC outlook text, which gives no coordinates,
  so developing areas are described rather than mapped.
- **This is not an official warning service.** For UK weather warnings use the
  [Met Office](https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings);
  for tropical cyclone advisories use the
  [NHC](https://www.nhc.noaa.gov/). In an emergency call 999.

## How the UK risk score is built

For each storm, in `src/ukrisk.js`:

1. Take the official NHC forecast track (0–120 h).
2. Extend it forward for up to 84 more hours along the heading and speed of
   its final leg, allowing a little acceleration when the motion is
   north-easterly — the classic recurving path into the mid-latitude jet.
3. Find the closest that combined path comes to any of eleven UK reference
   points, and when.
4. Score: proximity of that closest approach (discounted when it falls on the
   extrapolated part), how closely the storm's heading points at the UK,
   whether it's recurving north-east, its peak forecast intensity, and a
   penalty for tracking west across the tropics. Long lead times get a
   haircut.
5. Band it: Minimal → Low → Watch → Elevated → High.

Every factor that moved the number is shown in the storm's card, so the score
can be argued with rather than just believed.

## Alerts in Expo Go vs a real build

In Expo Go, checks run while the app is open (every 10 minutes, and whenever
you return to it) — and there are no widgets, no notification action buttons
and no time-sensitive delivery. The standalone (EAS/TestFlight) build also
registers a background task (`expo-background-task`) that re-checks the feeds
while the app is closed, sends a local notification and refreshes the widget.
iOS schedules these opportunistically (typically every few hours, requires
Background App Refresh to be on), so keep that on or the widget will drift.

## Install and test via expo.dev (EAS)

Atlantic Storm Watch is its **own app** — new slug (`atlantic-storm-watch`),
new bundle identifier (`com.atlanticstormwatch.app`) — so it installs
alongside anything you had before rather than replacing it.

One-time setup on a computer with Node (creates the new EAS project and
registers the app with Apple):

```bash
git clone https://github.com/rebecca002123/futureCast
cd futureCast && npm install
npx eas-cli login
npx eas-cli init                 # creates @rebecca0021/atlantic-storm-watch, writes the project ID
npx eas-cli update:configure     # writes the OTA updates URL
git add app.json && git commit -m "Link EAS project" && git push
npx eas-cli build -p ios --profile production
```

The build prompts you to sign in with your Apple ID once — it registers the
new bundle IDs, the App Group and the widget's provisioning profile, then
builds a TestFlight-ready app. Afterwards, link the GitHub repo to the new
project on expo.dev (project → GitHub) so the `.eas/workflows` automations
(publish an update + build on every merge to `main`) run again.

For a quick look without building: open the project's **Updates** page on
expo.dev after merging and scan the update's QR code with **Expo Go**.

## Run locally

```bash
npm install
npx expo start        # scan the QR with Expo Go
```

(The map needs a phone — the web preview shows everything except the map.)

## Project layout

- `App.js` — UI (banner, Atlantic map, storm cards, formation watch, wind
  outlook, settings)
- `src/storms.js` — NHC feeds: current storms, forecast advisory parsing,
  tropical weather outlook, geometry helpers
- `src/ukrisk.js` — track extrapolation and the UK risk score
- `src/ukwind.js` — Open-Meteo 16-day UK gust outlook
- `src/watch.js` — one shared refresh + which events deserve an alert
- `src/notify.js` — notification content, categories and interruption levels
- `src/storage.js` — settings, alert history, mutes, last-known snapshot
- `src/background.js` — periodic checks while the app is closed
- `src/widget.js` — the snapshot handed to the widget through the App Group
- `targets/storm-widget/` — the WidgetKit extension (SwiftUI)
- `app.config.js` — injects `APPLE_TEAM_ID` from the environment
- `tools/make-icon.mjs` — regenerates `assets/icon.png`

---

This repository also hosts the privacy/support pages for the FutureCast iOS
app: [PRIVACY.md](PRIVACY.md) · [index.html](index.html) ·
support: rebeccaguntrip2001@gmail.com
