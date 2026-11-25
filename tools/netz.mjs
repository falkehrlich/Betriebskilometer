// Netzdaten der Autobahn GmbH, Niederlassung Südwest: je Autobahn eine Datei netz/<A5>.json
// mit OSM-Achsen und km-Tafeln (© OSM-Mitwirkende, ODbL), BKG-Kilometrierung (© BKG, dl-de/by-2-0)
// und ASB-Abschnitten/Ästen (BASt BISStra, CC BY 4.0, aus werkdaten/asb/). Dazu netz/index.json.
// Gebiet: Baden-Württemberg (Landesgrenze aus OSM) + Strecken in RLP/Hessen laut autobahn.de (Betr.-km).
// Läuft als GitHub-Action „Netzdaten aktualisieren“.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const W = path.join(ROOT, 'werkdaten'), OUT = path.join(ROOT, 'netz');
const REFS = ['A 5', 'A 6', 'A 8', 'A 61', 'A 65', 'A 67', 'A 81', 'A 98', 'A 650', 'A 656', 'A 659', 'A 831', 'A 861', 'A 864'];
// Strecken außerhalb Baden-Württembergs (Autobahnmeistereien Ruchheim, Kandel, Mannheim) – Betr.-km von/bis
const EXTRA = { 'A 5': [[546.5, 582.5]], 'A 6': [[500, 510], [555.5, 567.1]], 'A 61': [[351, 389.1]], 'A 65': [[100, 159.25]],
  'A 650': [[0, 14.2]], 'A 67': [[47.8, 59.5]], 'A 659': [[8.0, 14.6]] };
const BBOX = [47.40, 7.30, 50.00, 10.60];   // s, w, n, e
const HEADERS = { 'User-Agent': 'Betriebskilometer-Netzdaten (github.com/falkehrlich/Betriebskilometer)', 'Content-Type': 'application/x-www-form-urlencoded' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fkey = r => r.replace(' ', '');
const RE = '(^|;) *A ?(' + REFS.map(r => r.slice(2)).join('|') + ') *(;|$)';
const refsOf = s => String(s || '').split(';').map(x => x.trim().replace(/^A\s*/, 'A ')).filter(x => REFS.includes(x));
const hav = (a, b, c, d) => { const R = 6371000, t = Math.PI / 180, x = (d - b) * t * Math.cos((a + c) / 2 * t), y = (c - a) * t; return R * Math.hypot(x, y); };

// ---------- Netzabfragen ----------
const POSTPASS = 'https://postpass.geofabrik.de/api/0.2/interpreter';
async function pp(sql, label) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(POSTPASS, { method: 'POST', body: 'data=' + encodeURIComponent(sql), headers: HEADERS, signal: AbortSignal.timeout(240000) });
      if (!r.ok) { console.log(label, 'Postpass HTTP', r.status, (await r.text()).slice(0, 200)); await sleep(20000); continue; }
      const j = await r.json(); console.log(label, 'Postpass', (j.features || []).length); return j;
    } catch (e) { console.log(label, 'Postpass', e.message); await sleep(20000); }
  }
  return null;
}
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function op(q, label) {
  for (let i = 0; i < 6; i++) { const url = OVERPASS[i % OVERPASS.length];
    try { const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: HEADERS, signal: AbortSignal.timeout(240000) });
      if (r.ok) { const j = await r.json(); console.log(label, 'Overpass', (j.elements || []).length); return j; }
      console.log(label, url, 'HTTP', r.status); } catch (e) { console.log(label, url, e.message); }
    await sleep(15000); }
  return null;
}
const tagsOf = f => { const t = (f.properties || {}).tags; return typeof t === 'string' ? JSON.parse(t) : (t || {}); };

// Landesgrenze Baden-Württemberg (OSM-Relation 62611) als Ringe [[lat,lon],...]
function assemble(segs) {   // Wegstücke zu geschlossenen Ringen verbinden
  const rings = []; const k = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  segs = segs.map(s => s.slice());
  while (segs.length) {
    let ring = segs.shift(); let grew = true;
    while (grew && k(ring[0]) !== k(ring[ring.length - 1])) { grew = false;
      for (let i = 0; i < segs.length; i++) { const s = segs[i];
        if (k(s[0]) === k(ring[ring.length - 1])) { ring = ring.concat(s.slice(1)); }
        else if (k(s[s.length - 1]) === k(ring[ring.length - 1])) { ring = ring.concat(s.slice(0, -1).reverse()); }
        else continue; segs.splice(i, 1); grew = true; break; } }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}
function dp(pts, tol) { if (pts.length < 3) return pts; const [a, b] = [pts[0], pts[pts.length - 1]]; let im = 0, dm = 0;
  for (let i = 1; i < pts.length - 1; i++) { const p = pts[i]; const dx = b[1] - a[1], dy = b[0] - a[0]; const L = Math.hypot(dx, dy) || 1e-12;
    const d = Math.abs(dy * (p[1] - a[1]) - dx * (p[0] - a[0])) / L; if (d > dm) { dm = d; im = i; } }
  return dm > tol ? dp(pts.slice(0, im + 1), tol).slice(0, -1).concat(dp(pts.slice(im), tol)) : [a, b]; }
async function grenze() {
  const old = path.join(W, 'gebiet.json');
  const j = await op('[out:json][timeout:180];rel(62611);out geom;', 'Landesgrenze');
  if (j && j.elements && j.elements[0]) {
    const segs = j.elements[0].members.filter(m => m.type === 'way' && (m.role === 'outer' || m.role === '') && m.geometry).map(m => m.geometry.map(g => [g.lat, g.lon]));
    const rings = assemble(segs).map(r => { const h = r.length >> 1; return dp(r.slice(0, h + 1), 0.0015).concat(dp(r.slice(h), 0.0015).slice(1)); }).map(r => r.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]));
    console.log('Grenze: Stücke', segs.length, 'Ringe', rings.map(r => r.length).join('/'));
    if (rings.length && rings.reduce((s, r) => s + r.length, 0) > 200) { console.log('Landesgrenze:', rings.length, 'Ringe'); return rings; }
  }
  if (fs.existsSync(old)) { console.log('Landesgrenze aus letzter Datei'); return JSON.parse(fs.readFileSync(old, 'utf8')).bw; }
  throw new Error('Landesgrenze nicht verfügbar');
}
function inRings(rings, la, lo) { let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [ay, ax] = r[i], [by, bx] = r[j];
    if ((ay > la) !== (by > la) && lo < (bx - ax) * (la - ay) / (by - ay) + ax) c = !c; }
  return c; }

async function bkgFetch() {
  const base = 'https://services2.arcgis.com/jUpNdisbWqRpMo35/arcgis/rest/services/KmBAB/FeatureServer/0/query';
  const res = []; let off = 0; const list = REFS.map(r => "'" + fkey(r) + "'").join(',');
  for (let page = 0; page < 40; page++) {
    const q = new URLSearchParams({ where: `Bez IN (${list})`, geometry: [BBOX[1], BBOX[0], BBOX[3], BBOX[2]].join(','), geometryType: 'esriGeometryEnvelope',
      inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'Bez,Kilometer', outSR: '4326', returnGeometry: 'true',
      orderByFields: 'OBJECTID', resultOffset: String(off), resultRecordCount: '1000', f: 'json' });
    const r = await fetch(base + '?' + q, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('BKG HTTP ' + r.status);
    const jj = await r.json(); if (jj.error) throw new Error(jj.error.message || 'BKG-Fehler');
    const fs_ = jj.features || [];
    for (const f of fs_) { const a = f.attributes, g = f.geometry; if (!g || a.Kilometer == null) continue;
      res.push([Math.round(g.y * 1e6), Math.round(g.x * 1e6), Math.round(a.Kilometer * 1000), String(a.Bez).replace(/^A\s*/, 'A ')]); }
    if (!jj.exceededTransferLimit && fs_.length < 1000) break; off += fs_.length;
  }
  return res;
}
async function osm() {
  const env = `ST_MakeEnvelope(${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]},4326)`;
  const L = await pp(`SELECT osm_id, tags, geom FROM postpass_line WHERE tags->>'highway'='motorway' AND tags->>'ref' ~ '${RE}' AND geom && ${env}`, 'Achsen');
  const P = L && (L.features || []).length ? await pp(`SELECT osm_id, tags, geom FROM postpass_point WHERE tags->>'highway'='milestone' AND geom && ${env}`, 'Tafeln') : null;
  if (L && P) {
    const ways = [], ms = []; const nid = new Map(); let next = -1;
    const node = (lon, lat) => { const k = lat.toFixed(7) + ',' + lon.toFixed(7); if (!nid.has(k)) nid.set(k, next--); return nid.get(k); };
    for (const f of L.features) { const g = f.geometry; if (!g) continue; const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      parts.forEach((c, i) => ways.push({ id: Number(f.properties.osm_id) * 10 + i, tags: tagsOf(f), nodes: c.map(([lo, la]) => node(lo, la)), geom: c.map(([lo, la]) => [la, lo]) })); }
    for (const f of P.features) { const g = f.geometry; if (g && g.type === 'Point') ms.push({ id: Number(f.properties.osm_id), lat: g.coordinates[1], lon: g.coordinates[0], tags: tagsOf(f) }); }
    return { ways, ms, stand: new Date().toISOString() };
  }
  const bb = BBOX.join(',');
  const j = await op(`[out:json][timeout:300];(way["highway"="motorway"]["ref"~"${RE}"](${bb}););out body geom;`, 'Achsen');
  if (!j) throw new Error('OSM nicht erreichbar');
  const ways = j.elements.filter(e => e.type === 'way').map(e => ({ id: e.id, tags: e.tags || {}, nodes: e.nodes, geom: e.geometry.map(g => [g.lat, g.lon]) }));
  const tiles = new Set(); ways.forEach(w => w.geom.forEach(([la, lo]) => tiles.add(Math.floor(la / 0.25) + ':' + Math.floor(lo / 0.25))));
  const ms = [];
  for (const t of tiles) { const [a, b] = t.split(':').map(Number);
    const mj = await op(`[out:json][timeout:90];node["highway"="milestone"](${[a * 0.25, b * 0.25, a * 0.25 + 0.25, b * 0.25 + 0.25].join(',')});out body;`, 'Tafeln ' + t);
    if (mj) mj.elements.forEach(e => ms.push({ id: e.id, lat: e.lat, lon: e.lon, tags: e.tags || {} })); await sleep(1500); }
  return { ways, ms, stand: (j.osm3s && j.osm3s.timestamp_osm_base) || new Date().toISOString() };
}

// ---------- Ablauf ----------
const rings = await grenze();
let BKG = null; try { BKG = await bkgFetch(); } catch (e) { console.log('BKG:', e.message); }
const bkgFile = path.join(W, 'bkg-suedwest.json');
if (!BKG || !BKG.length) { if (fs.existsSync(bkgFile)) BKG = JSON.parse(fs.readFileSync(bkgFile, 'utf8')); else throw new Error('keine BKG-Daten'); }
const byRef = {}; for (const b of BKG) (byRef[b[3]] = byRef[b[3]] || []).push(b);
const inBW = (la, lo) => inRings(rings, la, lo);
function inArea(ref, la, lo) {
  if (inBW(la, lo)) return true;
  const ex = EXTRA[ref]; if (!ex) return false;
  for (const b of byRef[ref] || []) { const km = b[2] / 1000;
    if (ex.some(([f, t]) => km >= f - 0.3 && km <= t + 0.3) && hav(la, lo, b[0] / 1e6, b[1] / 1e6) < 1500) return true; }
  return false;
}
const bkgArea = BKG.filter(b => inArea(b[3], b[0] / 1e6, b[1] / 1e6));
fs.writeFileSync(path.join(W, 'gebiet.json'), JSON.stringify({ hinweis: 'Gebiet Niederlassung Südwest: Landesgrenze BW (© OSM-Mitwirkende, ODbL) + Strecken außerhalb laut autobahn.de', bw: rings, extra: EXTRA }));
fs.writeFileSync(bkgFile, JSON.stringify(bkgArea));
console.log('BKG im Gebiet:', bkgArea.length, JSON.stringify(Object.fromEntries(REFS.map(r => [r, bkgArea.filter(b => b[3] === r).length]))));

const O = await osm();
fs.mkdirSync(OUT, { recursive: true });
const index = { v: 1, stand: O.stand, refs: {} };
for (const ref of REFS) {
  const ways = O.ways.filter(w => refsOf(w.tags.ref).includes(ref) && w.geom.some(([la, lo], i) => (i % 4 === 0 || i === w.geom.length - 1) && inArea(ref, la, lo)));
  // km-Tafeln nahe an diesen Achsen (Raster)
  const grid = new Map(); const gk = (la, lo) => Math.floor(la / 0.002) + ':' + Math.floor(lo / 0.003);
  for (const w of ways) for (let i = 0; i < w.geom.length; i++) { const p = w.geom[i], q = w.geom[i + 1] || p; const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], (q[1] - p[1]) * 0.66) / 0.0004));
    for (let k = 0; k < n; k++) { const la = p[0] + (q[0] - p[0]) * k / n, lo = p[1] + (q[1] - p[1]) * k / n; const kk = gk(la, lo); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([la, lo]); } }
  const near = (la, lo) => { const a = Math.floor(la / 0.002), b = Math.floor(lo / 0.003);
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (const [pa, po] of (grid.get((a + x) + ':' + (b + y)) || [])) if (hav(pa, po, la, lo) < 80) return true; return false; };
  const ms = O.ms.filter(m => near(m.lat, m.lon));
  const bkg = bkgArea.filter(b => b[3] === ref);
  const asbF = path.join(W, 'asb', fkey(ref) + '.json'); const asb = fs.existsSync(asbF) ? JSON.parse(fs.readFileSync(asbF, 'utf8')) : [];
  if (!ways.length && !asb.length) { console.log(ref, 'keine Daten im Gebiet'); continue; }
  const file = { v: 1, ref, stand: O.stand, quelle: 'OpenStreetMap-Mitwirkende (ODbL); BKG (2025) dl-de/by-2-0; BASt BISStra 2026q2 (CC BY 4.0)',
    ways: ways.map(w => [w.id, w.tags.ref || '', w.tags.oneway || '', w.tags.destination || '', w.nodes, w.geom.flatMap(([la, lo]) => [Math.round(la * 1e6), Math.round(lo * 1e6)])]),
    ms: ms.map(m => [m.id, Math.round(m.lat * 1e6), Math.round(m.lon * 1e6), m.tags.distance || m.tags['railway:position'] || '', m.tags.ref || '', m.tags['ref:highway'] || '']),
    bkg, asb };
  fs.writeFileSync(path.join(OUT, fkey(ref) + '.json'), JSON.stringify(file));
  // Index: grobe Punkte (ca. 1 km), km-Bereich, Netzknoten
  const pts = new Map();
  for (const w of ways) for (const [la, lo] of w.geom) { const k = Math.round(la / 0.009) + ':' + Math.round(lo / 0.013); if (!pts.has(k)) pts.set(k, [+la.toFixed(3), +lo.toFixed(3)]); }
  for (const a of asb.filter(a => a.t !== 'Ast')) for (const [la, lo] of a.p) { const k = Math.round(la / 0.009) + ':' + Math.round(lo / 0.013); if (!pts.has(k)) pts.set(k, [+la.toFixed(3), +lo.toFixed(3)]); }
  const kms = bkg.map(b => b[2] / 1000).concat(ms.map(m => parseFloat(String(m.tags.distance || '').replace(',', '.'))).filter(Number.isFinite));
  const nk = [...new Set(asb.flatMap(a => [a.k.slice(0, 7), a.k.slice(8, 15)]))];
  index.refs[ref] = { f: fkey(ref), km: kms.length ? [Math.floor(Math.min(...kms)) - 1, Math.ceil(Math.max(...kms)) + 1] : null, p: [...pts.values()], nk,
    n: { achsen: ways.length, tafeln: ms.length, bkg: bkg.length, abschnitte: asb.filter(a => a.t !== 'Ast').length, aeste: asb.filter(a => a.t === 'Ast').length } };
  console.log(ref, JSON.stringify(index.refs[ref].n), 'km', JSON.stringify(index.refs[ref].km), 'Punkte', pts.size);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
// Index in index.html einsetzen (zwischen /*NETZ*/ und /*NETZ_END*/)
const f = path.join(ROOT, 'index.html'); let h = fs.readFileSync(f, 'utf8'); const a = h.indexOf('/*NETZ*/'), b = h.indexOf('/*NETZ_END*/');
if (a > 0 && b > a) { h = h.slice(0, a + 8) + JSON.stringify(index) + h.slice(b); fs.writeFileSync(f, h); console.log('index.html: Netz-Index eingesetzt'); }
