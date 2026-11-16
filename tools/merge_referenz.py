#!/usr/bin/env python3
"""Übernimmt Punkte aus einem App-Export (betriebs-km_kalibrierung_*.json) in km-referenz.json.

Aufruf:  python3 tools/merge_referenz.py export.json [weitere.json ...]
Regeln:  - übernommen werden Punkte mit Koordinaten, km-Wert und Autobahn
         - liegt schon ein Referenzpunkt mit gleichem km-Wert im Umkreis von 30 m, wird er ersetzt (neuere Messung)
         - km-Werte werden auf 1 m gerundet
"""
import json, math, sys, pathlib
REF = pathlib.Path(__file__).resolve().parent.parent / 'km-referenz.json'

def hav(a, b):
    R = 6371000; p1, p2 = math.radians(a['lat']), math.radians(b['lat'])
    dp = p2 - p1; dl = math.radians(b['lon'] - a['lon'])
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))

ref = json.loads(REF.read_text(encoding='utf-8')) if REF.exists() else []
neu = ersetzt = 0
for f in sys.argv[1:]:
    d = json.loads(pathlib.Path(f).read_text(encoding='utf-8'))
    pts = d.get('referenz') or [{'lat': c['lat'], 'lon': c['lon'], 'm': c['m'], 'ref': c.get('ref'), 'label': c.get('label'),
                                 'src': 'sba' if c.get('src') == 'sba' else 'tafel', 'erfasst': c.get('t'), 'acc': c.get('acc')}
                                for c in d.get('kalibrierung', [])]
    for p in pts:
        if p.get('lat') is None or p.get('m') is None or not p.get('ref'): continue
        p = {'lat': round(p['lat'], 7), 'lon': round(p['lon'], 7), 'm': int(round(p['m'])), 'ref': p['ref'],
             'label': p.get('label'), 'src': p.get('src', 'tafel'), 'erfasst': p.get('erfasst'), 'acc': p.get('acc')}
        alt = [r for r in ref if r['ref'] == p['ref'] and r['m'] == p['m'] and hav(r, p) < 30]
        for r in alt: ref.remove(r)
        ersetzt += bool(alt); neu += not alt
        ref.append(p)
ref.sort(key=lambda r: (r['ref'], r['m']))
REF.write_text(json.dumps(ref, ensure_ascii=False, indent=0), encoding='utf-8')
print(f'{neu} neu, {ersetzt} ersetzt, {len(ref)} Punkte in {REF.name}')
