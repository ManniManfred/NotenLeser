# NotenLeser (Android)

Native Android-App zum Lesen von Noten (PDF und MuseScore) im Vollbild. Die Datei wird über den Android-Dateiauswahldialog geöffnet. Wähle dort den Nextcloud-Speicherort oder einen lokal synchronisierten Ordner. Android merkt sich die Dateiberechtigung, sodass die zuletzt geöffnete Datei beim nächsten Start wieder geladen werden kann.

## Funktionen

- PDF-Seiten werden mit Androids PDF-Renderer dargestellt.
- MuseScore-Dateien (`.mscz` und `.mscx`, Formatversion 2 bis 4) werden direkt in der App gesetzt und mit der Notenschrift Leland gezeichnet. Seitenformat, Zeilen- und Seitenumbrüche sowie die transponierte Darstellung (z. B. Horn in Es oder B) werden aus der Datei übernommen; die Systeme sind bekannt und müssen nicht erkannt werden.
- Vollbild ohne Systemleisten; Display bleibt während des Lesens an.
- Abgerundete, dunkle Bedienelemente mit Titel und Statuszeile liegen über der Notenseite und blenden sich nach 3,5 Sekunden ohne Eingabe aus. Tippen auf die Seite blendet sie wieder ein.
- Der PDF-Titel wird aus den Dateimetadaten des Dateianbieters gelesen; die Nextcloud-interne URI erscheint nicht als Dateiname.
- Tippen auf „Noten öffnen“, um eine PDF- oder MuseScore-Datei auszuwählen. Im Ordnermodus werden `.pdf`, `.mscz` und `.mscx` gelistet.
- Wischen mit einem Finger nach links/rechts wechselt das System, Wischen mit zwei Fingern blättert um alle sichtbaren Systeme weiter. Am Seitenende springt die App auf die nächste PDF-Seite.
- Wischen nach oben/unten wechselt zur nächsten bzw. vorherigen PDF im geöffneten Ordner; ein kurzes Hinweisfeld zeigt Titel und Position.
- Im Bearbeitungsmodus (Wischen markiert dort Systeme) blättern die Tasten ‹/› seitenweise.
- Die App erkennt Notenzeilen (fünf waagerechte Linien), fasst sie zu Systemen zusammen und navigiert zwischen erkannten Systemen.
- Wenn der Bildschirm Platz bietet, werden mehrere aufeinanderfolgende Systeme gleichzeitig angezeigt, auch über Seitengrenzen hinweg. Navigation verschiebt den sichtbaren Ausschnitt jeweils um ein System.
- Angezeigte Systeme sind mit Seiten- und Systemnummer im Format „Seite·System“ markiert und durch dezente Linien getrennt. Die Statuszeile zeigt aktuelle und gesamte Seitenzahl.
- PDF-Seiten ohne erkannte Notensysteme (zum Beispiel Deckblätter) werden bei aktivierter Auto-Erkennung beim Blättern übersprungen.
- MuseScore-Dateien lassen sich mit ▶ in der Leiste abspielen (■ beendet). Die Wiedergabe beginnt beim obersten angezeigten System und nutzt den eingebauten MIDI-Synthesizer von Android mit den Instrumenten, Tempoangaben (auch ausgeblendete), Dynamik, Akzenten, Staccato, Haltebögen, Wiederholungen und Volten aus der Datei. Der gerade klingende Takt wird blau hinterlegt, ein Strich zeigt die genaue Position, und die App blättert automatisch, sodass das klingende System oben steht. In den Einstellungen lässt sich das Tempo auf 50, 75 oder 125 % stellen. Sprünge wie D.C., D.S. und Coda werden noch nicht ausgeführt.
- Die Versionsnummer steht auf der Startseite und unten in den Einstellungen.
- In den Einstellungen (⚙ in der Leiste oder „Einstellungen“ auf der Startseite) lässt sich die eigene Stimme festlegen (1. bis 6. Stimme). Die entsprechende Notenzeile wird dann in jedem System mit mehreren Notenzeilen automatisch farbig hinterlegt – bei PDFs anhand der erkannten Notenzeilen, bei MuseScore-Dateien anhand der gesetzten Systeme. Einzelne Stimmauszüge bleiben unmarkiert.
- Mit der Einstellung „Immer mindestens 2 Systeme anzeigen“ ist das folgende System stets schon sichtbar, damit man vorauslesen kann. Passen zwei Systeme nicht auf den Bildschirm, werden beide verkleinert.
- Mit der Einstellung „Mit Handbewegung vor der Frontkamera blättern“ wechselt eine seitliche Finger- oder Handbewegung vor der Frontkamera das System: von rechts nach links zum nächsten, von links nach rechts zum vorherigen. Die nötige Bewegungsweite ist einstellbar („Fein“ reicht für eine kleine Fingerbewegung nah vor der Kamera, „Grob“ verlangt einen Wisch mit der ganzen Hand). „Erkennung anzeigen (Debug)“ blendet unten rechts das Kamerabild als grobes Raster ein, markiert bewegte Bereiche rot und zeigt Bewegungsschwerpunkt, zurückgelegten Weg und erkannte Gesten. Die App fragt nach dem Kamerazugriff. Die Kamera läuft nur, solange die App im Vordergrund ist; die Bilder werden in grober Auflösung auf dem Gerät ausgewertet (Bewegung eines Helligkeitsrasters) und nicht gespeichert.
- Bluetooth-Blätterpedale (z. B. AirTurn, PageFlip), die sich als Tastatur verbinden, werden ohne Einstellung unterstützt: Pfeil rechts/unten, Bild↓, Leertaste, Enter und „Nächster Titel“ wechseln zum nächsten System, Pfeil links/oben, Bild↑ und „Vorheriger Titel“ zum vorherigen. Ein gehaltenes Pedal blättert nur einmal.
- Die Taste „System“ schaltet auf „Seitenweise“ um; dann wird jeweils die ganze PDF-Seite angezeigt und geblättert.

Die automatische Erkennung (`SystemDetector`) sucht Notenzeilen abschnittsweise in schmalen senkrechten Streifen. Dadurch werden auch eingerückte oder verkürzte Zeilen sowie leicht schiefe oder gewölbte Scans erkannt. Benachbarte Notenzeilen gehören zu einem System, wenn sie links durch Systemstrich, Klammer oder Akkolade verbunden sind oder ein Taktstrich durch den Zwischenraum läuft; Stimmauszüge ohne solche Verbindung werden zeilenweise geblättert. Jeder Ausschnitt reicht bis zur nächsten Leerzone, sodass Dynamik, Volten und Taktnummern sichtbar bleiben. Bei ungewöhnlichem Layout oder sehr blassen Linien kann sie danebenliegen; dann auf „Seitenweise“ umschalten oder die Systeme im Bearbeitungsmodus selbst markieren.
## In Android Studio öffnen

Öffne diesen Ordner in Android Studio und lasse Gradle synchronisieren (Android Gradle Plugin 8.7.3, compile SDK 35, Mindestversion Android 6.0). Starte die App anschließend auf einem Gerät oder Emulator. Ein Android SDK ist für den Build erforderlich.

## MuseScore-Unterstützung

Der Import (`MuseScoreReader`) liest das Partitur-XML und die Stildatei aus dem `.mscz`-Archiv. Der Notensatz (`ScoreEngraver`) setzt Schlüssel, Tonart- und Taktwechsel, Noten mit Hälsen, Fähnchen und automatischer Balkung, Punktierungen, Vorzeichen (nach Tonart und Taktregeln), Pausen und Ganztaktpausen, Haltebögen, Legatobögen, N-tolen, Vorschlagsnoten, Artikulationen, Fermaten, Dynamik und Gabeln, Wiederholungen und Volten, Tempo-, Spiel- und Probenzeichen, Akkordsymbole, Liedtext sowie mehrere Stimmen und Systeme mit Klammern. Nicht dargestellt werden u. a. Tabulatur, Glissandi, Oktavierungslinien, Pedal, Tremoli, Arpeggien und Mehrtaktpausen.

Die Notenschrift Leland stammt aus dem MuseScore-Projekt und steht unter der SIL Open Font License 1.1 (`app/src/main/assets/fonts/Leland-LICENSE.txt`).

## APK automatisch bauen (GitHub Actions)

Beim Pushen eines Tags, der mit `v` beginnt, baut der Workflow `.github/workflows/release-apk.yml` die APK und hängt sie an ein GitHub-Release an:

```sh
git tag v0.2.0
git push origin v0.2.0
```

Alternativ den Workflow unter Actions → „Release APK“ → „Run workflow“ mit einer Version starten; er legt dann Tag und Release selbst an.

Der Tag (ohne `v`) wird als `versionName` übernommen, die Laufnummer des Workflows als `versionCode`.

Für eine signierte Release-APK folgende Repository-Secrets anlegen (Settings → Secrets and variables → Actions):

- `ANDROID_KEYSTORE_BASE64` – Keystore-Datei als Base64 (`base64 -w0 release.keystore`)
- `ANDROID_KEYSTORE_PASSWORD` – Passwort des Keystores
- `ANDROID_KEY_ALIAS` – Alias des Schlüssels
- `ANDROID_KEY_PASSWORD` – Passwort des Schlüssels

Einen Keystore erzeugt z. B. `keytool -genkeypair -v -keystore release.keystore -alias notenleser -keyalg RSA -keysize 4096 -validity 10000`. Ohne diese Secrets entsteht eine Debug-signierte APK. Sie lässt sich installieren, aber weil jeder Build einen anderen Debug-Schlüssel hat, kann sie eine frühere Version nicht ersetzen (vorher deinstallieren).
