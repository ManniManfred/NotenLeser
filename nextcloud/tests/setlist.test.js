import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	isSetlistFileName, parseSetlist, relativePath, resolvePath, serializeSetlist, setlistFileName, setlistTitle,
} from '../src/core/setlist.js'

test('relative paths between folders', () => {
	assert.equal(relativePath('/Noten/Konzert', '/Noten/Konzert/Lied.pdf'), 'Lied.pdf')
	assert.equal(relativePath('/Noten/Konzert', '/Noten/Märsche/Marsch.mscz'), '../Märsche/Marsch.mscz')
	assert.equal(relativePath('/', '/Noten/Lied.pdf'), 'Noten/Lied.pdf')
	assert.equal(relativePath('/a/b/c', '/x.pdf'), '../../../x.pdf')
	assert.equal(resolvePath('/Noten/Konzert', '../Märsche/Marsch.mscz'), '/Noten/Märsche/Marsch.mscz')
	assert.equal(resolvePath('/Noten', './Lied.pdf'), '/Noten/Lied.pdf')
	assert.equal(resolvePath('/Noten', '/Andere/Lied.pdf'), '/Andere/Lied.pdf')
	assert.equal(resolvePath('/', '../../Lied.pdf'), '/Lied.pdf')
})

test('a setlist survives writing and reading, keeping order and repeated scores', () => {
	const path = '/Noten/Konzert.setlist.json'
	const files = ['/Noten/B.pdf', '/Märsche/A.mscz', '/Noten/B.pdf']
	const text = serializeSetlist('Konzert im Mai', files, path)
	assert.deepEqual(JSON.parse(text).files, ['B.pdf', '../Märsche/A.mscz', 'B.pdf'])
	assert.deepEqual(parseSetlist(text, path), { title: 'Konzert im Mai', files })
	// Moved together with its scores, the setlist still finds them.
	assert.deepEqual(parseSetlist(text, '/Archiv/Noten/Konzert.setlist.json').files, ['/Archiv/Noten/B.pdf', '/Archiv/Märsche/A.mscz', '/Archiv/Noten/B.pdf'])
})

test('setlist names and broken files', () => {
	assert.ok(isSetlistFileName('Konzert.SETLIST.json'))
	assert.ok(!isSetlistFileName('Lied.systems.json'))
	assert.equal(setlistTitle('/Noten/Konzert.setlist.json'), 'Konzert')
	assert.equal(setlistFileName('Probe 12/5: "Teil 1"'), 'Probe 12-5- -Teil 1-.setlist.json')
	assert.equal(setlistFileName('  '), 'Zusammenstellung.setlist.json')
	assert.equal(parseSetlist('{"files":["x.pdf", 3, ""]}', '/N/Ohne Titel.setlist.json').title, 'Ohne Titel')
	assert.deepEqual(parseSetlist('{"files":["x.pdf", 3, ""]}', '/N/a.setlist.json').files, ['/N/x.pdf'])
	assert.throws(() => parseSetlist('kein json', '/a.setlist.json'), /keine gültige JSON/)
	assert.throws(() => parseSetlist('{"pages":{}}', '/a.setlist.json'), /keine Zusammenstellung/)
})
