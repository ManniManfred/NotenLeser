import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readMuseScore, looksLikeMuseScore, transposeFifths, tpcName } from '../src/core/museScoreReader.js'
import { ScoreEngraver } from '../src/core/scoreEngraver.js'
import { Performance } from '../src/core/performance.js'
import { SpannerKind } from '../src/core/musicModel.js'
import { parseXml, RecordingPainter } from './helpers.js'

const mscz = new Uint8Array(readFileSync(new URL('./fixtures/test.mscz', import.meta.url)))
const mscx = new Uint8Array(readFileSync(new URL('./fixtures/test.mscx', import.meta.url)))

test('reads compressed and plain MuseScore files alike', () => {
	const a = readMuseScore(mscz, parseXml), b = readMuseScore(mscx, parseXml)
	assert.equal(a.measures.length, 12)
	assert.equal(b.measures.length, 12)
	assert.equal(a.title, 'Testlied')
	assert.equal(a.composer, 'Testkomponist')
	assert.equal(a.staves.length, 2)
	assert.equal(a.staves[0].name, 'Horn in F')
	assert.equal(a.staves[0].program, 60)
	assert.equal(a.staves[1].clef, 'F')
	assert.ok(looksLikeMuseScore(mscx.subarray(0, 512), 'x.unknown'))
	assert.ok(looksLikeMuseScore(new Uint8Array(4), 'Lied.MSCZ'))
})

test('converts transposing instruments to written pitch', () => {
	const score = readMuseScore(mscx, parseXml)
	const first = score.measures[0].staves[0].chordRests[0]
	// Horn in F sounds a fifth lower than written.
	assert.equal(first.notes[0].soundPitch, 60)
	assert.equal(first.notes[0].pitch, 67)
	assert.equal(transposeFifths(-7, -4), 1)
	assert.equal(tpcName(14), 'C')
	assert.equal(tpcName(21), 'C♯')
	assert.equal(tpcName(7), 'C♭')
})

test('reads measures, repeats, voltas, tempo and lyrics', () => {
	const score = readMuseScore(mscx, parseXml)
	assert.equal(score.measures[1].startRepeat, true)
	assert.equal(score.measures[4].endRepeat, 2)
	assert.equal(score.measures[3].lineBreak, true)
	assert.equal(score.measures[0].ticks, 1920)
	assert.equal(score.measures[11].endBarline, 'end')
	assert.equal(score.tempos.get(0), 120)
	const volta = score.spanners.find(s => s.kind === SpannerKind.VOLTA)
	assert.ok(volta)
	assert.equal(volta.startTick, score.measures[4].tick)
	assert.equal(volta.endTick, score.measures[5].tick)
	assert.equal(score.measures[0].staves[0].chordRests[0].lyrics[0].text, 'la')
	assert.equal(score.measures[0].staves[0].annotations.some(a => a.text === 'mf'), true)
})

test('engraves pages with systems, staves and a playback cursor', () => {
	const score = readMuseScore(mscx, parseXml)
	const engraver = new ScoreEngraver(score, new RecordingPainter())
	assert.ok(engraver.pageCount() >= 1)
	const systems = engraver.systemRatios(0)
	assert.ok(systems.length >= 4, 'at least two systems because of the line break')
	for (let i = 0; i + 1 < systems.length; i += 2) {
		assert.ok(systems[i] >= 0 && systems[i] < systems[i + 1] && systems[i + 1] <= 1)
		if (i > 0) assert.ok(systems[i] >= systems[i - 1] - 1e-9, 'systems do not overlap')
	}
	assert.equal(engraver.staffRatios(0).length, systems.length * 2, 'two staves per system')
	const painter = new RecordingPainter()
	engraver.drawPage(painter, 0)
	assert.ok(painter.calls.some(c => c[0] === 'text' && c[1] === 'Testlied'))
	assert.ok(painter.calls.filter(c => c[0] === 'glyph').length > 50)
	for (const call of painter.calls) for (const v of call.slice(1)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `finite ${call[0]}`)
	const cursor = engraver.cursorAt(score.measures[2].tick + 480)
	assert.equal(cursor.page, 0)
	assert.ok(cursor.left < cursor.x && cursor.x < cursor.right)
	assert.equal(engraver.systemStartTick(0, 0), 0)
	assert.equal(engraver.systemStartTick(0, 1), score.measures[4].tick)
	// Tapping into the measure under the cursor finds that measure again.
	const middle = (cursor.top + cursor.bottom) / 2
	assert.equal(engraver.measureAt(0, (cursor.left + cursor.right) / 2, middle), 2)
	assert.equal(engraver.measureAt(0, 0.999, middle), 3)
	const boxes = engraver.measureBoxes(0, 2, 5)
	assert.equal(boxes.length, 2)
	assert.ok(Math.abs(boxes[0].left - cursor.left) < 1e-9)
	assert.equal(boxes[1].system, 1)
})

test('unfolds repeats and voltas for playback', () => {
	const score = readMuseScore(mscx, parseXml)
	const performance = new Performance(score, 1)
	const played = performance.timeline.map(p => score.measures.indexOf(p.measure))
	assert.deepEqual(played, [0, 1, 2, 3, 4, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11])
	// 15 measures of 4 quarters at 120 bpm.
	assert.equal(Math.round(performance.durationMs), 15 * 2000)
	assert.equal(performance.tickAtMs(500), 480)
	assert.equal(performance.tickAtMs(performance.durationMs + 1), -1)
	assert.equal(Math.round(performance.msAtTick(score.measures[5].tick)), 8 * 2000)
	const slow = new Performance(score, 0.5)
	assert.equal(Math.round(slow.durationMs), 15 * 4000)
	assert.ok(performance.notes.length > 0)
	assert.ok(performance.notes.every(n => n.end > n.start))
	assert.equal(performance.notes[0].velocity, 84)
})

test('limits playback to a range of measures', () => {
	const score = readMuseScore(mscx, parseXml)
	const indices = p => p.timeline.map(e => score.measures.indexOf(e.measure))
	// Inside the repeat the range ends where its last measure is first played.
	assert.deepEqual(indices(new Performance(score, 1, { first: 1, last: 3 })), [1, 2, 3])
	// The second volta is reached by the repeat; the measure before the repeat stays out.
	const voltas = new Performance(score, 1, { first: 2, last: 5 })
	assert.deepEqual(indices(voltas), [2, 3, 4, 2, 3, 5])
	assert.equal(Math.round(voltas.durationMs), 6 * 2000)
	assert.equal(voltas.timeline[0].startMs, 0)
	assert.ok(voltas.notes.every(n => n.start >= 0 && n.end <= voltas.durationMs + 1))
	assert.deepEqual(indices(new Performance(score, 1, { first: 9, last: 9 })), [9])
})
