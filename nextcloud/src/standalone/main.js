import * as pdfjs from 'pdfjs-dist'
import { Reader } from '../web/reader.js'
import { DEFAULT_SETTINGS } from '../web/settings.js'
import { HttpSource, LocalSettingsStore } from './httpSource.js'

pdfjs.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.js'

const reader = new Reader(document.getElementById('notenleser'), {
	source: new HttpSource(),
	settings: new LocalSettingsStore(DEFAULT_SETTINGS),
	pdfjs,
	fontUrl: 'fonts/Leland.otf',
	soundUrl: name => 'sounds/' + name + '.wav',
	version: 'dev',
	// ?bare=1 hides nothing here, but lets the header-less mode and its way back be tried out.
	bare: new URL(location.href).searchParams.get('bare') === '1',
	bareUrl: path => '?bare=1' + (path ? '&file=' + encodeURIComponent(path) : ''),
	homeUrl: path => '?' + (path ? 'file=' + encodeURIComponent(path) : ''),
	setlists: true,
	onFileChange: (path, setlist) => {
		const url = new URL(location.href)
		url.searchParams.set('file', path)
		if (setlist) url.searchParams.set('setlist', setlist)
		else url.searchParams.delete('setlist')
		history.replaceState(null, '', url)
	},
})
window.notenleser = reader
const params = new URL(location.href).searchParams
if (params.get('setlist')) reader.openSetlist(params.get('setlist'), params.get('file'))
else if (params.get('file')) reader.openFile(params.get('file'))
