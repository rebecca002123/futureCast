# Eclipse Lookout

See how the total solar eclipse of **August 12, 2026** will look from your
home — an English rebuild of the Spanish "Mirador Eclipse" web app as a
React Native app built with [Expo](https://expo.dev).

Pick your location (device GPS or a city list) and the app computes, entirely
on-device from the NASA/Espenak Besselian elements for this eclipse:

- whether the eclipse is **total, partial, or not visible** from there
- the **percentage of the Sun covered** and the eclipse magnitude
- the local **timeline**: partial start, totality start/end, maximum, partial end
- the **duration of totality** inside the path
- the Sun's altitude, with warnings when the eclipse happens near sunset
- an interactive **sky simulation** you can scrub through the whole eclipse
- an **AR sky finder**: point your phone at the sky and follow the
  turn-left/right and tilt arrows to the exact spot where the eclipse
  happens, with the eclipsing Sun and Moon rendered live over the camera

No servers, no accounts — nothing leaves your device.

## Run it

```bash
npm install
npx expo start        # scan the QR code with Expo Go
npx expo start --web  # or run it in the browser
```

## Build from your phone with Expo (EAS)

You don't need a computer — Expo's cloud build service (EAS Build) can build
this app straight from GitHub:

1. Sign in at [expo.dev](https://expo.dev) (create a free account if needed).
2. Create a project: **Projects → Create a project**, name it
   `eclipse-lookout`.
3. Open the project → **Settings → GitHub**, connect your GitHub account and
   link the `futureCast` repository.
4. From the project's **Builds** page choose **Build from GitHub**, pick the
   branch, the platform (Android or iOS) and the `preview` profile.
   - **Android** `preview` builds produce an APK you can download and install
     directly on your phone from the build page.
   - **iOS** builds require an Apple Developer account; EAS walks you through
     the credentials and you can submit to TestFlight/App Store with
     **EAS Submit**.
5. Build profiles live in [`eas.json`](eas.json) — `preview` for
   install-on-device testing, `production` for store submissions.

For instant testing without any build, install **Expo Go** on your phone and
run `npx expo start` from the repo on any machine.

## Project layout

- `App.js` — UI (location picker, results, sky simulation)
- `src/eclipse.js` — local-circumstances math from the Besselian elements
- `src/cities.js` — offline preset locations

---

This repository also hosts the privacy/support pages for the FutureCast iOS
app: [PRIVACY.md](PRIVACY.md) · [index.html](index.html) ·
support: rebeccaguntrip2001@gmail.com
