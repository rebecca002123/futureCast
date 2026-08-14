# UK Wildfire Watch 🔥🛰

Live map and proximity alerts for wildfires in the UK (and Ireland), built
with [Expo](https://expo.dev) / React Native and real satellite data.

## What it does

- **Live fire detections** — pulls NASA FIRMS active-fire data from four
  satellite sensors (VIIRS on Suomi-NPP, NOAA-20 and NOAA-21 at 375 m
  resolution, plus MODIS at 1 km), filters to the UK/Ireland, and clusters
  detections into fire incidents.
- **Map + list** — every incident on a map (colour-coded by how recent the
  detection is) and in a list with place names, distance from you, number of
  detections, confidence and fire intensity (FRP in megawatts).
- **Nearby warnings** — with location enabled, the app warns you (banner,
  pop-up and notification) when a fire is detected inside your chosen alert
  radius (5/15/30/60 miles). Notification permission is requested at startup;
  each incident only alerts once per day.
- **Fire weather** — live conditions at your location from Open-Meteo
  (temperature, humidity, wind, days since rain) rolled into an indicative
  fire-conditions rating.
- **Fresh data** — refreshes automatically every 5 minutes while open, every
  time the app returns to the foreground, and on pull-to-refresh. Distances
  are shown in miles.

## Data sources & accuracy

| Source | What | Notes |
| --- | --- | --- |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) | Active fire detections (keyless Europe 24 h CSV feeds) | VIIRS 375 m + MODIS 1 km; new data as satellites pass (~every 1–3 h) plus ~1–3 h processing latency |
| [Open-Meteo](https://open-meteo.com/) | Current weather + 7-day rainfall | Free, no API key |

Honest limitations, shown in-app too:

- Satellites can **miss small, brief or smouldering fires**, and cloud cover
  can hide detections; hot industrial sites occasionally show as false
  positives (confidence is displayed per incident).
- A detection means the satellite saw a hot spot in the last 24 h — the fire
  may already be out.
- **This is not an official warning service.** If you see fire or smoke,
  call **999**.

## Alerts in Expo Go vs a real build

In Expo Go, proximity checks run while the app is open (foreground). For
true background alerts, make a standalone build via EAS (below) — the app is
already set up with notification channels and location permissions.

## Install and test via expo.dev (EAS)

This repo is linked to the EAS project `rebecca0021/eclipse-lookout` (same
project as the previous apps — the app is now UK Wildfire Watch). Merging to
`main` auto-publishes an update via `.eas/workflows/publish-update.yml`.

1. Sign in at [expo.dev](https://expo.dev) and open the project.
2. **Builds → Build from GitHub**, pick this branch (or `main` after
   merging), platform, and the `preview` profile (Android gives an APK you
   can install straight from the build page).
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

- `App.js` — UI (banner, map, fire list, weather, settings)
- `src/fires.js` — FIRMS feeds: fetch, parse, UK filter, clustering, distance
- `src/weather.js` — Open-Meteo fire-weather fetch + indicative rating
- `src/notify.js` — proximity notifications
- `src/storage.js` — settings + already-alerted persistence

---

This repository also hosts the privacy/support pages for the FutureCast iOS
app: [PRIVACY.md](PRIVACY.md) · [index.html](index.html) ·
support: rebeccaguntrip2001@gmail.com
