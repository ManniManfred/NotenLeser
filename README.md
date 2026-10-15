# NotenLeser (Android)

Native Android-App zum Lesen von PDF-Noten im Vollbild. Das PDF wird über den Android-Dateiauswahldialog geöffnet. Wähle dort den Nextcloud-Speicherort oder einen lokal synchronisierten Ordner. Android merkt sich die Dateiberechtigung, sodass die zuletzt geöffnete Datei beim nächsten Start wieder geladen werden kann.

## Funktionen

- PDF-Seiten werden mit Androids PDF-Renderer dargestellt.
- Vollbild ohne Systemleisten; Display bleibt während des Lesens an.
- Abgerundete, halbtransparente Bedienelemente liegen über der Notenseite und blenden sich nach 3,5 Sekunden ohne Eingabe aus. Tippen auf die Seite blendet sie wieder ein.
- Der PDF-Titel wird aus den Dateimetadaten des Dateianbieters gelesen; die Nextcloud-interne URI erscheint nicht als Dateiname.
- Tippen auf „PDF öffnen“, um eine Notendatei auszuwählen.
- Wischen nach links/rechts oder die Tasten „Weiter“/„Zurück“ wechseln das System. Am Seitenende springt die App auf die nächste PDF-Seite.
- Die App sucht automatisch nach fünf langen, waagerechten Notenlinien und navigiert zwischen erkannten Systemen.
- Wenn der Bildschirm Platz bietet, werden mehrere aufeinanderfolgende Systeme gleichzeitig angezeigt; Navigation verschiebt den sichtbaren Ausschnitt jeweils um ein System.
- Angezeigte Systeme sind mit Nummern markiert und durch dezente Linien getrennt. Die Seitenanzeige zeigt aktuelle und gesamte Seitenzahl.
- PDF-Seiten ohne erkannte Notensysteme (zum Beispiel Deckblätter) werden bei aktivierter Auto-Erkennung beim Blättern übersprungen.
- Über „Auto“ kann auf manuelle Seiteneinteilung umgeschaltet werden. Dann lässt sich die Zahl der Abschnitte mit −/+ einstellen (1 bis 12; Standard 4).

Die automatische Erkennung sucht einzelne Notenzeilen und fasst benachbarte Zeilen anhand ihrer Abstände zu einem gemeinsamen System zusammen. So bleiben mehrere Stimmen beziehungsweise Staves eines Systems gemeinsam im Ausschnitt. Sie ist auf klar gedruckte Noten mit langen, horizontalen Notenlinien ausgelegt. Bei ungewöhnlichem Layout oder sehr blassen Linien kann sie danebenliegen; dann auf „Auto aus“ umschalten und die manuelle Einteilung verwenden. Die Kameragestenerkennung ist als nächster Ausbauschritt vorgesehen und noch nicht implementiert.

## In Android Studio öffnen

Öffne diesen Ordner in Android Studio und lasse Gradle synchronisieren (Android Gradle Plugin 8.7.3, compile SDK 35, Mindestversion Android 6.0). Starte die App anschließend auf einem Gerät oder Emulator. Ein Android SDK ist für den Build erforderlich.
