# Hinweise für Claude

## Sprache

- Immer auf Deutsch antworten, auch bei Rückfragen, Zusammenfassungen und Commit-Nachrichten.
- Code-Kommentare und Bezeichner bleiben wie im bestehenden Code auf Englisch; Texte in der Oberfläche und in den READMEs auf Deutsch.

## Git

- Änderungen immer direkt auf `main` committen und pushen (`git push origin HEAD:main`), keine Feature-Branches und keine Pull Requests.
- Vor dem Push `git fetch origin main` und auf den aktuellen Stand von `main` rebasen, damit der Push ein Fast-Forward bleibt.

## Veröffentlichung

- Die Web-App veröffentlicht `.github/workflows/pages.yml` bei jedem Push auf `main`, der `nextcloud/` ändert; das Nextcloud-Paket baut `.github/workflows/nextcloud-app.yml`. Details stehen in `nextcloud/README.md`.
