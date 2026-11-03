import { registerFileAction as registerV4 } from '@nextcloud/files'
import { generateUrl } from '@nextcloud/router'

/**
 * Adds "In NotenLeser öffnen" to PDF and MuseScore files in the Files app. Nextcloud 33 and later read file
 * actions from @nextcloud/files 4, older versions (30–32) from the global list of @nextcloud/files 3, so the
 * action is registered with both. Version 3 is registered directly to keep its heavy dependencies out of the bundle.
 */
function registerV3(action) {
	window._nc_fileactions ??= []
	if (window._nc_fileactions.some(existing => existing.id === action.id)) return
	window._nc_fileactions.push(action)
}

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z"/></svg>'

const isScore = node => node && node.type === 'file' && /\.(pdf|mscz|mscx)$/i.test(node.basename || '')
const isMuseScore = node => /\.(mscz|mscx)$/i.test(node.basename || '')

function open(node) {
	window.location.href = generateUrl('/apps/notenleser/') + '?file=' + encodeURIComponent(node.path)
	return Promise.resolve(null)
}

const definition = {
	id: 'notenleser-open',
	order: -20,
	iconSvgInline: () => ICON,
}

try {
	registerV4({
		...definition,
		displayName: () => 'In NotenLeser öffnen',
		enabled: ({ nodes }) => nodes.length === 1 && isScore(nodes[0]),
		exec: ({ nodes }) => open(nodes[0]),
	})
} catch (e) { console.debug('NotenLeser: file action (v4) not registered', e) }

try {
	registerV3({
		...definition,
		displayName: () => 'In NotenLeser öffnen',
		enabled: nodes => nodes.length === 1 && isScore(nodes[0]),
		exec: node => open(node),
	})
	// MuseScore files have no other viewer, so a click opens them directly.
	registerV3({
		...definition,
		id: 'notenleser-open-default',
		displayName: () => 'In NotenLeser öffnen',
		enabled: nodes => nodes.length === 1 && isScore(nodes[0]) && isMuseScore(nodes[0]),
		exec: node => open(node),
		default: 'default',
	})
} catch (e) { console.debug('NotenLeser: file action (v3) not registered', e) }

try {
	registerV4({
		...definition,
		id: 'notenleser-open-default',
		displayName: () => 'In NotenLeser öffnen',
		enabled: ({ nodes }) => nodes.length === 1 && isScore(nodes[0]) && isMuseScore(nodes[0]),
		exec: ({ nodes }) => open(nodes[0]),
		default: 'default',
	})
} catch (e) { console.debug('NotenLeser: default file action (v4) not registered', e) }
