// Vercel-Build: statische Dateien nach dist/ kopieren und einen OSM-Schnappschuss der
// A 8, A 81 und A 831 in Baden-Württemberg erzeugen (Achsen + km-Tafeln).
// So muss die App unterwegs nicht mehr auf die oft überlasteten Overpass-Server warten.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
for (const f of fs.readdirSync(ROOT)) {
  if (/\.(html|js|json|webmanifest|png|ico|svg)$/i.test(f) && !['package.json', 'vercel.json', 'package-lock.json'].includes(f)) {
    fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
  }
}
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const BBOX = [47.45, 7.45, 49.85, 10.55];
const RE = '(^|;) *A ?(8|81|831) *(;|$)';
const HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Betriebskilometer-Build/1.1 (+https://betriebskilometer.vercel.app)', 'Referer': 'https://betriebskilometer.vercel.app/' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ask(query, label) {
  for (let round = 0; round < 4; round++) {
    for (const url of ENDPOINTS) {
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 90000);
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), signal: ctl.signal, headers: HEADERS });
        clearTimeout(to);
        if (!r.ok) { console.log(label, url.split('/')[2], 'HTTP', r.status); continue; }
        const j = await r.json();
        if (j.remark && /runtime error|timeout/i.test(j.remark)) { console.log(label, url.split('/')[2], 'Abbruch:', j.remark.slice(0, 80)); continue; }
        console.log(label, url.split('/')[2], (j.elements || []).length, 'Elemente');
        return j;
      } catch (e) { console.log(label, url.split('/')[2], e.name === 'AbortError' ? 'Zeitüberschreitung' : e.message); }
    }
    await sleep(15000 * (round + 1));
  }
  return null;
}
// Postpass (Geofabrik, PostGIS-SQL auf OSM-Daten) – Alternative, wenn Overpass überlastet ist
const POSTPASS = 'https://postpass.geofabrik.de/api/0.2/interpreter';
async function pp(sql, label) {
  for (let round = 0; round < 3; round++) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 180000);
      const r = await fetch(POSTPASS, { method: 'POST', body: 'data=' + encodeURIComponent(sql), signal: ctl.signal, headers: HEADERS });
      clearTimeout(to);
      if (!r.ok) { console.log(label, 'Postpass HTTP', r.status, (await r.text()).slice(0, 160)); await sleep(20000); continue; }
      const j = await r.json(); console.log(label, 'Postpass', (j.features || []).length, 'Objekte'); return j;
    } catch (e) { console.log(label, 'Postpass', e.name === 'AbortError' ? 'Zeitüberschreitung' : e.message); await sleep(20000); }
  }
  return null;
}
async function postpass() {
  const env = `ST_MakeEnvelope(${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]},4326)`;
  const lines = await pp(`SELECT osm_id, tags, geom FROM postpass_line WHERE tags->>'highway'='motorway' AND tags->>'ref' ~ '${RE}' AND geom && ${env}`, 'Achsen');
  if (!lines || !(lines.features || []).length) return null;
  const pts = await pp(`SELECT osm_id, tags, geom FROM postpass_point WHERE tags->>'highway'='milestone' AND geom && ${env}`, 'Tafeln');
  if (!pts) return null;
  const nid = new Map(); let next = -1;
  const node = (lon, lat) => { const k = lat.toFixed(7) + ',' + lon.toFixed(7); if (!nid.has(k)) nid.set(k, next--); return nid.get(k); };
  const tagsOf = f => { const t = (f.properties || {}).tags; return typeof t === 'string' ? JSON.parse(t) : (t || {}); };
  const els = [];
  for (const f of lines.features) {
    const g = f.geometry; if (!g) continue;
    const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    parts.forEach((c, i) => els.push({ type: 'way', id: Number((f.properties || {}).osm_id) * 10 + i, tags: tagsOf(f),
      nodes: c.map(([lon, lat]) => node(lon, lat)), geometry: c.map(([lon, lat]) => ({ lat, lon })) }));
  }
  for (const f of pts.features) {
    const g = f.geometry; if (!g || g.type !== 'Point') continue;
    els.push({ type: 'node', id: Number((f.properties || {}).osm_id), lat: g.coordinates[1], lon: g.coordinates[0], tags: tagsOf(f) });
  }
  return { elements: els, osm3s: { timestamp_osm_base: new Date().toISOString() } };
}
async function overpass() {
  // 1) Achsen (leicht): nur Autobahn-Wege mit passender Nummer
  const bb = BBOX.join(',');
  const wj = await ask(`[out:json][timeout:120];way["highway"="motorway"]["ref"~"${RE}"](${bb});out body geom;`, 'Achsen');
  if (!wj || !(wj.elements || []).length) return null;
  // 2) km-Tafeln: kachelweise (0,25°) nur dort, wo die Achsen verlaufen
  const tiles = new Set();
  for (const w of wj.elements) for (const g of (w.geometry || [])) tiles.add(Math.floor(g.lat / 0.25) + ':' + Math.floor(g.lon / 0.25));
  console.log('Kacheln für km-Tafeln:', tiles.size);
  const els = [...wj.elements]; let fails = 0;
  for (const t of tiles) {
    const [a, b] = t.split(':').map(Number);
    const tb = [a * 0.25, b * 0.25, a * 0.25 + 0.25, b * 0.25 + 0.25].map(v => v.toFixed(2)).join(',');
    const mj = await ask(`[out:json][timeout:60];node["highway"="milestone"](${tb});out body;`, 'Tafeln ' + tb);
    if (mj) els.push(...(mj.elements || [])); else fails++;
    await sleep(1500);
  }
  if (fails > tiles.size / 3) { console.log('Zu viele Kacheln ohne Antwort:', fails); return null; }
  return { elements: els, osm3s: wj.osm3s };
}
function compact(j) {
  const ways = [], ms = [];
  // Raster der Achspunkte, um nur km-Tafeln an diesen Autobahnen zu behalten
  const grid = new Map(); const key = (la, lo) => Math.floor(la / 0.002) + ':' + Math.floor(lo / 0.003);
  for (const el of j.elements) if (el.type === 'way' && el.geometry) {
    const g = el.geometry; for (let i = 0; i < g.length; i++) {
      const p = g[i], q = g[i + 1] || p; const n = Math.max(1, Math.ceil(Math.hypot(q.lat - p.lat, (q.lon - p.lon) * 0.66) / 0.0004));
      for (let k = 0; k < n; k++) { const la = p.lat + (q.lat - p.lat) * k / n, lo = p.lon + (q.lon - p.lon) * k / n; const kk = key(la, lo); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([la, lo]); }
    }
  }
  const near = (la, lo) => { const a = Math.floor(la / 0.002), b = Math.floor(lo / 0.003);
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (const [pa, po] of (grid.get((a + x) + ':' + (b + y)) || []))
      if (Math.hypot((pa - la) * 111320, (po - lo) * 73500) < 80) return true; return false; };
  for (const el of j.elements) {
    if (el.type === 'way' && el.geometry) {
      const t = el.tags || {};
      ways.push([el.id, t.ref || '', t.oneway || '', t.destination || '', el.nodes, el.geometry.flatMap(g => [Math.round(g.lat * 1e6), Math.round(g.lon * 1e6)])]);
    } else if (el.type === 'node' && el.tags && el.tags.highway === 'milestone' && near(el.lat, el.lon)) {
      const t = el.tags;
      ms.push([el.id, Math.round(el.lat * 1e6), Math.round(el.lon * 1e6), t.distance || t['railway:position'] || '', t.ref || '', t['ref:highway'] || '']);
    }
  }
  return { v: 1, stand: (j.osm3s && j.osm3s.timestamp_osm_base) || new Date().toISOString(), quelle: 'OpenStreetMap-Mitwirkende (ODbL)', ways, ms };
}
const out = path.join(DIST, 'osm-achsen.json');
let j = await postpass();
if (!j) j = await overpass();
if (j) {
  const c = compact(j);
  fs.writeFileSync(out, JSON.stringify(c));
  console.log('osm-achsen.json:', c.ways.length, 'Achsen,', c.ms.length, 'Tafeln,', fs.statSync(out).size, 'Bytes, Stand', c.stand);
  // Auswertung je Autobahn (nur Protokoll): Fahrbahnlänge, Tafeln, Abdeckung
  try {
    const st = {}; const rk = r => (/831/.test(r) ? 'A 831' : /81/.test(r) && /(^|;) *A ?8 *(;|$)/.test(r) ? 'A 8/A 81' : /81/.test(r) ? 'A 81' : 'A 8');
    const segs = [];
    for (const w of c.ways) { const g = w[5], k = rk(w[1]); st[k] = st[k] || { km: 0, n: 0, ohne: 0, vals: [] };
      for (let i = 0; i + 3 < g.length; i += 2) { const la = g[i] / 1e6, lo = g[i + 1] / 1e6, la2 = g[i + 2] / 1e6, lo2 = g[i + 3] / 1e6;
        st[k].km += Math.hypot((la2 - la) * 111.32, (lo2 - lo) * 73.5); segs.push([la, lo, k]); } }
    for (const m of c.ms) { const la = m[1] / 1e6, lo = m[2] / 1e6; let best = null, bd = 1e9;
      for (const s of segs) { const d = Math.hypot((s[0] - la) * 111320, (s[1] - lo) * 73500); if (d < bd) { bd = d; best = s[2]; } }
      if (!best) continue; st[best].n++; const v = parseFloat(String(m[3]).replace(',', '.')); if (isNaN(v)) st[best].ohne++; else st[best].vals.push(v); }
    // Liste der Tafeln je Autobahn (für die Abdeckungsliste); gemeinsame Strecke zählt zur A 8 (dort gilt deren Kilometrierung)
    const ab = { stand: c.stand, refs: {} };
    for (const m of c.ms) { const la = m[1] / 1e6, lo = m[2] / 1e6; let best = null, bd = 1e9;
      for (const s of segs) { const d = Math.hypot((s[0] - la) * 111320, (s[1] - lo) * 73500); if (d < bd) { bd = d; best = s[2]; } }
      const v = parseFloat(String(m[3]).replace(',', '.')); if (!best || isNaN(v)) continue;
      const own = String(m[4] || m[5] || ''); const k = best === 'A 8/A 81' ? 'A 8' : best;
      if (own && !new RegExp('(^|;) *' + k.replace(' ', ' ?') + ' *(;|$)').test(own)) continue;   // Tafel einer anderen Autobahn am Knoten
      (ab.refs[k] = ab.refs[k] || []).push([v, +la.toFixed(5), +lo.toFixed(5)]); }
    for (const k in ab.refs) ab.refs[k].sort((x, y) => x[0] - y[0]);
    fs.writeFileSync(path.join(DIST, 'abdeckung.json'), JSON.stringify(ab));
    // Lücken (> 2 km zwischen zwei bekannten km-Werten) ins Protokoll
    for (const k in ab.refs) { const L = ab.refs[k];
      for (let i = 0; i + 1 < L.length; i++) { const A = L[i], B = L[i + 1]; const g = B[0] - A[0];
        if (g > 2) console.log('LUECKE|' + k + '|' + A[0] + '|' + B[0] + '|' + A[1] + ',' + A[2] + '|' + B[1] + ',' + B[2]); } }
    for (const [k, v] of Object.entries(st)) console.log('Auswertung', k + ':', Math.round(v.km), 'km Fahrbahn (beide Richtungen),', v.n, 'Tafeln =', (v.n / Math.max(1, v.km) * 10).toFixed(1), 'je 10 km,', v.ohne, 'ohne km-Wert, km-Bereich', v.vals.length ? Math.min(...v.vals) + '–' + Math.max(...v.vals) : '–');
  } catch (e) { console.log('Auswertung fehlgeschlagen', e.message); }
} else {
  // Overpass nicht erreichbar: letzten veröffentlichten Schnappschuss übernehmen
  try {
    const r = await fetch('https://betriebskilometer.vercel.app/osm-achsen.json');
    if (r.ok) { fs.writeFileSync(out, Buffer.from(await r.arrayBuffer())); console.log('Overpass nicht erreichbar – letzter Schnappschuss übernommen'); }
    else console.log('Kein Schnappschuss verfügbar (HTTP', r.status, ') – App lädt live von Overpass');
  } catch (e) { console.log('Kein Schnappschuss verfügbar – App lädt live von Overpass'); }
}
