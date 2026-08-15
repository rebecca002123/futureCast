// Live wildfire detections for the UK & Ireland from NASA FIRMS
// (Fire Information for Resource Management System).
//
// FIRMS publishes keyless near-real-time CSV feeds of satellite fire
// detections. We pull the Europe 24h feed from every available sensor —
// VIIRS on Suomi-NPP, NOAA-20 and NOAA-21 (375 m resolution) plus MODIS on
// Terra/Aqua (1 km) — filter to the UK/Ireland bounding box, and cluster
// detections into fire incidents. Typical latency from satellite overpass
// to feed is 1–3 hours (NRT) and minutes for the US/real-time subsets.

const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire';

export const FEEDS = [
  {
    id: 'VIIRS S-NPP',
    url: `${FIRMS_BASE}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv`,
  },
  {
    id: 'VIIRS NOAA-20',
    url: `${FIRMS_BASE}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_24h.csv`,
  },
  {
    id: 'VIIRS NOAA-21',
    url: `${FIRMS_BASE}/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Europe_24h.csv`,
  },
  {
    id: 'MODIS',
    url: `${FIRMS_BASE}/modis-c6.1/csv/MODIS_C6_1_Europe_24h.csv`,
  },
];

// Bounding box covering the UK plus the island of Ireland (fires just over
// the border matter for proximity warnings in Northern Ireland).
export const UK_BOUNDS = {
  latMin: 49.7,
  latMax: 61.1,
  lonMin: -11.0,
  lonMax: 2.1,
};

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Minimal CSV parser — FIRMS values never contain quoted commas.
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iLat = col('latitude');
  const iLon = col('longitude');
  const iDate = col('acq_date');
  const iTime = col('acq_time');
  const iSat = col('satellite');
  const iInstrument = col('instrument');
  const iConf = col('confidence');
  const iFrp = col('frp');
  const iDayNight = col('daynight');
  if (iLat < 0 || iLon < 0 || iDate < 0 || iTime < 0) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const lat = parseFloat(parts[iLat]);
    const lon = parseFloat(parts[iLon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    rows.push({
      lat,
      lon,
      acqDate: parts[iDate],
      acqTime: parts[iTime],
      satellite: iSat >= 0 ? parts[iSat] : '',
      instrument: iInstrument >= 0 ? parts[iInstrument] : '',
      confidence: iConf >= 0 ? parts[iConf] : '',
      frp: iFrp >= 0 ? parseFloat(parts[iFrp]) || 0 : 0,
      daynight: iDayNight >= 0 ? parts[iDayNight] : '',
    });
  }
  return rows;
}

// acq_date "2026-08-14" + acq_time "148" (meaning 01:48 UTC) → Date
function detectionTime(acqDate, acqTime) {
  const [y, m, d] = String(acqDate).split('-').map(Number);
  const t = String(acqTime).padStart(4, '0');
  const hh = Number(t.slice(0, 2));
  const mm = Number(t.slice(2, 4));
  if (!y || !m || !d || !isFinite(hh) || !isFinite(mm)) return null;
  return new Date(Date.UTC(y, m - 1, d, hh, mm));
}

// VIIRS reports confidence as l/n/h; MODIS as 0–100.
function normalizeConfidence(raw) {
  const v = String(raw).trim().toLowerCase();
  if (v === 'l' || v === 'low') return 'low';
  if (v === 'n' || v === 'nominal') return 'nominal';
  if (v === 'h' || v === 'high') return 'high';
  const n = parseFloat(v);
  if (isFinite(n)) {
    if (n < 30) return 'low';
    if (n < 80) return 'nominal';
    return 'high';
  }
  return 'nominal';
}

function inBounds(lat, lon, b) {
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/csv,text/plain,*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Fetch every feed (tolerating individual failures), filter to UK/Ireland,
// dedupe, and return raw detections plus per-source status. Background tasks
// pass a shorter timeout to stay inside iOS's execution budget.
export async function fetchDetections(timeoutMs = 25000) {
  const results = await Promise.allSettled(
    FEEDS.map((f) => fetchWithTimeout(f.url, timeoutMs))
  );

  const detections = [];
  const seen = new Set();
  const sources = [];

  results.forEach((res, idx) => {
    const feed = FEEDS[idx];
    if (res.status !== 'fulfilled') {
      sources.push({ id: feed.id, ok: false, count: 0, error: String(res.reason?.message || res.reason) });
      return;
    }
    let count = 0;
    for (const row of parseCsv(res.value)) {
      if (!inBounds(row.lat, row.lon, UK_BOUNDS)) continue;
      const time = detectionTime(row.acqDate, row.acqTime);
      if (!time) continue;
      // Dedupe identical detections (NRT/RT overlap within a feed).
      const key = `${row.satellite}|${row.lat.toFixed(4)}|${row.lon.toFixed(4)}|${time.getTime()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      detections.push({
        lat: row.lat,
        lon: row.lon,
        time,
        source: feed.id,
        instrument: row.instrument,
        confidence: normalizeConfidence(row.confidence),
        frp: row.frp,
        daynight: row.daynight,
      });
      count++;
    }
    sources.push({ id: feed.id, ok: true, count, error: null });
  });

  const anyOk = sources.some((s) => s.ok);
  return { detections, sources, fetchedAt: new Date(), anyOk };
}

// Greedy clustering of detections into incidents: strongest detections seed
// clusters, others join the nearest cluster within radiusKm.
export function clusterDetections(detections, radiusKm = 3) {
  const sorted = [...detections].sort((a, b) => b.frp - a.frp);
  const clusters = [];

  for (const det of sorted) {
    let best = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      const d = haversineKm(det.lat, det.lon, c.lat, c.lon);
      if (d <= radiusKm && d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    if (best) {
      best.detections.push(det);
      // Recenter on the mean of member coordinates.
      best.lat = best.detections.reduce((s, x) => s + x.lat, 0) / best.detections.length;
      best.lon = best.detections.reduce((s, x) => s + x.lon, 0) / best.detections.length;
    } else {
      clusters.push({ lat: det.lat, lon: det.lon, detections: [det] });
    }
  }

  const rank = { low: 0, nominal: 1, high: 2 };
  return clusters.map((c) => {
    const latest = c.detections.reduce((a, b) => (a.time > b.time ? a : b));
    const maxFrp = Math.max(...c.detections.map((d) => d.frp));
    const bestConf = c.detections.reduce((a, b) =>
      rank[a.confidence] >= rank[b.confidence] ? a : b
    ).confidence;
    const srcs = [...new Set(c.detections.map((d) => d.source))];
    return {
      id: `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`,
      lat: c.lat,
      lon: c.lon,
      count: c.detections.length,
      latestTime: latest.time,
      maxFrp,
      confidence: bestConf,
      sources: srcs,
    };
  });
}

export const KM_PER_MILE = 1.609344;

export function haversineMiles(lat1, lon1, lat2, lon2) {
  return haversineKm(lat1, lon1, lat2, lon2) / KM_PER_MILE;
}

export function hoursAgo(date, now = new Date()) {
  return (now.getTime() - date.getTime()) / 3600000;
}

export function timeAgoLabel(date, now = new Date()) {
  const mins = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m ago` : `${h}h ago`;
  return `${Math.floor(h / 24)}d ${h % 24}h ago`;
}
