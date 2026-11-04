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
- **Wiedergabe** (▶, nur MuseScore): echte Instrumentenklänge (General-MIDI-Samples aus FluidR3Mono, siehe unten) mit Tempo, Dynamik, Akzenten, Staccato, Haltebögen, Wiederholungen und Volten. Der klingende Takt wird markiert, die Ansicht blättert automatisch mit. Mit **Bereich** wird ein Übungsausschnitt markiert: ersten und letzten Takt antippen (dazwischen darf geblättert werden), ▶ spielt dann nur diese Takte in Schleife. Ein weiterer Tipp auf die Taste hebt den Bereich auf. Mit **Stimmen** wird die Wiedergabe auf eine oder mehrere Stimmen (Instrumente) beschränkt; die übrigen sind stumm oder spielen leise mit, „Nur meine Stimme“ übernimmt die eigene Stimme aus den Einstellungen.
- **Vollbild**: Beim Öffnen von Noten wechselt der NotenLeser automatisch in den Vollbildmodus (in den Einstellungen abschaltbar). ⛶ in der Leiste oder die Taste **F** schalten jederzeit um. Der Bildschirm bleibt an, solange Noten offen sind (Wake Lock).
- **iPhone**: Safari kennt dort keinen Vollbildmodus für Webseiten. ⛶ öffnet stattdessen die Ansicht ohne Nextcloud-Kopfzeile (`/apps/notenleser/reader`). Über „Teilen → Zum Home-Bildschirm“ wird daraus ein eigenes App-Symbol, das den NotenLeser wie eine App im Vollbild startet (beim ersten Start einmal bei Nextcloud anmelden). ⌂ führt zurück zur normalen Nextcloud-Ansicht. Auf Android bietet Chrome über das Web-App-Manifest ebenfalls „Zum Startbildschirm hinzufügen“ an.

Die Kamerabilder werden nur im Browser zu einem groben Helligkeitsraster verrechnet, nie gespeichert oder übertragen. Kamerazugriff erlaubt der Browser nur über HTTPS.

## Web-App ohne Nextcloud (GitHub Pages)

Dieselbe Oberfläche läuft auch als reine Web-App ohne Server: **https://mannimanfred.github.io/NotenLeser/**

- „Noten öffnen“ wählt eine oder mehrere Dateien vom Gerät (auch auf dem iPhone); die gewählten Dateien bilden die Mappe zum Wischen nach oben/unten.
- „Ordner öffnen“ öffnet einen ganzen Notenordner. In Chrome und Edge bleibt der Ordner gespeichert („Weiterlesen“ nach dem Neustart), und markierte Systeme werden als `.systems.json` direkt in den Ordner geschrieben – kompatibel mit Android- und Nextcloud-Version. In anderen Browsern werden Markierungen im Browser gespeichert.
- „Beispiel ansehen“ lädt eine Beispiel-PDF und eine MuseScore-Datei.
- Die Dateien bleiben auf dem Gerät, es wird nichts hochgeladen. Nach dem ersten Besuch funktioniert die App auch offline und lässt sich installieren bzw. zum Home-Bildschirm hinzufügen; installiert kann sie in Chrome/Edge als Programm zum Öffnen von PDF- und MuseScore-Dateien gewählt werden.

### Veröffentlichen

Der Workflow `.github/workflows/pages.yml` baut die Seite bei jedem Push auf `main`, der `nextcloud/` ändert, und veröffentlicht sie auf GitHub Pages (manuell: *Actions → GitHub Pages (Web-App) → Run workflow*). Einmalig nötig: im Repository unter *Settings → Pages* als Quelle „GitHub Actions“ wählen. Lokal bauen: `npm run build:pages` (Ergebnis in `dist-pages/`). Die App nutzt nur relative Pfade und läuft unter jeder Adresse; `LICENSE` und `THIRD-PARTY-NOTICES.md` werden mit veröffentlicht.

Optionale Repository-Variablen: `PAGES_CNAME` für eine eigene Domain. Mit `PAGES_REPO` (`owner/name`) und dem Secret `PAGES_DEPLOY_TOKEN` (Fine-grained Token für das Ziel-Repository mit *Contents* und *Pages: Read and write*) schiebt der Workflow die gebauten Dateien stattdessen in den Branch `gh-pages` (oder `PAGES_BRANCH`) eines anderen Repositorys und schaltet dort Pages ein – nützlich, falls dieses Repository einmal privat sein soll.

## Klänge

Die Wiedergabe nutzt gesampelte Instrumente aus der SoundFont **FluidR3Mono GM** (MIT-Lizenz, wie sie MuseScore 2 mitliefert). `scripts/build-sounds.mjs` hat daraus je General-MIDI-Instrument eine kleine Datei in `sounds/` gemacht (`<Programm>.wav`, Schlagzeug `drums.wav`; IMA ADPCM mit ~22 kHz, eine Dynamikstufe, Schleifenpunkte und Hüllkurven der SoundFont). Geladen werden nur die Instrumente, die das Stück braucht – beim ersten Abspielen kann das einen Moment dauern; die GitHub-Pages-Version hält sie danach auch offline vor. Fehlt eine Datei, spielt das Instrument mit dem einfachen eingebauten Synthesizer.

Neu erzeugen (braucht ffmpeg):

```sh
node scripts/build-sounds.mjs /pfad/zu/FluidR3Mono_GM.sf3
```

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
| `src/pages/`, `pages/` | Web-App für GitHub Pages: Dateien vom Gerät, Beispiele, Offline-Betrieb (Service Worker), Manifest |

Der Reader bekommt Dateizugriff (`list`, `read`, `readText`, `write`) und Einstellungsspeicher (`load`, `save`) von außen. Für eine Desktop-Version muss nur diese Anbindung neu geschrieben werden.

Lizenz: AGPL-3.0-or-later (siehe [`LICENSE`](../LICENSE)). Die Notenschrift Leland stammt aus dem MuseScore-Projekt und steht unter der SIL Open Font License 1.1 (`fonts/Leland-LICENSE.txt`); weitere Bestandteile Dritter in [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).
