# NotenLeser für Nextcloud

Web-Version des NotenLesers als Nextcloud-App. Noten (PDF und MuseScore) aus den eigenen Nextcloud-Dateien werden im Browser im Vollbild gelesen, systemweise geblättert und – bei MuseScore – abgespielt. Funktionsumfang und Bedienung entsprechen der Android-App.

## Funktionen

- **Öffnen**: über „NotenLeser“ in der Navigationsleiste (eigene Dateiauswahl für Datei oder Ordner) oder direkt in der Dateien-App über „In NotenLeser öffnen“ bei `.pdf`, `.mscz` und `.mscx`. MuseScore-Dateien öffnen dort per Klick direkt im NotenLeser. Die geöffnete Datei steht in der Adresse (`/apps/notenleser/?file=/Pfad/Lied.pdf`), Neuladen oder ein Lesezeichen öffnet sie wieder; die Startseite bietet „Weiterlesen“ für die zuletzt geöffnete Datei.
- **Ordner**: Der Ordner der geöffneten Datei ist automatisch die Notenmappe. Wischen nach oben/unten wechselt zur nächsten/vorherigen Datei, am Ende einer Datei geht es mit der nächsten weiter.
- **PDF**: Darstellung mit pdf.js. Die Systemerkennung (Port von `SystemDetector`) findet Notenzeilen, fasst sie zu Systemen zusammen und überspringt Seiten ohne Noten (Deckblätter).
- **MuseScore** (`.mscz`, `.mscx`, Format 2–4): Import und Notensatz mit der Notenschrift Leland laufen komplett im Browser (Port von `MuseScoreReader` und `ScoreEngraver`), inkl. Transposition, Wiederholungen, Volten, Dynamik, Liedtext usw.
- **Blättern**: Wischen ← → (Finger oder Maus) wechselt das System, mit zwei Fingern um alle sichtbaren Systeme; Mausrad/Touchpad blättert ebenfalls. Mehrere Systeme werden gleichzeitig gezeigt, wenn Platz ist, auch über Seitengrenzen. Markierung „Seite·System“ an jedem System.
- **Blätterpedale** (Bluetooth, als Tastatur verbunden) und Tastatur: Pfeil rechts/unten, Bild↓, Leertaste, Enter, „Nächster Titel“ → weiter; Pfeil links/oben, Bild↑, „Vorheriger Titel“ → zurück. Gehaltene Tasten blättern nur einmal.
- **Einstellungen** (⚙): eigene Stimme hervorheben (1.–6.), immer mindestens 2 Systeme, Blättern per Handbewegung vor der Kamera (Empfindlichkeit, Debug-Ansicht), Wiedergabetempo. Die Einstellungen werden als Nextcloud-Benutzereinstellungen gespeichert und gelten damit auf allen Geräten.
- **Bearbeiten**: Seitenweise Ansicht, in der Systeme durch Ziehen markiert, verschoben oder in der Höhe geändert werden (Zoom mit zwei Fingern oder Mausrad). Ausgangspunkt sind die automatisch erkannten Systeme. Gespeichert wird als `<Name>.systems.json` neben der Notendatei – dasselbe Format wie in der Android-App, beide Versionen nutzen also dieselben Markierungen.
- **Wiedergabe** (▶, nur MuseScore): kleiner Web-Audio-Synthesizer mit Klangfarben je Instrumentenfamilie, Tempo, Dynamik, Akzenten, Staccato, Haltebögen, Wiederholungen und Volten. Der klingende Takt wird markiert, die Ansicht blättert automatisch mit.
- **Vollbild**: Beim Öffnen von Noten wechselt der NotenLeser automatisch in den Vollbildmodus (in den Einstellungen abschaltbar). ⛶ in der Leiste oder die Taste **F** schalten jederzeit um. Der Bildschirm bleibt an, solange Noten offen sind (Wake Lock).
- **iPhone**: Safari kennt dort keinen Vollbildmodus für Webseiten. ⛶ öffnet stattdessen die Ansicht ohne Nextcloud-Kopfzeile (`/apps/notenleser/reader`). Über „Teilen → Zum Home-Bildschirm“ wird daraus ein eigenes App-Symbol, das den NotenLeser wie eine App im Vollbild startet (beim ersten Start einmal bei Nextcloud anmelden). ⌂ führt zurück zur normalen Nextcloud-Ansicht. Auf Android bietet Chrome über das Web-App-Manifest ebenfalls „Zum Startbildschirm hinzufügen“ an.

Die Kamerabilder werden nur im Browser zu einem groben Helligkeitsraster verrechnet, nie gespeichert oder übertragen. Kamerazugriff erlaubt der Browser nur über HTTPS.

## Installation

Voraussetzung: Nextcloud 30 bis 33.

1. Paket bauen (siehe unten) oder das Artefakt `notenleser-<version>.tar.gz` aus GitHub Actions („Nextcloud-App“) herunterladen.
2. Archiv in den `apps`- (oder `custom_apps`-)Ordner der Nextcloud entpacken, sodass dort `notenleser/appinfo/info.xml` liegt.
3. App aktivieren: `occ app:enable notenleser` oder unter „Apps → Deaktivierte Apps“.

## Entwicklung

```sh
cd nextcloud
npm ci
npm test              # Unit-Tests (Import, Notensatz, Erkennung, Navigation, Wiedergabe)
npm run build         # bündelt nach js/
npm run package       # build/notenleser-<version>.tar.gz
npm run dev           # Standalone-Version ohne Nextcloud: http://localhost:8085/
node scripts/dev-server.mjs /pfad/zu/noten 8085   # mit eigenem Notenordner
```

## Aufbau

| Ordner | Inhalt |
|---|---|
| `appinfo/`, `lib/`, `templates/` | Nextcloud-App (PHP): Seite, Einstellungen, Einbindung in die Dateien-App |
| `src/core/` | Plattformunabhängige Logik ohne DOM: Systemerkennung, MuseScore-Import, Notensatz, Navigation, Wiedergabe-Timeline, Gestenerkennung |
| `src/web/` | Browser-Oberfläche: Reader, Dialoge, Web-Audio-Wiedergabe, Kamera |
| `src/nextcloud/` | Anbindung an Nextcloud: WebDAV-Dateizugriff, Einstellungen, Dateiaktion |
| `src/standalone/` | Anbindung ohne Nextcloud (lokaler Dev-Server); Vorlage für eine spätere Desktop-Version (z. B. Tauri) |

Der Reader bekommt Dateizugriff (`list`, `read`, `readText`, `write`) und Einstellungsspeicher (`load`, `save`) von außen. Für eine Desktop-Version muss nur diese Anbindung neu geschrieben werden.

Die Notenschrift Leland stammt aus dem MuseScore-Projekt und steht unter der SIL Open Font License 1.1 (`fonts/Leland-LICENSE.txt`).
