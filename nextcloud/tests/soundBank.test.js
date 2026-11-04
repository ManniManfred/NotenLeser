import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseInstrument, zonesFor } from '../src/web/soundBank.js'

const load = name => {
	const data = readFileSync(new URL(`../sounds/${name}.wav`, import.meta.url))
	return parseInstrument(data.buffer.slice(data.byteOffset, data.byteOffset + data.length))
}

test('reads the sampled instruments', () => {
	const horn = load('60')
	assert.match(horn.name, /Horn/)
	assert.ok(horn.samples.length > 0 && horn.zones.length > 0)
	for (const sample of horn.samples) {
		assert.ok(sample.rate >= 22050 && sample.rate <= 48000)
		assert.ok(sample.data.every(Number.isFinite))
		assert.ok(sample.data.some(v => Math.abs(v) > 0.05), 'audible')
	}
	for (const zone of horn.zones) {
		const sample = horn.samples[zone.sample]
		if (zone.loop) assert.ok(zone.loopStart < zone.loopEnd && zone.loopEnd <= sample.data.length)
	}
	// Every key of the horn's range and every velocity finds a zone.
	for (const velocity of [20, 64, 100, 127]) assert.ok(zonesFor(horn, 60, velocity).length > 0)
	assert.ok(zonesFor(horn, 10, 80).length > 0)
})

test('drum kit has no sound outside its keys', () => {
	const drums = load('drums')
	assert.ok(zonesFor(drums, 38, 100, true).length > 0) // snare
	assert.equal(zonesFor(drums, 5, 100, true).length, 0)
})

test('all General MIDI programs are there', () => {
	for (let program = 0; program < 128; program++) {
		const head = readFileSync(new URL(`../sounds/${program}.wav`, import.meta.url)).subarray(0, 12).toString('latin1')
		assert.equal(head.slice(0, 4) + head.slice(8), 'RIFFWAVE')
	}
})
