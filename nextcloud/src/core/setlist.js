/**
 * Setlists ("Zusammenstellungen"): an ordered list of scores from any folders, stored as "<Title>.setlist.json".
 * The scores are kept relative to the setlist's folder, so a setlist keeps working when the folder is moved or
 * shared with someone who sees it under a different path. The same score may appear more than once.
 *
 *   { "version": 1, "title": "Konzert", "files": ["Lied.pdf", "../Andere/Marsch.mscz"] }
 */
export const SETLIST_SUFFIX = '.setlist.json'

export const isSetlistFileName = name => name.toLowerCase().endsWith(SETLIST_SUFFIX)

const parentOf = path => path.substring(0, path.lastIndexOf('/')) || '/'

/** Title derived from a setlist file name, e.g. "/Noten/Konzert.setlist.json" → "Konzert". */
export function setlistTitle(path) {
	const name = path.substring(path.lastIndexOf('/') + 1)
	return isSetlistFileName(name) ? name.substring(0, name.length - SETLIST_SUFFIX.length) : name
}

/** File name for a setlist title; characters that are not allowed in file names are replaced. */
export function setlistFileName(title) {
	const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
	return (clean || 'Zusammenstellung') + SETLIST_SUFFIX
}

/** Path of `target` relative to `folder`, both absolute ("/a/b"). */
export function relativePath(folder, target) {
	const from = folder.split('/').filter(Boolean)
	const to = target.split('/').filter(Boolean)
	let common = 0
	while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
	return [...Array(from.length - common).fill('..'), ...to.slice(common)].join('/')
}

/** Absolute path of `relative` seen from `folder`; absolute paths are kept, ".." never leaves the root. */
export function resolvePath(folder, relative) {
	const parts = relative.startsWith('/') ? [] : folder.split('/').filter(Boolean)
	for (const part of relative.split('/')) {
		if (part === '' || part === '.') continue
		if (part === '..') parts.pop()
		else parts.push(part)
	}
	return '/' + parts.join('/')
}

/** Reads a setlist file; returns {title, files: [absolute paths]}. Throws on files that are not setlists. */
export function parseSetlist(text, path) {
	let data
	try { data = JSON.parse(text) } catch (e) { throw new Error('Die Zusammenstellung ist keine gültige JSON-Datei') }
	if (!data || typeof data !== 'object' || !Array.isArray(data.files)) throw new Error('Die Datei ist keine Zusammenstellung')
	const folder = parentOf(path)
	const files = data.files.filter(file => typeof file === 'string' && file.trim() !== '').map(file => resolvePath(folder, file))
	const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : setlistTitle(path)
	return { title, files }
}

/** Text of a setlist file stored at `path`. */
export function serializeSetlist(title, files, path) {
	const folder = parentOf(path)
	return JSON.stringify({ version: 1, title, files: files.map(file => relativePath(folder, file)) }, null, 2) + '\n'
}
