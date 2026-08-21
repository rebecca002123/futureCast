# Shift Pay 💷🕘

Log the shifts you work, and know what you're owed before the payslip turns
up. Built with [Expo](https://expo.dev) / React Native, works entirely
offline, and shows its working for every penny.

## What it does

- **Add a shift in about five seconds** — date, start, finish, unpaid break.
  Times are typed the way people say them (`7`, `19:30`, `7.30pm`, `0930`) or
  nudged in quarter hours with the arrows, and a shift that finishes after
  midnight is understood as a night shift rather than a negative one.
- **Pay worked out to the minute**, not the nearest hour: the paid time is
  the shift minus the unpaid break, and every minute is priced at the rate
  that actually applies to it.
- **Night and weekend premiums** — an extra amount per hour or a multiple of
  your rate, applied only to the hours inside the window. A 20:00–06:30 shift
  is split exactly where the night rate starts and stops. Premiums don't
  stack: if an hour is both night and weekend, the better-paid one applies.
- **Overtime**, daily (past *n* hours in one shift) and weekly (past *n*
  hours in the week, counted across every job), at whatever multiple your
  employer uses. Overtime multiplies whatever the hour was already worth, so
  a night hour in overtime pays the night rate × 1.5.
- **More than one job**, each with its own rate and colour, plus a one-off
  rate override for the odd cover shift paid differently.
- **Your pay period, not the calendar's** — weekly or fortnightly from
  whichever weekday your week starts on, or monthly from any day of the month
  (payrolls that run the 21st to the 20th are normal, and supported).
- **A take-home estimate** — income tax, National Insurance, a workplace
  pension and a student loan, using 2025/26 rates for the rest of the UK or
  for Scotland.
- **Holiday building up** at 12.07% of the hours you work — the standard
  accrual for hourly work — valued at what those hours actually paid.
- **Every figure explained.** Tap a shift and it shows the bands it was split
  into, the hours in each, the rate each was paid at and where that rate came
  from. Nothing is a black box you have to trust.
- **Share it** — a plain-text summary of the period, or a CSV of every shift,
  straight out of the share sheet.
- **Tax year to date** — gross, hours and overtime since 6 April.

## What it deliberately doesn't do

It has no accounts, no servers and no network access at all: your shifts live
in the app's own storage on your phone and nowhere else. Nothing is uploaded,
because there's nowhere to upload it to.

It also isn't payroll. Your employer's rounding rules, salary sacrifice, an
unusual tax code, a mid-period pay rise or a cumulative PAYE calculation
across the whole tax year will all move the real number. The take-home figure
is worked out on one pay period in isolation, which is what a "week 1 /
month 1" payslip does — over a year of uneven weeks it will drift. Use the
app to check a payslip and to spot when one is wrong, not to replace one.

## How the pay is worked out

In `src/pay.js`, for each shift:

1. Turn the two wall-clock times into a span of minutes, adding a day if the
   finish is earlier than the start.
2. Walk that span a minute at a time and label each minute with the premium
   that applies to it (basic, night, weekend — the best-paid one wins),
   collecting the result into runs of equal-rate minutes.
3. Take the unpaid break off, in proportion to how much of the shift each
   band covers: a 30-minute break on a half-night shift takes 15 minutes off
   each side.
4. Split the runs again wherever an overtime threshold falls — daily
   thresholds count from the start of the shift, weekly ones from the start
   of the overtime week across every shift and every job — and multiply those
   minutes.
5. Add up the resulting bands. That's the shift, and the bands are exactly
   what the app shows you.

`npm test` runs the whole engine against a set of worked examples (night
shifts across midnight, breaks split across bands, daily and weekly overtime,
premiums that must not stack, holiday accrual) with no simulator involved.

## Run it

```bash
npm install
npx expo start        # scan the QR code with Expo Go
npm run web           # or just open it in a browser
```

- `npm test` — the pay engine's worked examples.
- `npm run icon` — regenerates `assets/icon.png` from `tools/make-icon.mjs`.

## Install it on a phone via expo.dev (EAS)

Shift Pay is its own app — slug `shift-pay`, bundle identifier
`com.shiftpay.app` — so it installs alongside anything already on the phone
rather than replacing it. One-time setup on a computer with Node:

```bash
npx eas-cli login
npx eas-cli init                 # creates @rebecca0021/shift-pay, writes the project ID
npx eas-cli update:configure     # writes the over-the-air updates URL
git add app.json && git commit -m "Link EAS project" && git push
npx eas-cli build -p ios --profile production
```

The build asks for your Apple ID once, registers the bundle identifier and
produces a TestFlight-ready app. Afterwards, link this repo to the new
project on expo.dev (project → GitHub) so the `.eas/workflows` automations —
publish an update and build iOS on every merge to `main` — run again.

## Project layout

- `App.js` — the three screens (Shifts, Pay, Settings) and the shift editor
- `src/pay.js` — the pay engine: premiums, breaks, overtime, holiday accrual
- `src/tax.js` — the take-home estimate: PAYE bands, NI, pension, student loans
- `src/periods.js` — weekly / fortnightly / monthly pay period boundaries
- `src/time.js` — dates, wall-clock times and the forgiving time parser
- `src/format.js` — money and hours, formatted the way a payslip reads
- `src/settings.js` — the settings shape and a new install's defaults
- `src/storage.js` — reading and writing both of those on the device
- `src/summary.js` — the shareable text summary and CSV export
- `src/ui.js` — the shared buttons, chips, switches and number fields
- `tools/pay.test.mjs` — the engine's worked examples (`npm test`)
- `tools/make-icon.mjs` — draws the app icon, no image dependencies

## Rates used by the take-home estimate

| | Threshold | Rate |
| --- | --- | --- |
| Personal allowance | £12,570 (tapered above £100,000) | 0% |
| Basic rate | to £50,270 | 20% |
| Higher rate | to £125,140 | 40% |
| Additional rate | above £125,140 | 45% |
| National Insurance | £12,570 – £50,270 | 8% |
| National Insurance | above £50,270 | 2% |
| Student loan | Plan 1 £26,065 · Plan 2 £28,470 · Plan 4 £32,745 · Plan 5 £25,000 | 9% |
| Postgraduate loan | £21,000 | 6% |

Scottish rates (19/20/21/42/45/48%) are used instead when Scotland is
selected. These are the 2025/26 figures; the income tax thresholds are
frozen, but check them against
[gov.uk](https://www.gov.uk/income-tax-rates) if a payslip disagrees.
