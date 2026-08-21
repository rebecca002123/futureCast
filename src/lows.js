// Model-based North Atlantic low tracker.
//
// The NHC only tracks *tropical* systems, and it drops a hurricane the
// moment it goes post-tropical — often exactly when an ex-hurricane starts
// running at the UK. This module closes that gap: it samples a coarse grid
// of sea-level pressure and gusts across the North Atlantic from Open-Meteo
// (GFS/ECMWF blend, keyless), finds every deep low in the 7-day forecast,
// follows each one through time, and measures how close it comes to the UK.
//
// It sees anything the weather models see — ex-hurricanes after the NHC
// stops advising, and ordinary autumn windstorms that were never tropical.
// The grid is deliberately coarse (~5–6°): plenty to spot and follow a
// synoptic-scale low, nowhere near an official track. It's labelled as a
// model estimate everywhere it appears.

import { bearingDeg, compassPoint, haversineMiles } from './storms';
import { distanceToUK } from './ukrisk';

export const GRID_LATS = [36, 43, 50, 57, 64];
export const GRID_LONS = [-48, -42, -36, -30, -24, -18, -12, -6, 0, 6];

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const STEP_HOURS = 6;

// A grid point must be at least this deep, and lower than every neighbour,
// to count as a low centre.
const MAX_CENTER_HPA = 1004;
// Keep a track only if it persists (3+ fixes = 12h+) or is seriously deep.
const MIN_TRACK_POINTS = 3;
const DEEP_HPA = 988;

export async function fetchAtlanticLows(timeoutMs = 25000) {
  const lats = [];
  const lons = [];
  for (const lat of GRID_LATS) {
    for (const lon of GRID_LONS) {
      lats.push(lat);
      lons.push(lon);
    }
  }
  const url =
    `${OPEN_METEO}?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
    '&hourly=pressure_msl,wind_gusts_10m&wind_speed_unit=mph' +
    '&timezone=UTC&forecast_days=7';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let json;
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }
  return detectLows(Array.isArray(json) ? json : [json]);
}

// locations[i] corresponds to GRID_LATS[floor(i/nLon)], GRID_LONS[i%nLon].
export function detectLows(locations, now = new Date()) {
  const nLon = GRID_LONS.length;
  const nLat = GRID_LATS.length;
  const times = locations[0]?.hourly?.time || [];
  if (!times.length || locations.length < nLat * nLon) {
    return { lows: [], fetchedAt: now, gridOk: false };
  }

  const pressureAt = (row, col, t) => locations[row * nLon + col]?.hourly?.pressure_msl?.[t];
  const gustAt = (row, col, t) => locations[row * nLon + col]?.hourly?.wind_gusts_10m?.[t];

  // Low centres per 6-hourly timestep: grid minima below the threshold.
  const fixesByStep = [];
  for (let t = 0; t < times.length; t += STEP_HOURS) {
    const time = new Date(`${times[t]}${times[t].includes('Z') || times[t].includes('+') ? '' : ':00Z'}`);
    const fixes = [];
    for (let r = 0; r < nLat; r++) {
      for (let c = 0; c < nLon; c++) {
        const p = pressureAt(r, c, t);
        if (!isFinite(p) || p > MAX_CENTER_HPA) continue;
        let isMin = true;
        for (let dr = -1; dr <= 1 && isMin; dr++) {
          for (let dc = -1; dc <= 1 && isMin; dc++) {
            if (!dr && !dc) continue;
            const q = pressureAt(r + dr, c + dc, t);
            if (isFinite(q) && q < p) isMin = false;
          }
        }
        if (!isMin) continue;
        // Strongest gusts anywhere in the 3x3 around the centre — a low's
        // worst winds sit off-centre.
        let gust = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const g = gustAt(r + dr, c + dc, t);
            if (isFinite(g)) gust = Math.max(gust, g);
          }
        }
        fixes.push({ lat: GRID_LATS[r], lon: GRID_LONS[c], time, pressure: p, gustMph: gust });
      }
    }
    // A low sitting between cells can register two neighbouring minima —
    // keep only the deeper of any pair that's clearly the same system.
    fixes.sort((a, b) => a.pressure - b.pressure);
    const kept = [];
    for (const fix of fixes) {
      if (kept.every((k) => haversineMiles(k.lat, k.lon, fix.lat, fix.lon) > 600)) kept.push(fix);
    }
    fixesByStep.push(kept);
  }

  // Link fixes into tracks: nearest surviving track within a plausible
  // 6-hour travel distance (~700 miles) continues; anything else starts new.
  const tracks = [];
  for (const fixes of fixesByStep) {
    const claimed = new Set();
    for (const fix of fixes) {
      let best = null;
      let bestDist = 700;
      for (const track of tracks) {
        if (claimed.has(track)) continue;
        const last = track.points[track.points.length - 1];
        const gap = (fix.time - last.time) / 3600000;
        // Allow one missed step — a fast or boundary-crossing low can drop
        // out of the coarse grid for a single fix.
        if (gap > STEP_HOURS * 2 + 1) continue;
        const d = haversineMiles(last.lat, last.lon, fix.lat, fix.lon);
        if (d < bestDist) {
          best = track;
          bestDist = d;
        }
      }
      if (best) {
        best.points.push(fix);
        claimed.add(best);
      } else {
        tracks.push({ points: [fix] });
      }
    }
  }

  // Stitch fragments: a track that starts where and when another ended is
  // the same low that briefly fell below detection.
  tracks.sort((a, b) => a.points[0].time - b.points[0].time);
  for (let i = 0; i < tracks.length; i++) {
    const a = tracks[i];
    if (!a) continue;
    for (let j = i + 1; j < tracks.length; j++) {
      const b = tracks[j];
      if (!b) continue;
      const aEnd = a.points[a.points.length - 1];
      const bStart = b.points[0];
      const gap = (bStart.time - aEnd.time) / 3600000;
      if (gap >= 0 && gap <= STEP_HOURS * 3 + 1 &&
          haversineMiles(aEnd.lat, aEnd.lon, bStart.lat, bStart.lon) <= 900) {
        a.points.push(...b.points);
        tracks[j] = null;
        j = i; // rescan with the extended track
      }
    }
  }

  const lows = tracks
    .filter(Boolean)
    .filter(
      (tr) =>
        tr.points.length >= MIN_TRACK_POINTS ||
        tr.points.some((p) => p.pressure <= DEEP_HPA)
    )
    .map((tr, i) => summariseTrack(tr, i, now))
    .filter(Boolean)
    .sort((a, b) => a.closest.miles - b.closest.miles);

  return { lows, fetchedAt: now, gridOk: true };
}

function summariseTrack(track, index, now) {
  const points = track.points;
  const first = points[0];
  const last = points[points.length - 1];
  const minPressure = Math.min(...points.map((p) => p.pressure));
  const maxGust = Math.max(...points.map((p) => p.gustMph));

  // Closest approach of the whole modelled path to the UK.
  let closest = null;
  for (const p of points) {
    const d = distanceToUK(p.lat, p.lon);
    if (!closest || d.miles < closest.miles) closest = { ...d, point: p };
  }

  // Where is it "now" (the fix nearest the current time) and where is it going?
  let current = first;
  for (const p of points) {
    if (Math.abs(p.time - now) < Math.abs(current.time - now)) current = p;
  }
  // Movement: measure to the first later fix that has actually moved cells,
  // so a slow low doesn't read as stationary noise.
  const idx = points.indexOf(current);
  let next = null;
  for (let i = idx + 1; i < points.length; i++) {
    if (haversineMiles(current.lat, current.lon, points[i].lat, points[i].lon) > 30) {
      next = points[i];
      break;
    }
  }
  const heading = next ? bearingDeg(current.lat, current.lon, next.lat, next.lon) : null;
  const speedMph = next
    ? haversineMiles(current.lat, current.lon, next.lat, next.lon) /
      Math.max(1, (next.time - current.time) / 3600000)
    : null;

  return {
    id: `low-${index}-${first.time.toISOString().slice(0, 13)}`,
    points,
    current,
    minPressure: Math.round(minPressure),
    maxGust: Math.round(maxGust),
    heading,
    headingLabel: heading != null ? compassPoint(heading) : null,
    speedMph: speedMph != null ? Math.round(speedMph) : null,
    closest,
    startsInFuture: first.time.getTime() > now.getTime() + 12 * 3600000,
    endsBy: last.time,
  };
}

// If a low starts near where a known storm's official track ends (or near
// the storm itself), it's very likely that storm's remains.
export function matchExStorm(low, assessed) {
  for (const { storm, risk } of assessed || []) {
    const path = risk?.official?.length ? risk.official : null;
    const anchor = path ? path[path.length - 1] : { lat: storm.lat, lon: storm.lon };
    const d = haversineMiles(low.points[0].lat, low.points[0].lon, anchor.lat, anchor.lon);
    if (d <= 600) return storm.name;
  }
  return null;
}

// Bands for how seriously to take a modelled low, UK-wise.
export function lowThreatLabel(low) {
  const nearUK = low.closest.miles <= 300;
  const midRange = low.closest.miles <= 700;
  if (nearUK && low.maxGust >= 70) return { label: 'UK impact likely', color: '#dc2626' };
  if (nearUK && low.maxGust >= 55) return { label: 'UK gales possible', color: '#ea580c' };
  if (midRange && low.maxGust >= 55) return { label: 'Worth watching', color: '#d4a72c' };
  return { label: 'No UK impact expected', color: '#4b8f6f' };
}
