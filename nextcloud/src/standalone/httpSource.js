/**
 * File access through the small HTTP API of scripts/dev-server.mjs. Used for local development and testing
 * without Nextcloud; a desktop shell can provide the same four methods.
 */
export class HttpSource {
	constructor(base = '/api') { this.base = base; this.label = 'Lokal' }

	async list(path) {
		const response = await fetch(`${this.base}/list?path=${encodeURIComponent(path)}`)
		if (!response.ok) throw new Error(`Ordner konnte nicht gelesen werden (HTTP ${response.status})`)
		return response.json()
	}

	async read(path) {
		const response = await fetch(`${this.base}/file?path=${encodeURIComponent(path)}`)
		if (!response.ok) throw new Error(response.status === 404 ? 'Datei nicht gefunden' : `HTTP ${response.status}`)
		return new Uint8Array(await response.arrayBuffer())
	}

	async readText(path) {
		const response = await fetch(`${this.base}/file?path=${encodeURIComponent(path)}`)
		if (response.status === 404) return null
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return response.text()
	}

	async write(path, text) {
		const response = await fetch(`${this.base}/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body: text })
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
	}
}

/** Settings kept in the browser for the standalone version. */
export class LocalSettingsStore {
	constructor(defaults) { this.defaults = defaults }
	load() {
		try { return { ...this.defaults, ...JSON.parse(localStorage.getItem('notenleser-settings') || '{}') } } catch (e) { return { ...this.defaults } }
	}

	async save(values) {
		try { localStorage.setItem('notenleser-settings', JSON.stringify({ ...this.load(), ...values })) } catch (e) { /* storage blocked */ }
	}
}
