// Live wind radar — a Windy-style view of the North Atlantic rendered in a
// WebView: a colour layer of wind speed, animated particle streamlines, real
// coastlines, and the active storms overlaid. Data is a 2°-resolution
// wind-speed/direction grid from Open-Meteo (keyless), fetched in chunks by
// the page itself, with a time slider covering the next 4 days.
//
// Everything is self-contained in the generated HTML so it runs identically
// in the app's WebView, in an iframe on web, and headless in tests.

import COASTLINES from './coastlines.json';

export const RADAR_REGION = { latMin: 30, latMax: 66, lonMin: -46, lonMax: 8, step: 2 };

export function buildRadarHtml(overlays = []) {
  const region = JSON.stringify(RADAR_REGION);
  const coast = JSON.stringify(COASTLINES);
  const marks = JSON.stringify(
    overlays.map((o) => ({
      lat: o.lat,
      lon: o.lon,
      label: o.label || '',
      kind: o.kind || 'storm',
    }))
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; padding: 0; background: #0e1420; overflow: hidden;
    font-family: -apple-system, system-ui, sans-serif; -webkit-user-select: none; user-select: none; }
  #wrap { position: relative; width: 100vw; height: 100vh; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  #ui { position: absolute; left: 8px; right: 8px; bottom: 8px; z-index: 5; }
  #timeline { display: flex; align-items: center; gap: 8px;
    background: rgba(10,14,20,0.8); border-radius: 10px; padding: 7px 10px; }
  #when { color: #dbe1ea; font-size: 12px; font-weight: 700; min-width: 86px; }
  #slider { flex: 1; accent-color: #38bdf8; height: 22px; }
  #legend { display: flex; margin-top: 6px; border-radius: 6px; overflow: hidden;
    height: 14px; opacity: 0.92; }
  .leg { flex: 1; color: #fff; font-size: 8.5px; text-align: center; line-height: 14px;
    font-weight: 700; text-shadow: 0 0 2px rgba(0,0,0,0.8); }
  #status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: #8b93a3; font-size: 13px; z-index: 6; background: #0e1420; }
  #probe { position: absolute; display: none; background: rgba(10,14,20,0.9); color: #fff;
    font-size: 12px; font-weight: 700; padding: 4px 8px; border-radius: 7px; z-index: 7;
    pointer-events: none; transform: translate(-50%, -140%); white-space: nowrap; }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="field"></canvas>
  <canvas id="trails"></canvas>
  <canvas id="deco"></canvas>
  <div id="probe"></div>
  <div id="ui">
    <div id="timeline">
      <span id="when">Now</span>
      <input id="slider" type="range" min="0" max="15" step="1" value="0">
    </div>
    <div id="legend"></div>
  </div>
  <div id="status">Loading wind field…</div>
</div>
<script>
var REGION = ${region};
var COAST = ${coast};
var MARKS = ${marks};

// mph → colour, tuned to read like the familiar wind-map palettes:
// blues/greens calm, tan/orange fresh-to-gale, magenta/purple violent.
var STOPS = [
  [0,  [43, 91, 138]], [6,  [58, 123, 125]], [12, [63, 143, 95]],
  [18, [74, 160, 76]], [24, [127, 174, 63]], [30, [194, 176, 58]],
  [36, [217, 154, 53]], [43, [217, 124, 48]], [50, [200, 92, 58]],
  [58, [179, 74, 94]], [68, [161, 63, 143]], [80, [138, 62, 194]],
  [95, [199, 127, 224]], [120, [239, 217, 247]]
];
function colorFor(mph) {
  if (mph <= STOPS[0][0]) return STOPS[0][1];
  for (var i = 1; i < STOPS.length; i++) {
    if (mph <= STOPS[i][0]) {
      var a = STOPS[i - 1], b = STOPS[i];
      var t = (mph - a[0]) / (b[0] - a[0]);
      return [
        a[1][0] + (b[1][0] - a[1][0]) * t,
        a[1][1] + (b[1][1] - a[1][1]) * t,
        a[1][2] + (b[1][2] - a[1][2]) * t
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

var nLon = Math.round((REGION.lonMax - REGION.lonMin) / REGION.step) + 1;
var nLat = Math.round((REGION.latMax - REGION.latMin) / REGION.step) + 1;
var W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);
var speedT = null, uT = null, vT = null, times = [];
var step = 0;

var fieldC = document.getElementById('field');
var trailsC = document.getElementById('trails');
var decoC = document.getElementById('deco');

function xOf(lon) { return (lon - REGION.lonMin) / (REGION.lonMax - REGION.lonMin) * W; }
function yOf(lat) { return (REGION.latMax - lat) / (REGION.latMax - REGION.latMin) * H; }
function lonOf(x) { return REGION.lonMin + x / W * (REGION.lonMax - REGION.lonMin); }
function latOf(y) { return REGION.latMax - y / H * (REGION.latMax - REGION.latMin); }

function size() {
  W = window.innerWidth; H = window.innerHeight;
  [fieldC, trailsC, decoC].forEach(function (c) {
    c.width = W * DPR; c.height = H * DPR;
    c.getContext('2d').setTransform(DPR, 0, 0, DPR, 0, 0);
  });
}

// Bilinear sample of grid arrays laid out [t][row * nLon + col], row 0 = latMax.
function sample(arr, t, lat, lon) {
  var gx = (lon - REGION.lonMin) / REGION.step;
  var gy = (REGION.latMax - lat) / REGION.step;
  var x0 = Math.max(0, Math.min(nLon - 2, Math.floor(gx)));
  var y0 = Math.max(0, Math.min(nLat - 2, Math.floor(gy)));
  var fx = Math.max(0, Math.min(1, gx - x0));
  var fy = Math.max(0, Math.min(1, gy - y0));
  var g = arr[t];
  var a = g[y0 * nLon + x0], b = g[y0 * nLon + x0 + 1];
  var c = g[(y0 + 1) * nLon + x0], d = g[(y0 + 1) * nLon + x0 + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function drawField() {
  // Colour layer: one pixel per grid cell, upscaled with smoothing on — the
  // browser's bilinear filter turns the coarse grid into smooth gradients.
  var off = document.createElement('canvas');
  off.width = nLon; off.height = nLat;
  var octx = off.getContext('2d');
  var img = octx.createImageData(nLon, nLat);
  var g = speedT[step];
  for (var i = 0; i < g.length; i++) {
    var c = colorFor(g[i]);
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  var ctx = fieldC.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, W, H);
  // Draw so cell CENTRES align with their coordinates.
  var cw = W / (nLon - 1), ch = H / (nLat - 1);
  ctx.drawImage(off, -cw / 2, -ch / 2, W + cw, H + ch);
  drawDeco();
}

function drawDeco() {
  var ctx = decoC.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  // Coastlines: dark halo + light line, like a proper weather map.
  ctx.lineJoin = 'round';
  for (var pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? 'rgba(240,246,255,0.95)' : 'rgba(8,12,20,0.55)';
    ctx.lineWidth = pass ? 1.4 : 3;
    COAST.forEach(function (line) {
      ctx.beginPath();
      for (var i = 0; i < line.length; i++) {
        var x = xOf(line[i][0]), y = yOf(line[i][1]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }
  // Storm / low markers.
  MARKS.forEach(function (m) {
    if (m.lon < REGION.lonMin || m.lon > REGION.lonMax || m.lat < REGION.latMin || m.lat > REGION.latMax) return;
    var x = xOf(m.lon), y = yOf(m.lat);
    ctx.font = '18px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(m.kind === 'low' ? '🌀' : '🌀', x, y + 6);
    if (m.label) {
      ctx.font = '700 11px system-ui';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 4;
      ctx.fillText(m.label, x, y + 22);
      ctx.shadowBlur = 0;
    }
  });
}

// ---- particles -------------------------------------------------------------
var N = 700, parts = [];
function resetParts() {
  parts = [];
  for (var i = 0; i < N; i++) parts.push(spawn());
}
function spawn() {
  return { x: Math.random() * W, y: Math.random() * H, life: 30 + Math.random() * 90 };
}
function tick() {
  var ctx = trailsC.getContext('2d');
  // fade old trails
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = 'rgba(0,0,0,0.95)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  var pxPerLon = W / (REGION.lonMax - REGION.lonMin);
  var pxPerLat = H / (REGION.latMax - REGION.latMin);
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var lat = latOf(p.y), lon = lonOf(p.x);
    var u = sample(uT, step, lat, lon);   // mph, east+
    var v = sample(vT, step, lat, lon);   // mph, north+
    var k = 0.011;
    var nx = p.x + u * k * pxPerLon / 6;
    var ny = p.y - v * k * pxPerLat / 6;
    p.life -= 1;
    if (p.life <= 0 || nx < 0 || nx > W || ny < 0 || ny > H) {
      parts[i] = spawn();
      continue;
    }
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(nx, ny);
    p.x = nx; p.y = ny;
  }
  ctx.stroke();
  requestAnimationFrame(tick);
}

// ---- data ------------------------------------------------------------------
function coords() {
  var lats = [], lons = [];
  for (var r = 0; r < nLat; r++) for (var c = 0; c < nLon; c++) {
    lats.push(REGION.latMax - r * REGION.step);
    lons.push(REGION.lonMin + c * REGION.step);
  }
  return { lats: lats, lons: lons };
}

function load() {
  var cs = coords();
  var CHUNK = 76;
  var reqs = [];
  for (var i = 0; i < cs.lats.length; i += CHUNK) {
    var la = cs.lats.slice(i, i + CHUNK).join(',');
    var lo = cs.lons.slice(i, i + CHUNK).join(',');
    reqs.push(fetch('https://api.open-meteo.com/v1/forecast?latitude=' + la +
      '&longitude=' + lo +
      '&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=mph' +
      '&temporal_resolution=hourly_6&forecast_days=4&timezone=UTC')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }));
  }
  Promise.all(reqs).then(function (chunks) {
    var locs = [];
    chunks.forEach(function (ch) { locs = locs.concat(Array.isArray(ch) ? ch : [ch]); });
    times = locs[0].hourly.time;
    var nT = times.length;
    speedT = []; uT = []; vT = [];
    for (var t = 0; t < nT; t++) {
      var sg = new Float32Array(nLat * nLon);
      var ug = new Float32Array(nLat * nLon);
      var vg = new Float32Array(nLat * nLon);
      for (var i = 0; i < locs.length; i++) {
        var sp = locs[i].hourly.wind_speed_10m[t] || 0;
        var dir = (locs[i].hourly.wind_direction_10m[t] || 0) * Math.PI / 180;
        sg[i] = sp;
        ug[i] = -sp * Math.sin(dir);
        vg[i] = -sp * Math.cos(dir);
      }
      speedT.push(sg); uT.push(ug); vT.push(vg);
    }
    document.getElementById('slider').max = String(nT - 1);
    document.getElementById('status').style.display = 'none';
    drawField();
    resetParts();
    requestAnimationFrame(tick);
    setWhen();
  }).catch(function (e) {
    document.getElementById('status').textContent =
      'Could not load the wind field (' + e.message + '). Pull down in the app to retry.';
  });
}

function setWhen() {
  var el = document.getElementById('when');
  if (!times.length) return;
  if (step === 0) { el.textContent = 'Now'; return; }
  var d = new Date(times[step] + (times[step].indexOf('Z') > -1 ? '' : ':00Z'));
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  el.textContent = days[d.getUTCDay()] + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':00';
}

document.getElementById('slider').addEventListener('input', function (e) {
  step = Number(e.target.value) || 0;
  drawField();
  setWhen();
});

// touch probe: hold a finger on the map to read the wind there
var probe = document.getElementById('probe');
function showProbe(x, y) {
  if (!speedT) return;
  var mph = sample(speedT, step, latOf(y), lonOf(x));
  probe.style.display = 'block';
  probe.style.left = x + 'px';
  probe.style.top = y + 'px';
  probe.textContent = Math.round(mph) + ' mph';
}
document.getElementById('wrap').addEventListener('pointerdown', function (e) {
  if (e.target.id === 'slider') return;
  showProbe(e.clientX, e.clientY);
});
document.getElementById('wrap').addEventListener('pointermove', function (e) {
  if (probe.style.display === 'block' && e.buttons) showProbe(e.clientX, e.clientY);
});
window.addEventListener('pointerup', function () { probe.style.display = 'none'; });

// legend
(function () {
  var leg = document.getElementById('legend');
  [10, 20, 30, 40, 50, 60, 75, 95].forEach(function (mph) {
    var c = colorFor(mph);
    var d = document.createElement('div');
    d.className = 'leg';
    d.style.background = 'rgb(' + c.map(Math.round).join(',') + ')';
    d.textContent = mph;
    leg.appendChild(d);
  });
})();

window.addEventListener('resize', function () { size(); if (speedT) { drawField(); resetParts(); } });
size();
load();
</script>
</body>
</html>`;
}
