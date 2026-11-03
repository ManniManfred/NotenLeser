import { getCurrentUser, getRequestToken } from '@nextcloud/auth'
import { generateRemoteUrl } from '@nextcloud/router'

/**
 * File access through the Nextcloud WebDAV interface. Paths are absolute within the user's files, e.g. "/Noten/Lied.pdf".
 * Other front ends (e.g. a desktop shell) provide the same methods: list, read, write, exists.
 */
export class DavSource {
	constructor() {
		const user = getCurrentUser()
		if (!user) throw new Error('Nicht angemeldet')
		this.base = generateRemoteUrl('dav/files/' + encodeURIComponent(user.uid)).replace(/\/$/, '')
		this.label = 'Nextcloud'
	}

	url(path) {
		return this.base + path.split('/').map(part => encodeURIComponent(part)).join('/')
	}

	headers(extra = {}) { return { requesttoken: getRequestToken() || '', ...extra } }

	/** Folder entries as {name, path, isDir}, sorted with folders first. */
	async list(path) {
		const response = await fetch(this.url(path.endsWith('/') ? path : path + '/'), {
			method: 'PROPFIND',
			headers: this.headers({ Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }),
			body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontenttype/></d:prop></d:propfind>',
		})
		if (!response.ok) throw new Error(`Ordner konnte nicht gelesen werden (HTTP ${response.status})`)
		const xml = new DOMParser().parseFromString(await response.text(), 'application/xml')
		const own = normalize(path)
		const entries = []
		for (const item of xml.getElementsByTagNameNS('DAV:', 'response')) {
			const href = item.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent || ''
			const entryPath = normalize(decodeURIComponent(new URL(href, location.href).pathname).substring(new URL(this.base, location.href).pathname.length))
			if (entryPath === own) continue
			const isDir = item.getElementsByTagNameNS('DAV:', 'collection').length > 0
			entries.push({ name: entryPath.substring(entryPath.lastIndexOf('/') + 1), path: entryPath, isDir })
		}
		entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'de', { sensitivity: 'base', numeric: true }) : a.isDir ? -1 : 1))
		return entries
	}

	async read(path) {
		const response = await fetch(this.url(path), { headers: this.headers() })
		if (!response.ok) throw new Error(response.status === 404 ? 'Datei nicht gefunden' : `Datei konnte nicht geladen werden (HTTP ${response.status})`)
		return new Uint8Array(await response.arrayBuffer())
	}

	/** Reads a text file, or returns null when it does not exist. */
	async readText(path) {
		const response = await fetch(this.url(path), { headers: this.headers() })
		if (response.status === 404) return null
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return response.text()
	}

	async write(path, text, contentType = 'application/json') {
		const response = await fetch(this.url(path), {
			method: 'PUT',
			headers: this.headers({ 'Content-Type': contentType }),
			body: text,
		})
		if (!response.ok) throw new Error(response.status === 403 ? 'Keine Schreibberechtigung im Ordner' : `HTTP ${response.status}`)
	}
}

export function normalize(path) {
	const clean = ('/' + path).replace(/\/+/g, '/')
	return clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean
}
