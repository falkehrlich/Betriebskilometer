// Werkseinstellung erneuern: OSM-Achsen + km-Tafeln und BKG-Kilometrierung (A 8, A 81, A 831)
// holen, prüfen und fest in index.html einsetzen (zwischen /*SNAP*/ und /*SNAP_END*/).
// Läuft als GitHub-Action „Werkdaten aktualisieren“ – nur auf ausdrücklichen Start.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
execFileSync(process.execPath, [path.join(ROOT, 'tools/build.mjs')], { stdio: 'inherit' });
const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/osm-achsen.json'), 'utf8'));
const n = { ways: (d.ways || []).length, ms: (d.ms || []).length, bkg: (d.bkg || []).length };
console.log('Werkdaten:', JSON.stringify(n), 'Stand', d.stand);
if (n.ways < 200 || n.ms < 100 || n.bkg < 400) { console.error('Daten unvollständig – Werkseinstellung bleibt unverändert.'); process.exit(1); }
const snap = JSON.stringify({ v: d.v, stand: d.stand, quelle: d.quelle, bkgQuelle: d.bkgQuelle, ways: d.ways, ms: d.ms, bkg: d.bkg });
fs.mkdirSync(path.join(ROOT, 'werkdaten'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'werkdaten/achsen-bkg.json'), snap);
const f = path.join(ROOT, 'index.html'); let h = fs.readFileSync(f, 'utf8');
const a = h.indexOf('/*SNAP*/'), b = h.indexOf('/*SNAP_END*/');
if (a > 0 && b > a) { h = h.slice(0, a + 8) + snap + h.slice(b); fs.writeFileSync(f, h); console.log('index.html aktualisiert'); }
else console.log('index.html ohne SNAP-Marker – nur werkdaten/achsen-bkg.json geschrieben');
