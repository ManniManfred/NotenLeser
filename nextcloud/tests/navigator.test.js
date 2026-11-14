import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ScoreNavigator } from '../src/core/navigator.js'
import { sidecarName } from '../src/web/reader.js'

/** Pages of aspect 1.4; page 0 is a cover page without systems, the others have four systems each. */
function navigator(pages = 3) {
	const doc = { pageCount: pages, pageAspect: () => 1.4, systemRatios: () => null, staffRatios: () => null }
	const detect = async page => (page === 0 ? { systems: [], staves: [] } : {
		systems: [0.05, 0.25, 0.3, 0.5, 0.55, 0.75, 0.8, 0.95],
		staves: [0.08, 0.12, 0.16, 0.2, 0.33, 0.37, 0.41, 0.45, 0.58, 0.62, 0.66, 0.7, 0.83, 0.87, 0.89, 0.92],
	})
	const nav = new ScoreNavigator(doc, detect)
	// 280 px per system at 1000 px width; 300 px of screen height fits one system.
	nav.setViewport(1000, 300, 7)
	return nav
}

test('skips the cover page and moves system by system across pages', async () => {
	const nav = navigator()
	await nav.computeVisible()
	assert.equal(nav.page, 1)
	assert.deepEqual(nav.visible.map(s => s.index), [0])
	for (let i = 0; i < 3; i++) assert.equal(await nav.next(), 'moved')
	assert.deepEqual([nav.page, nav.system], [1, 3])
	assert.equal(await nav.next(), 'moved')
	assert.deepEqual([nav.page, nav.system], [2, 0])
	assert.equal(await nav.previous(), 'moved')
	assert.deepEqual([nav.page, nav.system], [1, 3])
	nav.page = 2; nav.system = 3
	assert.equal(await nav.next(), 'end')
	nav.page = 1; nav.system = 0
	assert.equal(await nav.previous(), 'start')
})

test('shows several systems when they fit and pages by whole screens', async () => {
	const nav = navigator()
	nav.setViewport(1000, 900, 7)
	await nav.computeVisible()
	assert.deepEqual(nav.visible.map(s => `${s.page}.${s.index}`), ['1.0', '1.1', '1.2'])
	await nav.next(true)
	assert.deepEqual([nav.page, nav.system], [1, 3])
	await nav.computeVisible()
	assert.deepEqual(nav.visible.map(s => `${s.page}.${s.index}`), ['1.3', '2.0', '2.1'])
	await nav.previous(true)
	await nav.computeVisible()
	assert.deepEqual(nav.visible.map(s => `${s.page}.${s.index}`), ['1.0', '1.1', '1.2'])
})

test('always shows a second system when asked to', async () => {
	const nav = navigator()
	nav.twoSystemsMinimum = true
	await nav.computeVisible()
	assert.equal(nav.visible.length, 2)
})

test('fills the end of the score with earlier systems', async () => {
	const nav = navigator()
	nav.setViewport(1000, 900, 7)
	nav.page = 2; nav.system = 3
	await nav.computeVisible()
	assert.deepEqual(nav.visible.map(s => `${s.page}.${s.index}`), ['2.1', '2.2', '2.3'])
})

test('manual systems replace detection and empty pages are skipped', async () => {
	const nav = navigator()
	nav.manual.set(1, [])
	await nav.computeVisible()
	assert.equal(nav.page, 2)
	nav.manual.set(2, [0.1, 0.5])
	assert.equal(await nav.systemCount(2), 1)
})

test('page mode turns whole pages', async () => {
	const nav = navigator()
	nav.autoDetection = false
	assert.equal(await nav.next(), 'moved')
	assert.equal(nav.page, 1)
	await nav.goToEnd()
	assert.equal(nav.page, 2)
})

test('finds the player\'s staff within a system', async () => {
	const nav = navigator()
	assert.deepEqual(await nav.voiceStaff(1, 0.05, 0.25, 2), { top: 0.16, bottom: 0.2 })
	assert.equal(await nav.voiceStaff(1, 0.05, 0.25, 0), null)
})

test('names the sidecar file next to the score', () => {
	assert.equal(sidecarName('Lied.pdf'), 'Lied.systems.json')
	assert.equal(sidecarName('Lied.PDF'), 'Lied.systems.json')
	assert.equal(sidecarName('Lied.mscz'), 'Lied.mscz.systems.json')
})
