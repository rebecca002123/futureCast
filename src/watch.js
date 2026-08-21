// One refresh, shared by the app and by the background check: pull the NHC
// storm list, each storm's official forecast track, the tropical weather
// outlook and the UK wind outlook, then work out what (if anything) is worth
// telling the user about.

import { fetchActiveStorms, fetchForecastTrack, fetchOutlook } from './storms';
import { assessUKRisk, bandRank, closestToPlace } from './ukrisk';
import { fetchPlaceWindOutlook, fetchUKWindOutlook, WINDSTORM_GUST_MPH } from './ukwind';
import { fetchUKWarnings } from './ukwarnings';
import { fetchFloods } from './floods';
import { fetchAtlanticLows, lowThreatLabel, matchExStorm } from './lows';

// Pull everything, tolerating individual failures — a missing outlook
// shouldn't hide the storms, and vice versa. `place` ({name, lat, lon} or
// null) adds the my-location wind outlook.
export async function fetchStormPicture(timeoutMs = 20000, place = null) {
  const errors = [];

  const [stormsRes, outlookRes, windRes, warningsRes, floodsRes, placeWindRes, lowsRes] =
    await Promise.allSettled([
      fetchActiveStorms(timeoutMs),
      fetchOutlook(timeoutMs),
      fetchUKWindOutlook(timeoutMs),
      fetchUKWarnings(timeoutMs),
      fetchFloods(timeoutMs),
      place ? fetchPlaceWindOutlook(place.lat, place.lon, timeoutMs) : Promise.resolve(null),
      fetchAtlanticLows(timeoutMs),
    ]);

  const storms = stormsRes.status === 'fulfilled' ? stormsRes.value : [];
  if (stormsRes.status !== 'fulfilled') errors.push(`Storm list: ${errString(stormsRes.reason)}`);

  const outlook = outlookRes.status === 'fulfilled' ? outlookRes.value : { areas: [], issuedAt: null, body: '' };
  if (outlookRes.status !== 'fulfilled') errors.push(`Formation outlook: ${errString(outlookRes.reason)}`);

  const wind = windRes.status === 'fulfilled' ? windRes.value : null;
  if (windRes.status !== 'fulfilled') errors.push(`UK wind outlook: ${errString(windRes.reason)}`);

  const warnings = warningsRes.status === 'fulfilled' ? warningsRes.value : null;
  if (warningsRes.status !== 'fulfilled') errors.push(`UK warnings: ${errString(warningsRes.reason)}`);

  const floods = floodsRes.status === 'fulfilled' ? floodsRes.value : null;
  if (floodsRes.status !== 'fulfilled') errors.push(`Flood warnings: ${errString(floodsRes.reason)}`);

  const placeWind = placeWindRes.status === 'fulfilled' ? placeWindRes.value : null;
  if (place && placeWindRes.status !== 'fulfilled')
    errors.push(`${place.name} wind outlook: ${errString(placeWindRes.reason)}`);

  const lowsRaw = lowsRes.status === 'fulfilled' ? lowsRes.value : null;
  if (lowsRes.status !== 'fulfilled') errors.push(`Atlantic lows: ${errString(lowsRes.reason)}`);

  // Forecast tracks, one advisory per storm, fetched together.
  const trackResults = await Promise.allSettled(
    storms.map((s) => fetchForecastTrack(s, timeoutMs))
  );

  const now = new Date();
  const assessed = storms.map((storm, i) => {
    const track = trackResults[i].status === 'fulfilled' ? trackResults[i].value : null;
    if (trackResults[i].status !== 'fulfilled') {
      errors.push(`${storm.name} forecast track: ${errString(trackResults[i].reason)}`);
    }
    return { storm, track, risk: assessUKRisk(storm, track, now) };
  });

  assessed.sort((a, b) => b.risk.score - a.risk.score || b.storm.windKt - a.storm.windKt);

  // Model-detected Atlantic lows, tagged with the storm they used to be
  // (when they line up with an official track) and a UK threat band.
  const lows = lowsRaw
    ? {
        ...lowsRaw,
        lows: lowsRaw.lows.map((low) => ({
          ...low,
          exName: matchExStorm(low, assessed),
          threat: lowThreatLabel(low),
        })),
      }
    : null;

  // My-location closest approach for each storm.
  const local = place
    ? {
        place,
        wind: placeWind,
        storms: assessed
          .map(({ storm, risk }) => ({ storm, risk, closest: closestToPlace(risk, place) }))
          .filter((x) => x.closest)
          .sort((a, b) => a.closest.miles - b.closest.miles),
      }
    : null;

  return {
    assessed,
    outlook,
    wind,
    warnings,
    floods,
    lows,
    local,
    errors,
    stormsOk: stormsRes.status === 'fulfilled',
    fetchedAt: now,
  };
}

function errString(e) {
  return String(e?.message || e || 'failed');
}

// Depressions are numbered ("Six", "Fourteen") until they earn a name.
const NUMBER_NAMES =
  /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty-?\w+|thirty|thirty-?\w+)$/i;

function isNamed(storm) {
  return !!storm.name && !NUMBER_NAMES.test(storm.name.trim());
}

// What deserves a notification. Returns the events plus the updated
// already-alerted map, so callers can persist it.
//
// Two things can hold an alert back without burning it: a storm the user has
// muted, and quiet hours. Neither stamps the alert as sent, so a suppressed
// alert is re-offered on the next refresh (after 07:00, or once the mute
// expires) rather than being lost.
export function evaluateAlerts(picture, settings, alerted, muted = {}, now = new Date()) {
  const events = [];
  const next = { ...alerted };
  const threshold = bandRank(settings.alertBand || 'Watch');
  const candidates = [];

  for (const { storm, risk } of picture.assessed) {
    if (muted[storm.id] > now.getTime()) continue;

    // First time we've seen this storm with a name (numbered depressions get
    // their alert later, when the NHC names them).
    if (settings.formationAlerts && isNamed(storm) && storm.windKt >= 34) {
      candidates.push({
        key: `new:${storm.id}`,
        urgent: false,
        event: { type: 'new-storm', storm, risk },
      });
    }
    // Risk band crossing — one alert per storm per band, so an upgrade from
    // Watch to Elevated still gets through.
    if (bandRank(risk.band) >= threshold && bandRank(risk.band) > 0) {
      candidates.push({
        key: `risk:${storm.id}:${risk.band}`,
        urgent: risk.band === 'High' || risk.band === 'Elevated',
        event: { type: 'risk', storm, risk },
      });
    }
  }

  if (settings.formationAlerts) {
    for (const area of picture.outlook?.areas || []) {
      const chance = Math.max(area.chance7 ?? 0, area.chance48 ?? 0);
      if (chance >= 60) {
        candidates.push({
          key: `form:${area.id}:${Math.floor(chance / 10) * 10}`,
          urgent: false,
          event: { type: 'formation', area },
        });
      }
    }
  }

  if (settings.warningAlerts !== false) {
    for (const warning of picture.warnings?.warnings || []) {
      if (warning.rank >= 2) {
        candidates.push({
          key: `warn:${warning.id}`,
          urgent: true, // amber and red are worth breaking through for
          event: { type: 'warning', warning, stormName: picture.warnings?.stormName || null },
        });
      }
    }
  }

  if (settings.floodAlerts !== false) {
    for (const flood of picture.floods?.floods || []) {
      if (flood.severityLevel <= 2) {
        candidates.push({
          key: `flood:${flood.id}:${flood.severityLevel}`,
          urgent: flood.severityLevel === 1,
          event: { type: 'flood', flood },
        });
      }
    }
  }

  if (settings.windAlerts !== false) {
    for (const low of picture.lows?.lows || []) {
      if (low.closest.miles <= 300 && low.maxGust >= WINDSTORM_GUST_MPH) {
        candidates.push({
          key: `low:${low.closest.place}:${low.closest.point.time.toISOString().slice(0, 10)}`,
          urgent: low.maxGust >= 70,
          event: { type: 'low', low },
        });
      }
    }
  }

  if (settings.windAlerts && picture.wind) {
    for (const day of picture.wind.stormyDays || []) {
      if (day.gustMph >= WINDSTORM_GUST_MPH) {
        candidates.push({
          key: `wind:${day.dateISO}:${Math.floor(day.gustMph / 10) * 10}`,
          urgent: day.gustMph >= 70,
          event: { type: 'wind', day },
        });
      }
    }
  }

  const quiet = inQuietHours(now, settings);
  for (const candidate of candidates) {
    if (next[candidate.key]) continue;
    if (quiet && !candidate.urgent) continue; // hold it, don't burn it
    next[candidate.key] = now.getTime();
    events.push(candidate.event);
  }

  return { events, alerted: next };
}

// 23:00–07:00 local. Urgent alerts ignore this.
export function inQuietHours(now = new Date(), settings = {}) {
  if (!settings.quietHours) return false;
  const hour = now.getHours();
  return hour >= 23 || hour < 7;
}

// Headline for the top banner: the single most important thing right now.
export function summarise(picture) {
  const assessed = picture?.assessed || [];
  const top = assessed[0];
  const hurricanes = assessed.filter((a) => a.storm.windKt >= 64).length;
  const forming = (picture?.outlook?.areas || []).filter(
    (a) => Math.max(a.chance7 ?? 0, a.chance48 ?? 0) >= 40
  ).length;
  const stormyDay = picture?.wind?.stormyDays?.[0] || null;

  const topWarning = picture?.warnings?.top || null;
  const topLow = (picture?.lows?.lows || [])[0] || null;
  const floodCounts = picture?.floods?.counts || null;

  return {
    top,
    hurricanes,
    forming,
    stormyDay,
    count: assessed.length,
    topWarning,
    topLow,
    stormName: picture?.warnings?.stormName || null,
    floodCounts,
  };
}
