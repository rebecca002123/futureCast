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
- **Alerts** — notifications when a storm's UK risk reaches your chosen level
  (Watch / Elevated / High), when a new named storm forms or an area is likely
  to develop, and when gales appear in the UK forecast.

## Data sources & accuracy

| Source | What | Notes |
| --- | --- | --- |
| [NHC `CurrentStorms.json`](https://www.nhc.noaa.gov/CurrentStorms.json) | Active storm positions, intensity, movement | Keyless public feed |
| NHC Forecast/Advisory (TCM) | Official forecast track to 5 days | One text product per storm, parsed in-app |
| [NHC Tropical Weather Outlook](https://www.nhc.noaa.gov/gtwo.php?basin=atlc&fdays=7) | 2-day / 7-day formation chances | `TWOAT.xml` |
| [Open-Meteo](https://open-meteo.com/) | 16-day UK wind and gust forecast | Free, no API key |

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
you return to it). The standalone (EAS/TestFlight) build also registers a
background task (`expo-background-task`) that re-checks the feeds while the app
is closed and sends a local notification. iOS schedules these opportunistically
(typically every few hours, requires Background App Refresh to be on).

## Install and test via expo.dev (EAS)

This repo is linked to the EAS project `rebecca0021/eclipse-lookout` (same
project as the previous apps — the app is now Atlantic Storm Watch). Merging to
`main` auto-publishes an update via `.eas/workflows/publish-update.yml`.

1. Sign in at [expo.dev](https://expo.dev) and open the project.
2. **Builds → Build from GitHub**, pick this branch (or `main` after merging),
   platform, and the `preview` profile.
3. Because the bundle identifiers are unchanged, the new build installs over
   the previous app.

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
- `src/notify.js` — notification content
- `src/storage.js` — settings, alert history, last-known snapshot
- `src/background.js` — periodic checks while the app is closed
- `tools/make-icon.mjs` — regenerates `assets/icon.png`

---

This repository also hosts the privacy/support pages for the FutureCast iOS
app: [PRIVACY.md](PRIVACY.md) · [index.html](index.html) ·
support: rebeccaguntrip2001@gmail.com
