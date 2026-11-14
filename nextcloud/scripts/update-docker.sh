#!/bin/sh
# Installs or updates the NotenLeser app in a Nextcloud that runs in Docker (official image with Docker Compose,
# Nextcloud AIO or CapRover). Runs on the Docker host, by hand or from cron. Usage: see usage() or --help.
set -eu

REPO=ManniManfred/NotenLeser
APPS=/var/www/html/custom_apps
APP_DIR=$APPS/notenleser
STAGING=/tmp/notenleser-new

usage() {
	cat <<'EOF2'
Installiert oder aktualisiert NotenLeser in einer Nextcloud, die in Docker läuft
(offizielles Image mit Docker Compose, Nextcloud AIO oder CapRover). Ist die
neueste Version schon installiert, passiert nichts.

  notenleser-update --caprover nextcloud              CapRover-App „nextcloud“
  notenleser-update --container nextcloud-aio-nextcloud   Container-Name aus docker ps

Optionen:
  --version 0.3.2   diese Version statt der neuesten installieren
  --force           auch installieren, wenn diese Version schon installiert ist

Das Paket kommt aus den GitHub-Releases von ManniManfred/NotenLeser und wird,
falls vorhanden, mit der .sha256-Datei geprüft.
EOF2
}
fail() { echo "Fehler: $*" >&2; exit 1; }
log() { echo "[notenleser] $*"; }

caprover='' container='' version='' force=''
while [ $# -gt 0 ]; do
	case "$1" in
		--caprover) caprover=${2:?}; shift 2 ;;
		--container) container=${2:?}; shift 2 ;;
		--version) version=${2#v}; shift 2 ;;
		--force) force=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) fail "unbekannte Option $1 (Hilfe: --help)" ;;
	esac
done
[ -n "$caprover$container" ] || fail "--caprover <App-Name> oder --container <Name> angeben (Hilfe: --help)"
command -v docker > /dev/null || fail "docker nicht gefunden"
command -v curl > /dev/null || fail "curl nicht gefunden"

# CapRover runs the app as a swarm service, so the container gets a new name on every restart.
if [ -n "$caprover" ]; then
	ids=$(docker ps --format '{{.ID}} {{.Names}}' | awk -v p="srv-captain--$caprover." 'index($2, p) == 1 { print $1 }')
else
	ids=$(docker ps --format '{{.ID}} {{.Names}}' | awk -v n="$container" '$1 == n || $2 == n { print $1 }')
fi
count=$(printf '%s' "$ids" | grep -c . || true)
[ "$count" -eq 1 ] || fail "$count laufende Container für ${caprover:+CapRover-App }$caprover$container gefunden (docker ps prüfen)"
c=$ids

occ() { docker exec -u www-data "$c" php /var/www/html/occ "$@"; }
docker exec "$c" test -d "$APPS" || fail "$APPS fehlt im Container – ist das ein Nextcloud-Container?"

installed=$(docker exec "$c" sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$APP_DIR/appinfo/info.xml" 2> /dev/null || true)

if [ -z "$version" ]; then
	version=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)
	[ -n "$version" ] || fail "neueste Version konnte nicht von GitHub gelesen werden"
fi
log "installiert: ${installed:-keine}, verfügbar: $version"

if [ "$installed" = "$version" ] && [ -z "$force" ]; then
	log "Schon aktuell."
	exit 0
fi
if [ -n "$installed" ] && [ "$installed" != "$version" ] \
	&& [ "$(printf '%s\n%s\n' "$installed" "$version" | sort -V | tail -n 1)" = "$installed" ]; then
	fail "Version $version ist älter als die installierte $installed; Nextcloud kann Apps nicht zurückstufen"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
file=notenleser-$version.tar.gz
url=https://github.com/$REPO/releases/download/v$version/$file
log "Lade $url"
curl -fsSL -o "$tmp/$file" "$url" || fail "Download fehlgeschlagen"
if curl -fsSL -o "$tmp/$file.sha256" "$url.sha256" 2> /dev/null; then
	(cd "$tmp" && sha256sum -c "$file.sha256" > /dev/null) || fail "Prüfsumme stimmt nicht"
	log "Prüfsumme in Ordnung"
else
	log "Keine Prüfsumme zum Release gefunden (ältere Releases), nur HTTPS-Download"
fi
tar -xzf "$tmp/$file" -C "$tmp"
packaged=$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$tmp/notenleser/appinfo/info.xml" 2> /dev/null || true)
[ "$packaged" = "$version" ] || fail "Paket enthält Version '${packaged}' statt $version"

# Copy into the container first and swap the folder in one step, so Nextcloud never sees half a copy for long.
docker exec "$c" rm -rf "$STAGING"
docker cp "$tmp/notenleser" "$c:$STAGING"
docker exec "$c" sh -c 'set -e; chown -R www-data:www-data "$1"; rm -rf "$2"; mv "$1" "$2" 2> /dev/null || { cp -a "$1" "$2"; rm -rf "$1"; }' \
	sh "$STAGING" "$APP_DIR"
log "Dateien nach $APP_DIR kopiert"

version_now() { occ config:app:get notenleser installed_version 2> /dev/null || true; }
if [ -n "$installed" ]; then
	occ upgrade
fi
now=$(version_now)
# New installation, or an app that was disabled: occ upgrade leaves disabled apps alone, enabling installs it.
if [ "$now" != "$version" ]; then
	occ app:enable notenleser
	now=$(version_now)
fi
[ "$now" = "$version" ] || fail "Nextcloud meldet Version '${now}' statt $version (occ upgrade von Hand prüfen)"
log "NotenLeser $version ist installiert."
