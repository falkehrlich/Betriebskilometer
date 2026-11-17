# Betriebskilometer

Web-App „Betriebs-Kilometer auf Autobahnen“ (Prototyp): GPS-Position → Betriebs-km für A 8, A 81 und A 831.

- Statische Seite (`index.html`), keine Build-Schritte
- Hosting: Vercel (automatisches Deployment bei jedem Push auf `main`)
- Daten: BASt BISStra (CC BY 4.0), OpenStreetMap (ODbL), eigene Kalibrierpunkte im Browser (localStorage)
- Installierbar als App (Manifest + Service Worker), GPS benötigt HTTPS

Quelle der Datei: `betriebs-km-autobahn.html` aus `Webanwendungen\Betr.-km Generator`.

## Werkseinstellung: geprüfte Referenzpunkte (`km-referenz.json`)

Die Datei enthält die vor Ort geprüften **km-Tafeln (alle 500 m)** und **SBA-Standorte** für A 8, A 81 und A 831.
Alle Tools (Betriebskilometer, später Mängelmelder und RSA-Musterplangenerator) rechnen mit diesen Punkten.

- Vorrang: eigene Punkte im Browser (Umkreis 100 m) → Werkseinstellung → OSM-Tafeln
- Die App lädt online immer die aktuelle `km-referenz.json`; eine Kopie ist zusätzlich in `index.html` eingebaut (offline / lokal)
- Abrufbar für andere Tools: `https://betriebskilometer.vercel.app/km-referenz.json` (CORS freigegeben)

**Ablauf beim Erfassen**
1. Vor Ort an jeder Tafel „km-Tafel jetzt“ tippen – der Wert ist auf die nächste 500-m-Tafel vorbelegt, nur bestätigen.
2. SBA-Standorte über „SBA-Standort in Karte setzen“ erfassen.
3. Menü → „Export JSON“.
4. Übernehmen: `python3 tools/merge_referenz.py betriebs-km_kalibrierung_JJJJ-MM-TT.json`, dann committen und pushen.
   Gleicher km-Wert im Umkreis von 30 m wird durch die neue Messung ersetzt.

Format je Punkt: `{"lat", "lon", "m" (Meter), "ref" ("A 8"), "label", "src" ("tafel"|"sba"), "erfasst", "acc"}`.

## OSM-Schnappschuss (`osm-achsen.json`)

Beim Veröffentlichen lädt `tools/build.mjs` die Achsen und km-Tafeln der A 8, A 81 und A 831 (BW) einmal von Overpass
und legt sie als `osm-achsen.json` neben die App. Die App nutzt diesen Schnappschuss und fragt Overpass nur noch außerhalb
des Gebiets ab. Ist Overpass beim Build nicht erreichbar, wird der zuletzt veröffentlichte Schnappschuss übernommen.
Aktualisieren: neu veröffentlichen (Push oder „Redeploy“ in Vercel).
