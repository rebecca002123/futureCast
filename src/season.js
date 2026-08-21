// Season context: how busy this Atlantic hurricane season is compared to
// normal, a running log of every system the app has seen this season, and
// the ex-hurricanes that actually reached the UK in the past.

import AsyncStorage from '@react-native-async-storage/async-storage';

const SEASON_LOG_KEY = 'storms.seasonlog.v1';

// Climatological cumulative named-storm counts through the season
// (approximate NOAA 1991–2020 averages; ~14 named storms per year, peak on
// 10 September).
const CLIMATOLOGY = [
  // [month (1-12), day, average storms so far]
  [6, 1, 0.6], [7, 1, 1.4], [7, 15, 2.2], [8, 1, 3.5], [8, 15, 5.2],
  [9, 1, 7.5], [9, 15, 9.5], [10, 1, 11.2], [10, 15, 12.3], [11, 1, 13.3],
  [11, 30, 14.4],
];

export const SEASON_PEAK = { month: 9, day: 10 };

export function climatologyToDate(now = new Date()) {
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  let avg = 0;
  for (const [cm, cd, value] of CLIMATOLOGY) {
    if (m > cm || (m === cm && d >= cd)) avg = value;
  }
  return avg;
}

export function daysToPeak(now = new Date()) {
  const peak = new Date(Date.UTC(now.getUTCFullYear(), SEASON_PEAK.month - 1, SEASON_PEAK.day));
  return Math.round((peak.getTime() - now.getTime()) / 86400000);
}

// Atlantic storm ids run al01…, al02… in order, so the highest number seen
// this year says how many systems the season has produced so far (it counts
// depressions too, so it slightly overstates *named* storms).
export function seasonStormNumber(assessed, log) {
  let max = 0;
  const year = new Date().getUTCFullYear();
  const consider = (id) => {
    const m = /^al(\d{2})(\d{4})$/.exec(String(id));
    if (m && Number(m[2]) === year) max = Math.max(max, Number(m[1]));
  };
  for (const a of assessed || []) consider(a.storm.id);
  for (const id of Object.keys(log || {})) consider(id);
  return max;
}

export function seasonActivityLabel(count, avg) {
  if (avg <= 0) return { label: 'Pre-season', color: '#4b8f6f' };
  const ratio = count / avg;
  if (ratio >= 1.5) return { label: 'Well above normal', color: '#d43c3c' };
  if (ratio >= 1.1) return { label: 'Above normal', color: '#e08a3c' };
  if (ratio >= 0.75) return { label: 'Near normal', color: '#d4b93c' };
  return { label: 'Below normal', color: '#4b8f6f' };
}

// Running log of every system seen this season: peak intensity and the
// closest its track ever came to the UK across all the refreshes we did.
export async function loadSeasonLog() {
  try {
    const raw = await AsyncStorage.getItem(SEASON_LOG_KEY);
    const log = raw ? JSON.parse(raw) : {};
    // A new year starts a new season log.
    const year = String(new Date().getUTCFullYear());
    for (const id of Object.keys(log)) {
      if (!id.endsWith(year)) delete log[id];
    }
    return log;
  } catch {
    return {};
  }
}

export async function updateSeasonLog(log, assessed) {
  const next = { ...log };
  for (const { storm, risk } of assessed || []) {
    const prev = next[storm.id] || {};
    next[storm.id] = {
      name: storm.name,
      classification: storm.classification,
      maxWindKt: Math.max(prev.maxWindKt || 0, storm.windKt || 0, risk.peakKt || 0),
      minUKMiles: Math.min(
        prev.minUKMiles ?? Infinity,
        risk.closest?.miles ?? Infinity
      ),
      maxScore: Math.max(prev.maxScore || 0, risk.score || 0),
      firstSeen: prev.firstSeen || Date.now(),
      lastSeen: Date.now(),
    };
  }
  try {
    await AsyncStorage.setItem(SEASON_LOG_KEY, JSON.stringify(next));
  } catch {
    // non-fatal
  }
  return next;
}

// Ex-hurricanes that genuinely affected the UK & Ireland — context for what
// "it's coming our way" has historically meant.
export const HISTORIC_UK_STORMS = [
  { year: 2017, name: 'Ophelia', note: 'Strongest east-Atlantic hurricane on record; hit Ireland and the UK as a violent ex-hurricane — red warnings, 3 deaths, 100+ mph gusts.' },
  { year: 2014, name: 'Bertha', note: 'Ex-hurricane crossed the UK with flooding rain and 60 mph gusts.' },
  { year: 2011, name: 'Katia', note: 'Ex-hurricane swept Scotland and northern England with ~80 mph gusts.' },
  { year: 2006, name: 'Gordon', note: 'Ex-hurricane brought 80 mph gusts to Cornwall and unseasonal warmth.' },
  { year: 1996, name: 'Lili', note: 'Ex-hurricane hit Wales and southern England, 90+ mph gusts and wide power cuts.' },
  { year: 1986, name: 'Charley', note: 'Ex-hurricane caused severe flooding in Ireland and Wales; 11 deaths.' },
  { year: 1961, name: 'Debbie', note: 'Struck Ireland barely post-tropical — 100+ mph gusts, the benchmark event.' },
];
