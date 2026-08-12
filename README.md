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

No servers, no accounts — nothing leaves your device.

## Run it

```bash
npm install
npx expo start        # scan the QR code with Expo Go
npx expo start --web  # or run it in the browser
```

## Project layout

- `App.js` — UI (location picker, results, sky simulation)
- `src/eclipse.js` — local-circumstances math from the Besselian elements
- `src/cities.js` — offline preset locations

---

This repository also hosts the privacy/support pages for the FutureCast iOS
app: [PRIVACY.md](PRIVACY.md) · [index.html](index.html) ·
support: rebeccaguntrip2001@gmail.com
