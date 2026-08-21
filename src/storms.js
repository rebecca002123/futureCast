// Live Atlantic tropical cyclone data from the US National Hurricane Center.
//
// The NHC publishes keyless public feeds that everything here is built on:
//
//   CurrentStorms.json  — every cyclone the NHC is currently advising on
//                         (position, intensity, pressure, movement) plus the
//                         URLs of that storm's latest advisory products.
//   Forecast/Advisory   — the "TCM" text product for a storm, containing the
//     (per storm)         official forecast positions out to 5 days.
//   TWOAT.xml           — the Atlantic Tropical Weather Outlook: areas of
//                         disturbed weather with 2-day and 7-day chances of
//                         developing into a tropical cyclone.
//
// Advisories are issued every 6 hours (03/09/15/21 UTC) with intermediate
// position updates in between, so data can be up to ~3 hours old.

const NHC_BASE = 'https://www.nhc.noaa.gov';

export const CURRENT_STORMS_URL = `${NHC_BASE}/CurrentStorms.json`;
export const OUTLOOK_URL = `${NHC_BASE}/xml/TWOAT.xml`;
export const OUTLOOK_GRAPHIC_URL = `${NHC_BASE}/gtwo.php?basin=atlc&fdays=7`;
// The NHC's 7-day graphical outlook image itself (updated 4x daily).
export const OUTLOOK_IMAGE_URL = `${NHC_BASE}/xgtwo/two_atl_7d0.png`;

export const KM_PER_MILE = 1.609344;
export const MPH_PER_KNOT = 1.15078;

// ---------------------------------------------------------------- geometry

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 6371 / KM_PER_MILE; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Initial great-circle bearing from point 1 to point 2, in degrees clockwise
// from true north.
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// Point reached by travelling distMiles from (lat, lon) along a bearing.
export function destinationPoint(lat, lon, bearing, distMiles) {
  const R = 6371 / KM_PER_MILE;
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const d = distMiles / R;
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const b = toRad(bearing);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2)
    );
  return { lat: toDeg(p2), lon: ((toDeg(l2) + 540) % 360) - 180 };
}

// Smallest angle between two compass bearings, 0–180.
export function angleBetween(a, b) {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

export function compassPoint(deg) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// --------------------------------------------------------- storm labelling

// NHC storm classification codes.
const CLASSIFICATIONS = {
  TD: 'Tropical depression',
  TS: 'Tropical storm',
  HU: 'Hurricane',
  MH: 'Major hurricane',
  PTC: 'Potential tropical cyclone',
  STD: 'Subtropical depression',
  STS: 'Subtropical storm',
  SD: 'Subtropical depression',
  SS: 'Subtropical storm',
  TY: 'Typhoon',
  DB: 'Disturbance',
  LO: 'Low',
  EX: 'Post-tropical cyclone',
  PT: 'Post-tropical cyclone',
  RM: 'Remnants',
};

export function classificationLabel(code) {
  return CLASSIFICATIONS[String(code || '').toUpperCase()] || 'Tropical system';
}

// Saffir–Simpson category from 1-minute sustained wind in knots.
export function saffirSimpson(kt) {
  if (!isFinite(kt)) return null;
  if (kt >= 137) return 5;
  if (kt >= 113) return 4;
  if (kt >= 96) return 3;
  if (kt >= 83) return 2;
  if (kt >= 64) return 1;
  return null;
}

export function ktToMph(kt) {
  return kt * MPH_PER_KNOT;
}

export function intensityLabel(storm) {
  const cat = saffirSimpson(storm.windKt);
  if (cat) return `Category ${cat} hurricane`;
  return classificationLabel(storm.classification);
}

// Colour used for the storm's marker and card accent.
export function stormColor(storm) {
  const cat = saffirSimpson(storm.windKt);
  if (cat >= 4) return '#c026d3';
  if (cat === 3) return '#e11d48';
  if (cat === 2) return '#f97316';
  if (cat === 1) return '#f59e0b';
  if (storm.windKt >= 34) return '#38bdf8';
  return '#94a3b8';
}

// ------------------------------------------------------------- fetch utils

async function fetchWithTimeout(url, ms, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: accept || '*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// NHC text products are served inside an HTML <pre> block.
export function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n');
}

// ------------------------------------------------------ current storms feed

function parseCoord(value, numeric) {
  if (isFinite(numeric) && numeric !== 0) return numeric;
  const m = /^\s*(\d+(?:\.\d+)?)\s*([NSEW])\s*$/i.exec(String(value || ''));
  if (!m) return isFinite(numeric) ? numeric : NaN;
  const v = parseFloat(m[1]);
  const hemi = m[2].toUpperCase();
  return hemi === 'S' || hemi === 'W' ? -v : v;
}

// CurrentStorms.json → the storms we care about. `al…` ids are Atlantic;
// eastern/central Pacific systems (ep…, cp…) are dropped.
export function parseCurrentStorms(data) {
  const list = Array.isArray(data?.activeStorms) ? data.activeStorms : [];
  return list
    .filter((s) => String(s.id || '').toLowerCase().startsWith('al'))
    .map((s) => {
      const lat = parseCoord(s.latitude, s.latitudeNumeric);
      const lon = parseCoord(s.longitude, s.longitudeNumeric);
      const windKt = parseFloat(s.intensity);
      return {
        id: String(s.id).toLowerCase(),
        binNumber: s.binNumber || null,
        name: s.name || 'Unnamed',
        classification: String(s.classification || '').toUpperCase(),
        windKt: isFinite(windKt) ? windKt : NaN,
        pressureMb: parseFloat(s.pressure) || null,
        lat,
        lon,
        movementDir: isFinite(s.movementDir) ? s.movementDir : null,
        movementSpeedKt: isFinite(s.movementSpeed) ? s.movementSpeed : null,
        lastUpdate: s.lastUpdate ? new Date(s.lastUpdate) : null,
        advisoryUrl: s.publicAdvisory?.url || s.forecastAdvisory?.url || null,
        forecastAdvisoryUrl: s.forecastAdvisory?.url || null,
        forecastAdvisoryIssuance: s.forecastAdvisory?.issuance
          ? new Date(s.forecastAdvisory.issuance)
          : null,
        advisoryNumber: s.publicAdvisory?.advNum || s.forecastAdvisory?.advNum || null,
        conePngUrl: s.forecastGraphics?.url || null,
      };
    })
    .filter((s) => isFinite(s.lat) && isFinite(s.lon));
}

export async function fetchActiveStorms(timeoutMs = 20000) {
  const text = await fetchWithTimeout(CURRENT_STORMS_URL, timeoutMs, 'application/json');
  return parseCurrentStorms(JSON.parse(text));
}

// ------------------------------------------------- forecast advisory (TCM)

// Builds a UTC Date from a "DD/HHMMZ" advisory timestamp, using the advisory
// issue time to resolve which month the day-of-month belongs to.
function advisoryDate(day, hhmm, base) {
  const ref = base instanceof Date && !isNaN(base) ? base : new Date();
  const hh = Number(String(hhmm).slice(0, 2));
  const mm = Number(String(hhmm).slice(2, 4));
  let d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), Number(day), hh, mm));
  // Forecast points run forward from the advisory; a day number that lands
  // well before it means the forecast crosses into the next month.
  if (d.getTime() < ref.getTime() - 18 * 3600000) {
    d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, Number(day), hh, mm));
  }
  return d;
}

const POSITION_RE =
  /(FORECAST|OUTLOOK)\s+VALID\s+(\d{2})\/(\d{4})Z\s+(\d{1,2}\.\d)([NS])\s+(\d{1,3}\.\d)([EW])([^\n]*)/g;
const CENTER_RE =
  /CENTER\s+LOCATED\s+(?:NEAR|WITHIN)\s+(\d{1,2}\.\d)([NS])\s+(\d{1,3}\.\d)([EW])\s+AT\s+(\d{2})\/(\d{4})Z/;
const END_RE = /(FORECAST|OUTLOOK)\s+VALID\s+(\d{2})\/(\d{4})Z\s*\.{3}\s*([A-Z\/ -]+)/g;

// Parse an NHC Forecast/Advisory (TCM) into the official forecast track.
// The product lists positions at 12/24/36/48/60/72 hours ("FORECAST VALID")
// and 96/120 hours ("OUTLOOK VALID"), each followed by the forecast intensity.
export function parseForecastAdvisory(raw, issuedAt) {
  const text = stripHtml(raw).toUpperCase();
  const points = [];

  const center = CENTER_RE.exec(text);
  let base = issuedAt instanceof Date && !isNaN(issuedAt) ? issuedAt : null;
  if (center && !base) {
    base = advisoryDate(center[5], center[6], new Date());
  }
  if (center) {
    const nowWind = /MAX\s+SUSTAINED\s+WINDS\s+(\d+)\s*KT/.exec(text);
    points.push({
      lat: center[2] === 'S' ? -parseFloat(center[1]) : parseFloat(center[1]),
      lon: center[4] === 'W' ? -parseFloat(center[3]) : parseFloat(center[3]),
      time: advisoryDate(center[5], center[6], base),
      windKt: nowWind ? Number(nowWind[1]) : NaN,
      note: '',
      hour: 0,
      extrapolated: false,
    });
  }

  POSITION_RE.lastIndex = 0;
  let m;
  while ((m = POSITION_RE.exec(text)) !== null) {
    const lat = m[5] === 'S' ? -parseFloat(m[4]) : parseFloat(m[4]);
    const lon = m[7] === 'W' ? -parseFloat(m[6]) : parseFloat(m[6]);
    const time = advisoryDate(m[2], m[3], base);
    // Intensity is on the line(s) immediately after the position.
    const after = text.slice(m.index, m.index + 260);
    const wind = /MAX\s+WIND\s+(\d+)\s*KT/.exec(after);
    points.push({
      lat,
      lon,
      time,
      windKt: wind ? Number(wind[1]) : NaN,
      note: cleanNote(m[8]),
      extrapolated: false,
    });
  }

  // "...DISSIPATED" / "...ABSORBED" endings carry no coordinates.
  END_RE.lastIndex = 0;
  let ending = null;
  let endMatch;
  while ((endMatch = END_RE.exec(text)) !== null) {
    ending = { time: advisoryDate(endMatch[2], endMatch[3], base), status: cleanNote(endMatch[4]) };
  }

  points.sort((a, b) => a.time - b.time);
  const start = points.length ? points[0].time.getTime() : Date.now();
  for (const p of points) p.hour = Math.round((p.time.getTime() - start) / 3600000);

  const maxWindKt = points.reduce((max, p) => (isFinite(p.windKt) ? Math.max(max, p.windKt) : max), 0);
  return { points, ending, advisoryTime: base, maxWindKt };
}

function cleanNote(s) {
  return String(s || '')
    .replace(/^[.\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchForecastTrack(storm, timeoutMs = 20000) {
  if (!storm.forecastAdvisoryUrl) return null;
  const raw = await fetchWithTimeout(storm.forecastAdvisoryUrl, timeoutMs, 'text/html,text/plain');
  const parsed = parseForecastAdvisory(raw, storm.forecastAdvisoryIssuance);
  return parsed.points.length >= 2 ? parsed : null;
}

// ------------------------------------------------- tropical weather outlook

// Rough longitude/latitude hints for the places the outlook names, so the app
// can say whether a developing area is in the part of the Atlantic that tends
// to send systems towards Europe. Indicative only — the outlook text gives no
// coordinates.
const REGION_HINTS = [
  { re: /CABO VERDE|CAPE VERDE|FAR EASTERN (TROPICAL )?ATLANTIC|EASTERN (TROPICAL )?ATLANTIC/i, region: 'Eastern Atlantic', ukRelevant: true },
  { re: /CENTRAL (TROPICAL |SUBTROPICAL )?ATLANTIC|MIDDLE OF THE ATLANTIC/i, region: 'Central Atlantic', ukRelevant: true },
  { re: /AZORES|NORTHEASTERN ATLANTIC|NORTH ATLANTIC/i, region: 'Northeast Atlantic', ukRelevant: true },
  { re: /BERMUDA|WESTERN ATLANTIC|SOUTHEASTERN (U\.?S\.?|UNITED STATES)|OFF THE (SOUTHEASTERN|EAST) (U\.?S\.?|COAST)/i, region: 'Western Atlantic', ukRelevant: true },
  { re: /CARIBBEAN|BAHAMAS|HISPANIOLA|LEEWARD|WINDWARD|PUERTO RICO/i, region: 'Caribbean', ukRelevant: false },
  { re: /GULF OF (MEXICO|AMERICA)|BAY OF CAMPECHE|YUCATAN|FLORIDA/i, region: 'Gulf', ukRelevant: false },
];

function regionFor(text) {
  for (const hint of REGION_HINTS) {
    if (hint.re.test(text)) return hint;
  }
  return { region: 'Atlantic', ukRelevant: false };
}

// Parse TWOAT.xml (the Atlantic Tropical Weather Outlook RSS) into the
// numbered areas the NHC is watching, with their formation chances.
export function parseOutlook(xml) {
  const items = String(xml).split(/<item[\s>]/i).slice(1);
  let body = '';
  let issuedAt = null;

  for (const item of items) {
    const title = /<title>([\s\S]*?)<\/title>/i.exec(item)?.[1] || '';
    if (!/TROPICAL WEATHER OUTLOOK/i.test(title)) continue;
    const desc = /<description>([\s\S]*?)<\/description>/i.exec(item)?.[1] || '';
    const cleaned = stripHtml(desc.replace(/<!\[CDATA\[|\]\]>/g, ' '));
    if (cleaned.trim().length > body.trim().length) {
      body = cleaned;
      const pub = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(item)?.[1];
      const d = pub ? new Date(pub.trim()) : null;
      if (d && !isNaN(d)) issuedAt = d;
    }
  }

  const areas = [];
  if (body) {
    // Areas are numbered paragraphs: "1. Near the Cabo Verde Islands (AL95):"
    const blocks = body.split(/\n(?=\s*\d\.\s)/).filter((b) => /^\s*\d\.\s/.test(b));
    for (const block of blocks) {
      const flat = block.replace(/\s+/g, ' ').trim();
      const num = /^(\d)\./.exec(flat)?.[1] || String(areas.length + 1);
      const heading = /^\d\.\s*([^:]{3,120}):/.exec(flat)?.[1]?.trim() || 'Area of disturbed weather';
      const c48 = /(?:48\s*HOURS|2\s*DAYS)[^0-9%]*?(\d{1,3})\s*PERCENT/i.exec(flat);
      const c7 = /(?:7\s*DAYS|168\s*HOURS)[^0-9%]*?(\d{1,3})\s*PERCENT/i.exec(flat);
      const invest = /\(A?L?\s?(\d{2}L?)\)/i.exec(heading)?.[0]?.replace(/[()]/g, '') || null;
      const hint = regionFor(flat);
      areas.push({
        id: `two-${num}-${heading.slice(0, 24)}`,
        number: Number(num),
        title: heading,
        invest,
        chance48: c48 ? Number(c48[1]) : null,
        chance7: c7 ? Number(c7[1]) : null,
        region: hint.region,
        ukRelevant: hint.ukRelevant,
        text: narrative(flat, heading),
      });
    }
  }

  return { areas, issuedAt, body: body.trim() };
}

// The readable part of an outlook paragraph: drop the numbered heading (shown
// separately), the formation-chance bullets (shown as bars) and the
// forecaster's sign-off.
function narrative(flat, heading) {
  return flat
    .replace(/^\d\.\s*/, '')
    .replace(heading, '')
    .replace(/^[:\s]+/, '')
    .replace(/\*?\s*Formation chance through[^*]*?percent\.?/gi, ' ')
    .replace(/Forecaster\s+\w+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchOutlook(timeoutMs = 20000) {
  const xml = await fetchWithTimeout(OUTLOOK_URL, timeoutMs, 'application/xml,text/xml');
  return parseOutlook(xml);
}

// ------------------------------------------------------------------ labels

export function timeAgoLabel(date, now = new Date()) {
  const mins = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m ago` : `${h}h ago`;
  return `${Math.floor(h / 24)}d ${h % 24}h ago`;
}

// "in 3 days (Sat 23rd)" style lead-time label for a future time.
export function leadTimeLabel(date, now = new Date()) {
  const hours = (date.getTime() - now.getTime()) / 3600000;
  if (hours < 1) return 'now';
  if (hours < 36) return `in ${Math.round(hours)}h`;
  const days = hours / 24;
  return `in ${days < 3 ? days.toFixed(1) : Math.round(days)} days`;
}

export function fmtDayLabel(date) {
  try {
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
