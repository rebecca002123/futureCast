// Will it come towards us?
//
// This is the app's own trajectory model, and it is a *heuristic* — the NHC
// does not forecast beyond 5 days, and nobody forecasts a specific UK impact
// a week out. What it does:
//
//   1. Takes the official NHC forecast track (0–120 h).
//   2. Extends it forward along the heading and speed of its final leg, which
//      is how a recurving storm behaves once it is caught by the mid-latitude
//      jet stream — the classic "ex-hurricane crosses the Atlantic" path.
//   3. Finds the closest that combined path comes to the UK, and when.
//   4. Scores that against how well the storm is aimed at us, whether it is
//      recurving, how strong it is, and how much of the answer rests on the
//      extrapolated part rather than the official forecast.
//
// Everything the score is built from is returned in `reasons` so the app can
// show its working rather than just a number.

import {
  angleBetween,
  bearingDeg,
  compassPoint,
  destinationPoint,
  haversineMiles,
  saffirSimpson,
} from './storms';

// Reference points around the UK — the closest of these is treated as "the
// distance to the UK". Spread around the coast so an approach from any
// direction is measured sensibly.
export const UK_POINTS = [
  { name: 'Cornwall', lat: 50.1, lon: -5.5 },
  { name: 'south coast', lat: 50.8, lon: -1.1 },
  { name: 'London', lat: 51.5, lon: -0.1 },
  { name: 'west Wales', lat: 51.9, lon: -5.2 },
  { name: 'East Anglia', lat: 52.6, lon: 1.3 },
  { name: 'north-west England', lat: 53.8, lon: -3.0 },
  { name: 'Northern Ireland', lat: 54.6, lon: -5.9 },
  { name: 'central Scotland', lat: 55.9, lon: -4.3 },
  { name: 'north-east Scotland', lat: 57.5, lon: -2.0 },
  { name: 'Outer Hebrides', lat: 58.2, lon: -6.4 },
  { name: 'Shetland', lat: 60.2, lon: -1.2 },
];

export const UK_CENTRE = { lat: 54.5, lon: -3.0 };

// How far past the end of the official forecast the path is extended.
const EXTRAPOLATE_HOURS = 84;
const EXTRAPOLATE_STEP_HOURS = 6;

export function distanceToUK(lat, lon) {
  let best = { miles: Infinity, place: null };
  for (const p of UK_POINTS) {
    const miles = haversineMiles(lat, lon, p.lat, p.lon);
    if (miles < best.miles) best = { miles, place: p.name };
  }
  return best;
}

// Continue the track past the official forecast using the speed and heading
// of its last leg. Storms undergoing extratropical transition accelerate as
// they enter the jet, so the speed is allowed to creep up when the motion is
// north-easterly — capped, because this is guesswork, not a model.
export function extrapolateTrack(points, hours = EXTRAPOLATE_HOURS) {
  if (!points || points.length < 2) return [];
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const legHours = (last.time - prev.time) / 3600000;
  if (!(legHours > 0)) return [];

  const legMiles = haversineMiles(prev.lat, prev.lon, last.lat, last.lon);
  let speedMph = legMiles / legHours;
  if (!isFinite(speedMph) || speedMph <= 0) return [];
  speedMph = Math.min(50, Math.max(6, speedMph));

  const heading = bearingDeg(prev.lat, prev.lon, last.lat, last.lon);
  const accelerating = heading >= 15 && heading <= 105; // north-east-ish

  const out = [];
  let cur = { lat: last.lat, lon: last.lon };
  let t = last.time.getTime();
  let speed = speedMph;
  for (let h = EXTRAPOLATE_STEP_HOURS; h <= hours; h += EXTRAPOLATE_STEP_HOURS) {
    if (accelerating) speed = Math.min(50, speed * 1.02);
    cur = destinationPoint(cur.lat, cur.lon, heading, speed * EXTRAPOLATE_STEP_HOURS);
    t += EXTRAPOLATE_STEP_HOURS * 3600000;
    if (cur.lat > 72 || cur.lat < 5 || cur.lon > 25 || cur.lon < -100) break;
    out.push({
      lat: cur.lat,
      lon: cur.lon,
      time: new Date(t),
      windKt: NaN,
      hour: (last.hour || 0) + h,
      extrapolated: true,
    });
  }
  return out;
}

function closestApproach(path) {
  let best = null;
  for (const p of path) {
    const d = distanceToUK(p.lat, p.lon);
    if (!best || d.miles < best.miles) best = { ...d, point: p };
  }
  return best;
}

export const RISK_BANDS = [
  { min: 80, band: 'High', color: '#dc2626', blurb: 'Track points at the UK' },
  { min: 60, band: 'Elevated', color: '#ea580c', blurb: 'Could reach the UK — worth watching daily' },
  { min: 38, band: 'Watch', color: '#d4a72c', blurb: 'Recurving our way, but a long way off' },
  { min: 18, band: 'Low', color: '#3d8fd1', blurb: 'Unlikely to affect the UK' },
  { min: 0, band: 'Minimal', color: '#4b8f6f', blurb: 'No UK threat' },
];

export function bandFor(score) {
  return RISK_BANDS.find((b) => score >= b.min) || RISK_BANDS[RISK_BANDS.length - 1];
}

// Rank a band so alert thresholds can be compared.
export const BAND_ORDER = ['Minimal', 'Low', 'Watch', 'Elevated', 'High'];

export function bandRank(band) {
  const i = BAND_ORDER.indexOf(band);
  return i < 0 ? 0 : i;
}

// The main assessment. `track` is the parsed forecast advisory (may be null,
// in which case the storm's current position and movement vector are used).
export function assessUKRisk(storm, track, now = new Date()) {
  const official = track?.points?.length
    ? track.points
    : syntheticTrack(storm, now);
  const projected = extrapolateTrack(official);
  const path = [...official, ...projected];

  const reasons = [];
  const currentDistance = distanceToUK(storm.lat, storm.lon);

  if (path.length < 2) {
    return {
      score: 0,
      ...bandFor(0),
      path,
      official,
      projected,
      closest: { miles: currentDistance.miles, place: currentDistance.place, point: null },
      currentDistanceMiles: currentDistance.miles,
      reasons: ['No forecast track available for this system yet.'],
      confidence: 'low',
    };
  }

  const last = official[official.length - 1];
  const first = official[0];
  const closest = closestApproach(path);
  const headingEnd = bearingDeg(
    official[Math.max(0, official.length - 2)].lat,
    official[Math.max(0, official.length - 2)].lon,
    last.lat,
    last.lon
  );
  const bearingToUK = bearingDeg(last.lat, last.lon, UK_CENTRE.lat, UK_CENTRE.lon);
  const aimOff = angleBetween(headingEnd, bearingToUK);
  const peakKt = Math.max(
    isFinite(storm.windKt) ? storm.windKt : 0,
    track?.maxWindKt || 0
  );

  let score = 0;

  // 1. Closest approach of the whole path (official + extrapolated).
  const m = closest.miles;
  let proximity = 0;
  if (m <= 250) proximity = 46;
  else if (m <= 500) proximity = 40;
  else if (m <= 800) proximity = 31;
  else if (m <= 1200) proximity = 21;
  else if (m <= 1800) proximity = 11;
  else if (m <= 2500) proximity = 4;
  // A close pass that only happens on the guessed part of the path counts
  // for less than one the NHC actually forecasts.
  if (closest.point?.extrapolated) proximity *= 0.72;
  score += proximity;
  if (m <= 1200) {
    reasons.push(
      `Path passes about ${Math.round(m)} miles from ${closest.place}` +
        (closest.point?.extrapolated ? ' (on the extrapolated part of the track)' : ' on the official NHC forecast')
    );
  } else {
    reasons.push(`Closest the track gets to the UK is about ${Math.round(m)} miles`);
  }

  // 2. Is the end of the official forecast pointed at us?
  if (aimOff <= 25) {
    score += 20;
    reasons.push(`Moving ${compassPoint(headingEnd)} — almost straight at the UK`);
  } else if (aimOff <= 50) {
    score += 13;
    reasons.push(`Moving ${compassPoint(headingEnd)}, broadly towards north-west Europe`);
  } else if (aimOff <= 80) {
    score += 6;
    reasons.push(`Moving ${compassPoint(headingEnd)}, off to one side of the UK`);
  } else {
    reasons.push(`Moving ${compassPoint(headingEnd)}, away from the UK`);
  }

  // 3. Recurvature — turning north then east is the route to Europe.
  const turnedNorth = last.lat - first.lat;
  const turnedEast = last.lon - first.lon;
  if (turnedNorth >= 3 && turnedEast >= 2) {
    score += 15;
    reasons.push('Forecast to recurve north-east into the mid-latitude flow');
  } else if (turnedEast <= -4) {
    score -= 8;
    reasons.push('Tracking west across the Atlantic, towards the Caribbean/US rather than Europe');
  } else if (turnedNorth >= 3) {
    score += 7;
    reasons.push('Forecast to turn north — a recurve towards the Atlantic is possible');
  }

  // 4. Strength: a stronger storm carries more energy into transition, and
  //    ex-hurricanes that reach us are usually the big ones.
  const cat = saffirSimpson(peakKt);
  if (peakKt >= 96) score += 10;
  else if (peakKt >= 64) score += 7;
  else if (peakKt >= 50) score += 4;
  else if (peakKt >= 34) score += 2;
  if (cat) reasons.push(`Peaks at category ${cat} strength (${Math.round(peakKt)} kt) in the forecast`);

  // 5. Deep tropics and heading west = someone else's problem for now.
  if (last.lat < 22 && headingEnd > 200 && headingEnd < 340) {
    score = Math.min(score, 22);
    reasons.push('Still deep in the tropics heading west — no realistic UK track in this forecast');
  }

  // 6. Long lead times deserve a haircut.
  const leadHours = closest.point ? (closest.point.time - now) / 3600000 : 0;
  if (leadHours > 168) {
    score *= 0.78;
    reasons.push('Closest approach is more than 7 days out, so confidence is low');
  } else if (leadHours > 120) {
    score *= 0.88;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const confidence = !track
    ? 'low'
    : closest.point?.extrapolated
    ? leadHours > 168
      ? 'low'
      : 'medium'
    : 'high';

  return {
    score,
    ...bandFor(score),
    path,
    official,
    projected,
    closest,
    currentDistanceMiles: currentDistance.miles,
    headingEnd,
    aimOff,
    peakKt,
    leadHours,
    reasons,
    confidence,
  };
}

// If the forecast advisory can't be fetched, fall back to the storm's current
// position and reported motion so there is still something to reason about.
function syntheticTrack(storm, now) {
  if (!isFinite(storm.lat) || !isFinite(storm.lon)) return [];
  const points = [
    { lat: storm.lat, lon: storm.lon, time: storm.lastUpdate || now, windKt: storm.windKt, hour: 0, extrapolated: false },
  ];
  if (storm.movementDir == null || !storm.movementSpeedKt) return points;
  const speedMph = storm.movementSpeedKt * 1.15078;
  let cur = { lat: storm.lat, lon: storm.lon };
  for (let h = 12; h <= 48; h += 12) {
    cur = destinationPoint(cur.lat, cur.lon, storm.movementDir, speedMph * 12);
    points.push({
      lat: cur.lat,
      lon: cur.lon,
      time: new Date((points[0].time?.getTime?.() || now.getTime()) + h * 3600000),
      windKt: NaN,
      hour: h,
      extrapolated: true,
    });
  }
  return points;
}

// Formation-stage systems (the Tropical Weather Outlook areas) get a much
// cruder read: how likely they are to become a cyclone at all, and whether
// they are in a part of the Atlantic that sends systems our way.
export function outlookWatchLevel(area) {
  const chance = Math.max(area.chance7 ?? 0, area.chance48 ?? 0);
  if (chance >= 70) return { label: 'High chance of forming', color: '#dc2626' };
  if (chance >= 40) return { label: 'Medium chance of forming', color: '#ea580c' };
  if (chance >= 20) return { label: 'Low chance of forming', color: '#d4a72c' };
  return { label: 'Very low chance', color: '#4b8f6f' };
}
