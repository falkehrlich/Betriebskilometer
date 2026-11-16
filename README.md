# Betriebskilometer

Web-App „Betriebs-Kilometer auf Autobahnen“ (Prototyp): GPS-Position → Betriebs-km für A 8, A 81 und A 831.

- Statische Seite (`index.html`), keine Build-Schritte
- Hosting: Vercel (automatisches Deployment bei jedem Push auf `main`)
- Daten: BASt BISStra (CC BY 4.0), OpenStreetMap (ODbL), eigene Kalibrierpunkte im Browser (localStorage)
- Installierbar als App (Manifest + Service Worker), GPS benötigt HTTPS

Quelle der Datei: `betriebs-km-autobahn.html` aus `Webanwendungen\Betr.-km Generator`.
