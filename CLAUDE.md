# Hinweise für Claude

## Git

- Änderungen immer direkt auf `main` committen und pushen (`git push origin HEAD:main`), keine Feature-Branches und keine Pull Requests.
- Vor dem Push `git fetch origin main` und auf den aktuellen Stand von `main` rebasen, damit der Push ein Fast-Forward bleibt.

## Releases

- Die APK baut GitHub Actions (`.github/workflows/release-apk.yml`), sobald ein Tag `v*` gepusht wird. Details stehen in der README.
