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
- In den Einstellungen (⚙ in der Leiste oder „Einstellungen“ auf der Startseite) lässt sich die eigene Stimme festlegen (1. bis 6. Stimme). Die entsprechende Notenzeile wird dann in jedem System mit mehreren Notenzeilen automatisch farbig hinterlegt – bei PDFs anhand der erkannten Notenzeilen, bei MuseScore-Dateien anhand der gesetzten Systeme. Einzelne Stimmauszüge bleiben unmarkiert.
- Die Taste „System“ schaltet auf „Seitenweise“ um; dann wird jeweils die ganze PDF-Seite angezeigt und geblättert.

Die automatische Erkennung (`SystemDetector`) sucht Notenzeilen abschnittsweise in schmalen senkrechten Streifen. Dadurch werden auch eingerückte oder verkürzte Zeilen sowie leicht schiefe oder gewölbte Scans erkannt. Benachbarte Notenzeilen gehören zu einem System, wenn sie links durch Systemstrich, Klammer oder Akkolade verbunden sind oder ein Taktstrich durch den Zwischenraum läuft; Stimmauszüge ohne solche Verbindung werden zeilenweise geblättert. Jeder Ausschnitt reicht bis zur nächsten Leerzone, sodass Dynamik, Volten und Taktnummern sichtbar bleiben. Bei ungewöhnlichem Layout oder sehr blassen Linien kann sie danebenliegen; dann auf „Seitenweise“ umschalten oder die Systeme im Bearbeitungsmodus selbst markieren. Die Kameragestenerkennung ist als nächster Ausbauschritt vorgesehen und noch nicht implementiert.

## In Android Studio öffnen

Öffne diesen Ordner in Android Studio und lasse Gradle synchronisieren (Android Gradle Plugin 8.7.3, compile SDK 35, Mindestversion Android 6.0). Starte die App anschließend auf einem Gerät oder Emulator. Ein Android SDK ist für den Build erforderlich.

## MuseScore-Unterstützung

Der Import (`MuseScoreReader`) liest das Partitur-XML und die Stildatei aus dem `.mscz`-Archiv. Der Notensatz (`ScoreEngraver`) setzt Schlüssel, Tonart- und Taktwechsel, Noten mit Hälsen, Fähnchen und automatischer Balkung, Punktierungen, Vorzeichen (nach Tonart und Taktregeln), Pausen und Ganztaktpausen, Haltebögen, Legatobögen, N-tolen, Vorschlagsnoten, Artikulationen, Fermaten, Dynamik und Gabeln, Wiederholungen und Volten, Tempo-, Spiel- und Probenzeichen, Akkordsymbole, Liedtext sowie mehrere Stimmen und Systeme mit Klammern. Nicht dargestellt werden u. a. Tabulatur, Glissandi, Oktavierungslinien, Pedal, Tremoli, Arpeggien und Mehrtaktpausen.

Die Notenschrift Leland stammt aus dem MuseScore-Projekt und steht unter der SIL Open Font License 1.1 (`app/src/main/assets/fonts/Leland-LICENSE.txt`).
