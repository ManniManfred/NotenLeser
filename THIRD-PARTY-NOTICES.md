# Lizenzen von Drittanbietern

NotenLeser selbst steht unter der GNU Affero General Public License v3.0 oder später ([`LICENSE`](LICENSE)).
Folgende Bestandteile Dritter werden mitgeliefert oder in die gebauten Dateien eingebunden:

| Bestandteil | Version | Lizenz | Verwendet in | Quelle |
|---|---|---|---|---|
| Leland (Notenschrift) | – | SIL Open Font License 1.1, Reserved Font Name „Leland“ | Android, Web, Nextcloud | https://github.com/MuseScoreFonts/Leland |
| pdf.js (`pdfjs-dist`) | 6.5.438 | Apache-2.0 | Web, Nextcloud | https://github.com/mozilla/pdf.js |
| fflate | 0.8.3 | MIT | Web, Nextcloud | https://github.com/101arrowz/fflate |
| @nextcloud/auth, router, initial-state, event-bus, browser-storage, logger | siehe `nextcloud/package-lock.json` | GPL-3.0-or-later | Nextcloud | https://github.com/nextcloud-libraries |
| @nextcloud/files | 4.1.1 | AGPL-3.0-or-later | Nextcloud | https://github.com/nextcloud-libraries/nextcloud-files |
| semver | 7.8.6 | ISC | Nextcloud | https://github.com/npm/node-semver |
| typescript-event-target | 1.1.2 | MIT | Nextcloud | https://github.com/DerZade/typescript-event-target |
| FluidR3Mono GM (Klänge der Wiedergabe, umgewandelt nach `nextcloud/sounds/`) | 2.312 (2016) | MIT | Web, Nextcloud | https://github.com/musescore/MuseScore/blob/v2.3.2/share/sound/FluidR3Mono_GM.sf3 |
| Gradle Wrapper (`gradle/wrapper/gradle-wrapper.jar`) | 9.6.0 | Apache-2.0 | Android-Build | https://github.com/gradle/gradle |

Lizenztexte: [Apache-2.0](LICENSES/Apache-2.0.txt), [GPL-3.0](LICENSES/GPL-3.0.txt), [OFL-1.1 (Leland)](LICENSES/OFL-1.1-Leland.txt); MIT und ISC folgen unten.
Die Schriftdatei `Leland.otf` wird unverändert weitergegeben.

Die Beispielnoten (`nextcloud/pages/demo/`) und Testdateien (`nextcloud/tests/fixtures/`) wurden für dieses Projekt erstellt
und stehen wie der übrige Code unter der AGPL.

Werkzeuge, die nur beim Bauen oder Testen laufen (esbuild, @xmldom/xmldom, Android Gradle Plugin), werden nicht mit ausgeliefert.

## fflate

```
MIT License

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.```

## typescript-event-target

```
MIT License

Copyright (c) 2022 Jonas "DerZade" Schade

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.```

## semver

```
The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## FluidR3Mono GM

Die Instrumentdateien in `nextcloud/sounds/` wurden mit `nextcloud/scripts/build-sounds.mjs` aus
`FluidR3Mono_GM.sf3` (Version 2.312 vom 5. Dezember 2016, ausgeliefert mit MuseScore 2.3.2) erzeugt:
neu abgetastet, auf eine Dynamikstufe und Mono reduziert und als IMA ADPCM gespeichert.

```
Original Stereo version by Frank Wen Copyright (c) 2000-2002
Mono version by Michael Cowgill Copyright (c) 2014-16
Temple Blocks instrument provided by Ethan Winer Copyright (c) 2002
Drumline Percussion provided by Michael Schorsch Copyright (c) 2016

This Mono version of FluidR3 GM is released under the MIT license as described in COPYING.

Fluid (R3) SoundFont
Copyright (c) 2000-2002, 2008 Frank Wen <getfrank@gmail.com>
Fluid was constructed in part from samples found in the public domain that I edited/cleaned/remixed/programmed
and largely from recordings of my own and in conjunction with the people below who helped along the way:
Suren M. Seron, Scott Hanan, Steve Aupperle, Chris Gillman, Alex Taubr, Chris Prola, Andrew Klenk,
Winfried Hubbe, Dylan, Tim, Gort, Uros Katic, Ethan Winer (http://www.ethanwiner.com)

COPYING

Mono version:  Copyright (c) 2014-16 Michael Cowgill
Copyright (c) 2000-2002, 2008 Frank Wen <getfrank@gmail.com>

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```
