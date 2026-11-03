import * as pdfjs from 'pdfjs-dist'
import { loadState } from '@nextcloud/initial-state'
import { generateFilePath, generateUrl } from '@nextcloud/router'
import { Reader } from '../web/reader.js'
import { DavSource, normalize } from './davSource.js'
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
		version: loadState('notenleser', 'version', ''),
		bare: loadState('notenleser', 'bare', false),
		bareUrl: path => generateUrl('/apps/notenleser/reader') + (path ? '?file=' + encodeURIComponent(path) : ''),
		homeUrl: path => generateUrl('/apps/notenleser/') + (path ? '?file=' + encodeURIComponent(path) : ''),
		// The opened file is kept in the address, so reloading or sharing the link opens it again.
		onFileChange: path => {
			const url = new URL(location.href)
			url.searchParams.set('file', path)
			history.replaceState(null, '', url)
		},
	})
	const file = new URL(location.href).searchParams.get('file')
	if (file) reader.openFile(normalize(file))
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
