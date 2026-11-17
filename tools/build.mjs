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
const BBOX = '47.45,7.45,49.85,10.55';
const RE = '(^|;) *A ?(8|81|831) *(;|$)';
const QUERY = `[out:json][timeout:300];way["highway"="motorway"]["ref"~"${RE}"](${BBOX})->.w;(.w;node["highway"="milestone"](around.w:60););out body geom;`;
async function overpass() {
  for (let round = 0; round < 2; round++) {
    for (const url of ENDPOINTS) {
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 240000);
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(QUERY), signal: ctl.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Betriebskilometer-Build/1.0 (betriebskilometer.vercel.app)', 'Accept': 'application/json' } });
        clearTimeout(to);
        if (!r.ok) { console.log('Overpass', url, 'HTTP', r.status); continue; }
        const j = await r.json();
        const n = (j.elements || []).length;
        console.log('Overpass', url, n, 'Elemente');
        if (n > 500) return j;
      } catch (e) { console.log('Overpass', url, 'Fehler', e.name === 'AbortError' ? 'Zeitüberschreitung' : e.message); }
    }
  }
  return null;
}
function compact(j) {
  const ways = [], ms = [];
  for (const el of j.elements) {
    if (el.type === 'way' && el.geometry) {
      const t = el.tags || {};
      ways.push([el.id, t.ref || '', t.oneway || '', t.destination || '', el.nodes, el.geometry.flatMap(g => [Math.round(g.lat * 1e6), Math.round(g.lon * 1e6)])]);
    } else if (el.type === 'node' && el.tags && el.tags.highway === 'milestone') {
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
