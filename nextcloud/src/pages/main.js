import * as pdfjs from 'pdfjs-dist'
import { Reader } from '../web/reader.js'
import { DEFAULT_SETTINGS } from '../web/settings.js'
import { LocalSettingsStore } from '../standalone/httpSource.js'
import { LocalSource, loadRoot, storeRoot } from './localSource.js'

/* global __VERSION__ */
pdfjs.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.js'

const source = new LocalSource()
const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Opens the browser's file dialog; resolves with the chosen files or null when cancelled. */
function pickWithInput({ folder }) {
	return new Promise(resolve => {
		const input = document.createElement('input')
		input.type = 'file'
		input.multiple = true
		if (folder) input.webkitdirectory = true
		else input.accept = '.pdf,.mscz,.mscx,application/pdf'
		input.addEventListener('change', () => resolve(input.files && input.files.length ? [...input.files] : null))
		input.addEventListener('cancel', () => resolve(null))
		input.click()
	})
}

async function pickFile() {
	const files = await pickWithInput({ folder: false })
	if (!files) return null
	// All picked files form the folder, so swiping up and down switches between them.
	source.useFiles(files)
	await storeRoot(null)
	return '/' + files[0].name
}

async function pickFolder() {
	if (LocalSource.folderAccessSupported()) {
		try {
			const handle = await window.showDirectoryPicker({ id: 'notenleser', mode: 'readwrite' })
			source.useHandle(handle)
			await storeRoot({ kind: 'handle', handle })
			return '/'
		} catch (e) {
			if (e && e.name === 'AbortError') return null
			throw new Error('Ordner konnte nicht geöffnet werden: ' + e.message)
		}
	}
	// iPhone and iPad cannot pick folders; picking several files works the same for reading.
	const files = await pickWithInput({ folder: !isAppleMobile })
	if (!files) return null
	source.useFiles(files, files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : 'Auswahl')
	await storeRoot(null)
	return '/'
}

async function openDemo(reader) {
	try {
		await source.useDemo('demo/')
		await storeRoot({ kind: 'demo' })
		const files = await source.list('/')
		reader.openFile(files.find(f => !f.isDir).path)
	} catch (e) {
		reader.toast(e.message, true)
	}
}

async function start() {
	const settings = new LocalSettingsStore(DEFAULT_SETTINGS)
	const root = await loadRoot()
	// Only a remembered folder or the examples can be reopened after a reload.
	if (!root && settings.load().lastFile) await settings.save({ lastFile: '' })
	let reader = null
	reader = new Reader(document.getElementById('notenleser'), {
		source,
		settings,
		pdfjs,
		fontUrl: 'fonts/Leland.otf',
		version: __VERSION__,
		intro: 'Öffne Noten (PDF oder MuseScore) von deinem Gerät oder wähle einen Ordner mit Noten. Die Dateien bleiben auf deinem Gerät und werden nirgends hochgeladen.',
		pickFile,
		pickFolder,
		startActions: [['Beispiel ansehen', openDemo]],
		onContinue: async () => {
			try {
				if (root && root.kind === 'demo') { await source.useDemo('demo/'); return true }
				if (root && root.kind === 'handle') {
					const options = { mode: 'readwrite' }
					if ((await root.handle.queryPermission(options)) !== 'granted' && (await root.handle.requestPermission(options)) !== 'granted') {
						reader.toast('Ohne Zugriff auf den Ordner können die Noten nicht geöffnet werden', true)
						return false
					}
					source.useHandle(root.handle)
					return true
				}
			} catch (e) { /* fall through */ }
			reader.toast('Bitte den Ordner erneut öffnen', true)
			return false
		},
	})
	window.notenleser = reader
	// Installed as an app, the NotenLeser can be chosen to open PDF and MuseScore files from the system.
	if ('launchQueue' in window) {
		window.launchQueue.setConsumer(async params => {
			if (!params.files || params.files.length === 0) return
			const files = await Promise.all(params.files.map(handle => handle.getFile()))
			source.useFiles(files)
			reader.openFile('/' + files[0].name)
		})
	}
}

start()

if ('serviceWorker' in navigator && window.isSecureContext) {
	navigator.serviceWorker.register('sw.js').catch(() => {})
}
