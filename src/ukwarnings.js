// Official UK weather warnings via MeteoAlarm.
//
// MeteoAlarm (meteoalarm.org) republishes every European national met
// service's warnings — for the UK, the Met Office's yellow/amber/red
// warnings — as a keyless ATOM feed of CAP entries. Each entry carries the
// warning type (wind, rain, thunderstorm…), the awareness level, the region
// and the validity window. When the Met Office names a storm ("Storm
// Ashley"), the name usually appears in the warning text, so it's surfaced
// too.

const FEED_URL =
  'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-united-kingdom';

// CAP awareness_type code → label + emoji.
const TYPES = {
  1: { label: 'Wind', icon: '💨' },
  2: { label: 'Snow & ice', icon: '❄️' },
  3: { label: 'Thunderstorms', icon: '⛈' },
  4: { label: 'Fog', icon: '🌫' },
  5: { label: 'Extreme heat', icon: '🌡' },
  6: { label: 'Extreme cold', icon: '🥶' },
  7: { label: 'Coastal event', icon: '🌊' },
  8: { label: 'Wildfire', icon: '🔥' },
  9: { label: 'Avalanche', icon: '🏔' },
  10: { label: 'Rain', icon: '🌧' },
  12: { label: 'Flooding', icon: '🌊' },
  13: { label: 'Rain & flood', icon: '🌧' },
};

// CAP awareness_level code → Met Office colour.
const LEVELS = {
  2: { level: 'Yellow', rank: 1, color: '#d4b93c' },
  3: { level: 'Amber', rank: 2, color: '#e08a3c' },
  4: { level: 'Red', rank: 3, color: '#d43c3c' },
};

function tag(entry, name) {
  const m = new RegExp(`<(?:cap:)?${name}[^>]*>([\\s\\S]*?)</(?:cap:)?${name}>`, 'i').exec(entry);
  return m ? m[1].trim() : '';
}

function code(value) {
  const m = /^\s*(\d+)/.exec(String(value));
  return m ? Number(m[1]) : null;
}

function parseDate(value) {
  const d = new Date(String(value).trim());
  return isNaN(d) ? null : d;
}

export function stormNameFrom(text) {
  const m = /(?:STORM|EX-HURRICANE)\s+([A-Z][a-zA-Z]+)/i.exec(String(text));
  if (!m) return null;
  const name = m[1];
  // Avoid matching generic phrases like "storm force".
  if (/^(force|surge|warning|watch|conditions)$/i.test(name)) return null;
  return name[0].toUpperCase() + name.slice(1).toLowerCase();
}

// Parse the ATOM feed into active warnings, strongest first, deduped by
// region + type + level (the feed lists today and tomorrow separately).
export function parseWarnings(xml, now = new Date()) {
  const entries = String(xml).split(/<entry[\s>]/i).slice(1);
  const seen = new Map();
  let stormName = null;

  for (const entry of entries) {
    const levelCode = code(tag(entry, 'awareness_level'));
    const level = LEVELS[levelCode];
    if (!level) continue; // green/unknown

    const typeCode = code(tag(entry, 'awareness_type'));
    const type = TYPES[typeCode] || { label: tag(entry, 'event') || 'Weather', icon: '⚠️' };
    const area = tag(entry, 'areaDesc') || 'United Kingdom';
    const onset = parseDate(tag(entry, 'onset') || tag(entry, 'effective'));
    const expires = parseDate(tag(entry, 'expires'));
    const title = tag(entry, 'title');

    if (expires && expires.getTime() < now.getTime()) continue;

    const name =
      stormNameFrom(title) ||
      stormNameFrom(tag(entry, 'summary')) ||
      stormNameFrom(tag(entry, 'description')) ||
      stormNameFrom(tag(entry, 'content'));
    if (name) stormName = name;

    const key = `${area}|${type.label}|${level.level}`;
    const existing = seen.get(key);
    const warning = {
      id: key,
      area,
      type: type.label,
      icon: type.icon,
      level: level.level,
      rank: level.rank,
      color: level.color,
      onset,
      expires,
      active: !onset || onset.getTime() <= now.getTime(),
    };
    if (!existing) {
      seen.set(key, warning);
    } else {
      // Same warning listed for today and tomorrow — keep the widest window.
      if (onset && (!existing.onset || onset < existing.onset)) existing.onset = onset;
      if (expires && (!existing.expires || expires > existing.expires)) existing.expires = expires;
      existing.active = existing.active || warning.active;
    }
  }

  const warnings = [...seen.values()].sort(
    (a, b) => b.rank - a.rank || (a.onset?.getTime?.() || 0) - (b.onset?.getTime?.() || 0)
  );
  const top = warnings[0] || null;
  return { warnings, top, stormName, fetchedAt: now };
}

export async function fetchUKWarnings(timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(FEED_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/atom+xml,application/xml,text/xml,*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseWarnings(await res.text());
  } finally {
    clearTimeout(timer);
  }
}
