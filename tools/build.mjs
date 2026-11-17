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
const j = await overpass();
if (j) {
  const c = compact(j);
  fs.writeFileSync(out, JSON.stringify(c));
  console.log('osm-achsen.json:', c.ways.length, 'Achsen,', c.ms.length, 'Tafeln,', fs.statSync(out).size, 'Bytes, Stand', c.stand);
} else {
  // Overpass nicht erreichbar: letzten veröffentlichten Schnappschuss übernehmen
  try {
    const r = await fetch('https://betriebskilometer.vercel.app/osm-achsen.json');
    if (r.ok) { fs.writeFileSync(out, Buffer.from(await r.arrayBuffer())); console.log('Overpass nicht erreichbar – letzter Schnappschuss übernommen'); }
    else console.log('Kein Schnappschuss verfügbar (HTTP', r.status, ') – App lädt live von Overpass');
  } catch (e) { console.log('Kein Schnappschuss verfügbar – App lädt live von Overpass'); }
}
