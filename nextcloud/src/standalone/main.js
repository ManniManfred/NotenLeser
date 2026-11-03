import * as pdfjs from 'pdfjs-dist'
import { Reader } from '../web/reader.js'
import { DEFAULT_SETTINGS } from '../nextcloud/settingsStore.js'
import { HttpSource, LocalSettingsStore } from './httpSource.js'

pdfjs.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.js'

const reader = new Reader(document.getElementById('notenleser'), {
	source: new HttpSource(),
	settings: new LocalSettingsStore(DEFAULT_SETTINGS),
	pdfjs,
	fontUrl: 'fonts/Leland.otf',
	version: 'dev',
	onFileChange: path => {
		const url = new URL(location.href)
		url.searchParams.set('file', path)
		history.replaceState(null, '', url)
	},
})
window.notenleser = reader
const file = new URL(location.href).searchParams.get('file')
if (file) reader.openFile(file)
