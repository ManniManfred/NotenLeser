/**
 * Scores from the player's own device for the web version without a server.
 *
 * Three kinds of roots, one at a time:
 * - a folder opened with the File System Access API (Chrome, Edge): browsable, and .systems.json files are
 *   written next to the scores like in the Android and Nextcloud versions;
 * - files picked with a file input (all browsers, also iPhone): kept in memory, sidecars go to localStorage;
 * - the bundled example scores, loaded over HTTP.
 * Paths look like "/Ordner/Lied.pdf" relative to the chosen root.
 */
const SIDECAR_PREFIX = 'notenleser-sidecar:'

export class LocalSource {
	constructor() {
		this.handle = null // FileSystemDirectoryHandle
		this.files = null // Map path => File or Blob
		this.rootName = ''
		this.label = 'Gerät'
	}

	static folderAccessSupported() { return typeof window.showDirectoryPicker === 'function' }

	useHandle(handle) { this.handle = handle; this.files = null; this.rootName = handle.name }

	/** Uses picked files; with webkitRelativePath their folders are kept. */
	useFiles(fileList, rootName = 'Auswahl') {
		this.handle = null
		this.files = new Map()
		this.rootName = rootName
		for (const file of fileList) {
			const relative = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name
			this.files.set('/' + relative, file)
		}
	}

	async useDemo(baseUrl) {
		const index = await (await fetch(baseUrl + 'index.json')).json()
		const files = new Map()
		await Promise.all(index.map(async name => {
			const response = await fetch(baseUrl + encodeURIComponent(name))
			if (!response.ok) throw new Error('Beispiel konnte nicht geladen werden')
			files.set('/' + name, await response.blob())
		}))
		this.handle = null
		this.files = files
		this.rootName = 'Beispiele'
	}

	get ready() { return !!(this.handle || this.files) }

	async directory(path, create = false) {
		let dir = this.handle
		for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create })
		return dir
	}

	async list(path) {
		if (!this.ready) throw new Error('Noch kein Ordner gewählt')
		const folder = path === '/' ? '' : path.replace(/\/$/, '')
		const entries = []
		if (this.handle) {
			const dir = await this.directory(folder)
			for await (const [name, entry] of dir.entries()) {
				if (name.startsWith('.')) continue
				entries.push({ name, path: folder + '/' + name, isDir: entry.kind === 'directory' })
			}
		} else {
			const seen = new Set()
			for (const file of this.files.keys()) {
				if (!file.startsWith(folder + '/')) continue
				const rest = file.substring(folder.length + 1)
				const name = rest.split('/')[0]
				if (seen.has(name)) continue
				seen.add(name)
				entries.push({ name, path: folder + '/' + name, isDir: rest.includes('/') })
			}
		}
		entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'de', { sensitivity: 'base', numeric: true }) : a.isDir ? -1 : 1))
		return entries
	}

	async file(path) {
		if (this.handle) {
			const parts = path.split('/').filter(Boolean)
			const name = parts.pop()
			const dir = await this.directory(parts.join('/'))
			return (await dir.getFileHandle(name)).getFile()
		}
		const file = this.files && this.files.get(path)
		if (!file) throw new Error('Datei nicht gefunden')
		return file
	}

	async read(path) { return new Uint8Array(await (await this.file(path)).arrayBuffer()) }

	sidecarKey(path) { return SIDECAR_PREFIX + this.rootName + path }

	async readText(path) {
		try {
			return await (await this.file(path)).text()
		} catch (e) {
			try { return localStorage.getItem(this.sidecarKey(path)) } catch (ignored) { return null }
		}
	}

	async write(path, text) {
		if (this.handle) {
			try {
				const parts = path.split('/').filter(Boolean)
				const name = parts.pop()
				const dir = await this.directory(parts.join('/'))
				const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
				await writable.write(text)
				await writable.close()
				return
			} catch (e) { /* no write access: keep the marks in the browser */ }
		}
		try { localStorage.setItem(this.sidecarKey(path), text) } catch (e) { throw new Error('Speicher im Browser ist voll oder gesperrt') }
	}
}

// ---- remembering the chosen folder (Chrome, Edge) ---------------------------------------------------------------

function database() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('notenleser', 1)
		request.onupgradeneeded = () => request.result.createObjectStore('state')
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

export async function storeRoot(value) {
	try {
		const db = await database()
		await new Promise((resolve, reject) => {
			const tx = db.transaction('state', 'readwrite')
			tx.objectStore('state').put(value, 'root')
			tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
		})
	} catch (e) { /* not available, e.g. in private windows */ }
}

export async function loadRoot() {
	try {
		const db = await database()
		return await new Promise((resolve, reject) => {
			const request = db.transaction('state').objectStore('state').get('root')
			request.onsuccess = () => resolve(request.result || null)
			request.onerror = () => reject(request.error)
		})
	} catch (e) { return null }
}
