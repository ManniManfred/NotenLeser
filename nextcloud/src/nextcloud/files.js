import { registerFileAction as registerV4 } from '@nextcloud/files'
import { generateUrl } from '@nextcloud/router'
import { NEW_SETLIST_KEY } from './handover.js'

/**
 * Adds "In NotenLeser öffnen" to PDF, MuseScore and setlist files in the Files app, and "Als Zusammenstellung
 * im NotenLeser" to a selection of several scores. Nextcloud 33 and later read file
 * actions from @nextcloud/files 4, older versions (30–32) from the global list of @nextcloud/files 3, so the
 * action is registered with both. Version 3 is registered directly to keep its heavy dependencies out of the bundle.
 */
function registerV3(action) {
	window._nc_fileactions ??= []
	if (window._nc_fileactions.some(existing => existing.id === action.id)) return
	window._nc_fileactions.push(action)
}

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z"/></svg>'

const LIST_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h12v2H3V5Zm0 4h12v2H3V9Zm0 4h8v2H3v-2Zm14-2v6.55A3 3 0 1 0 19 20.5V13h3v-2h-5Z"/></svg>'

const isFile = node => node && node.type === 'file'
const isSetlist = node => isFile(node) && /\.setlist\.json$/i.test(node.basename || '')
const isScore = node => isFile(node) && /\.(pdf|mscz|mscx)$/i.test(node.basename || '')
const isOpenable = node => isScore(node) || isSetlist(node)
// MuseScore and setlist files have no other viewer, so a click opens them directly.
const isOwnType = node => isSetlist(node) || (isScore(node) && /\.(mscz|mscx)$/i.test(node.basename || ''))

function open(node) {
	const parameter = isSetlist(node) ? 'setlist' : 'file'
	window.location.href = generateUrl('/apps/notenleser/') + '?' + parameter + '=' + encodeURIComponent(node.path)
	return Promise.resolve(null)
}

function createSetlist(nodes) {
	const paths = nodes.filter(isScore).map(node => node.path)
		.sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base', numeric: true }))
	try { sessionStorage.setItem(NEW_SETLIST_KEY, JSON.stringify(paths)) } catch (e) { return Promise.resolve(nodes.map(() => false)) }
	window.location.href = generateUrl('/apps/notenleser/') + '?newSetlist=1'
	return Promise.resolve(nodes.map(() => null))
}

const setlistDefinition = {
	id: 'notenleser-setlist',
	order: -19,
	iconSvgInline: () => LIST_ICON,
	displayName: () => 'Als Zusammenstellung im NotenLeser',
}
const canCreateSetlist = nodes => nodes.length > 1 && nodes.every(isScore)

const definition = {
	id: 'notenleser-open',
	order: -20,
	iconSvgInline: () => ICON,
}

try {
	registerV4({
		...definition,
		displayName: () => 'In NotenLeser öffnen',
		enabled: ({ nodes }) => nodes.length === 1 && isOpenable(nodes[0]),
		exec: ({ nodes }) => open(nodes[0]),
	})
} catch (e) { console.debug('NotenLeser: file action (v4) not registered', e) }

try {
	registerV3({
		...definition,
		displayName: () => 'In NotenLeser öffnen',
		enabled: nodes => nodes.length === 1 && isOpenable(nodes[0]),
		exec: node => open(node),
	})
	registerV3({
		...definition,
		id: 'notenleser-open-default',
		displayName: () => 'In NotenLeser öffnen',
		enabled: nodes => nodes.length === 1 && isOwnType(nodes[0]),
		exec: node => open(node),
		default: 'default',
	})
} catch (e) { console.debug('NotenLeser: file action (v3) not registered', e) }

try {
	registerV4({
		...definition,
		id: 'notenleser-open-default',
		displayName: () => 'In NotenLeser öffnen',
		enabled: ({ nodes }) => nodes.length === 1 && isOwnType(nodes[0]),
		exec: ({ nodes }) => open(nodes[0]),
		default: 'default',
	})
} catch (e) { console.debug('NotenLeser: default file action (v4) not registered', e) }

try {
	registerV4({
		...setlistDefinition,
		enabled: ({ nodes }) => canCreateSetlist(nodes),
		exec: () => Promise.resolve(null),
		execBatch: ({ nodes }) => createSetlist(nodes),
	})
} catch (e) { console.debug('NotenLeser: setlist action (v4) not registered', e) }

try {
	registerV3({
		...setlistDefinition,
		enabled: nodes => canCreateSetlist(nodes),
		exec: () => Promise.resolve(null),
		execBatch: nodes => createSetlist(nodes),
	})
} catch (e) { console.debug('NotenLeser: setlist action (v3) not registered', e) }
