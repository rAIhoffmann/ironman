# Hardtsee Temperatur Dashboard

Diese kleine Website zeigt:

- den Verlauf der Wassertemperatur des Hardtsees in Ubstadt-Weiher,
- tägliche Messpunkte um 06:00 Uhr,
- einen Countdown bis zum IRONMAN 70.3 Kraichgau.

## Quelle

Die Temperatur wird täglich von dieser Seite gelesen:

- https://www.scubw.de/wetter.html

Gesucht wird der Wert **„Temperatur Wasser“**.

## So bringst du die Seite live zum Laufen

### Variante 1: GitHub Pages + GitHub Actions

1. Neues GitHub-Repository anlegen.
2. Alle Dateien aus diesem Ordner hochladen.
3. In GitHub unter **Settings → Pages** als Quelle **Deploy from a branch** wählen.
4. Branch `main` und Ordner `/ (root)` auswählen.
5. Unter **Actions** prüfen, ob Workflows erlaubt sind.
6. Der Workflow läuft täglich um **04:00 UTC**, das entspricht **06:00 Uhr in Deutschland während der Sommerzeit**.
7. Testweise unter **Actions** den Workflow **Update Hardtsee water temperature** manuell starten.

### Wichtiger Hinweis zur Uhrzeit

Die hinterlegte GitHub-Cron-Zeit ist aktuell auf Sommerzeit ausgelegt. Im Winter wäre für exakt 06:00 Uhr Berlin eine Umstellung auf `0 5 * * *` nötig.
Wenn du es ganz exakt über Sommer-/Winterzeit hinweg willst, ist ein kleiner Server-Cronjob oft sauberer als GitHub Actions.

## Lokale Vorschau

Einfach `index.html` im Browser öffnen. Für lokale Fetch-Zugriffe ist ein kleiner Webserver besser, z. B.:

```bash
python3 -m http.server 8000
```

Dann im Browser `http://localhost:8000` öffnen.

## Parser-Hinweis

Falls der Surfclub die HTML-Struktur der Wetterseite ändert, muss möglicherweise nur die Datei `scripts/update-water-temp.mjs` im Bereich `extractTemperature()` angepasst werden.
