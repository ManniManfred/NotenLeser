import * as pdfjs from 'pdfjs-dist'
import { loadState } from '@nextcloud/initial-state'
import { generateFilePath, generateUrl } from '@nextcloud/router'
import { Reader } from '../web/reader.js'
import { DavSource, normalize } from './davSource.js'
import { NEW_SETLIST_KEY } from './handover.js'
import { NextcloudSettingsStore } from './settingsStore.js'

pdfjs.GlobalWorkerOptions.workerSrc = generateFilePath('notenleser', 'js', 'pdf.worker.js')

function start() {
	const root = document.getElementById('notenleser')
	if (!root) return
	const reader = new Reader(root, {
		source: new DavSource(),
		settings: new NextcloudSettingsStore(),
		pdfjs,
		fontUrl: generateFilePath('notenleser', 'fonts', 'Leland.otf'),
		soundUrl: name => generateFilePath('notenleser', 'sounds', name + '.wav'),
		version: loadState('notenleser', 'version', ''),
		bare: loadState('notenleser', 'bare', false),
		bareUrl: path => generateUrl('/apps/notenleser/reader') + (path ? '?file=' + encodeURIComponent(path) : ''),
		homeUrl: path => generateUrl('/apps/notenleser/') + (path ? '?file=' + encodeURIComponent(path) : ''),
		// The opened file is kept in the address, so reloading or sharing the link opens it again.
		setlists: true,
		// The opened file (and setlist) is kept in the address, so reloading or sharing the link opens it again.
		onFileChange: (path, setlist) => {
			const url = new URL(location.href)
			url.searchParams.set('file', path)
			if (setlist) url.searchParams.set('setlist', setlist)
			else url.searchParams.delete('setlist')
			history.replaceState(null, '', url)
		},
	})
	const params = new URL(location.href).searchParams
	const file = params.get('file'), setlist = params.get('setlist')
	if (setlist) reader.openSetlist(normalize(setlist), file ? normalize(file) : null)
	else if (file) reader.openFile(normalize(file))
	// Scores chosen in the Files app ("Als Zusammenstellung"); handed over in the session storage of this tab.
	if (params.has('newSetlist')) {
		let files = []
		try { files = JSON.parse(sessionStorage.getItem(NEW_SETLIST_KEY) || '[]').map(normalize) } catch (e) { /* none */ }
		sessionStorage.removeItem(NEW_SETLIST_KEY)
		const url = new URL(location.href)
		url.searchParams.delete('newSetlist')
		history.replaceState(null, '', url)
		reader.createSetlist(files)
	}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
