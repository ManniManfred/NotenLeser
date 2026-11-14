/**
 * Sampled instruments for playback, made from a General MIDI SoundFont by scripts/build-sounds.mjs.
 * Every GM program is a file <program>.wav, the drum kit drums.wav; they are loaded when a score needs them.
 */
const STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767]
const INDEX_STEP = [-1, -1, -1, -1, 2, 4, 6, 8]

/** Decodes IMA ADPCM blocks (4-byte header, then two samples per byte, low nibble first). */
export function decodeAdpcm(bytes, block, first, count) {
	const perBlock = (block - 4) * 2 + 1
	const out = new Float32Array(count)
	let n = 0
	for (let b = Math.floor(first / perBlock); n < count; b++) {
		const o = b * block
		let predictor = (bytes[o] | (bytes[o + 1] << 8)) << 16 >> 16
		let index = bytes[o + 2]
		out[n++] = predictor / 32768
		for (let i = 1; i < perBlock && n < count; i++) {
			const byte = bytes[o + 4 + ((i - 1) >> 1)]
			const nibble = (i - 1) & 1 ? byte >> 4 : byte & 15
			const step = STEPS[index]
			let delta = step >> 3
			if (nibble & 4) delta += step
			if (nibble & 2) delta += step >> 1
			if (nibble & 1) delta += step >> 2
			predictor = Math.max(-32768, Math.min(32767, nibble & 8 ? predictor - delta : predictor + delta))
			index = Math.max(0, Math.min(88, index + INDEX_STEP[nibble & 7]))
			out[n++] = predictor / 32768
		}
	}
	return out
}

/** Reads an instrument file into {name, zones, samples: [Float32Array with rate]}. */
export function parseInstrument(arrayBuffer) {
	const bytes = new Uint8Array(arrayBuffer)
	const view = new DataView(arrayBuffer)
	const tag = o => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
	if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Keine Klangdatei')
	let info = null, data = null
	for (let o = 12; o + 8 <= bytes.length;) {
		const size = view.getUint32(o + 4, true)
		if (tag(o) === 'nlsf') info = JSON.parse(new TextDecoder().decode(bytes.subarray(o + 8, o + 8 + size)))
		else if (tag(o) === 'data') data = bytes.subarray(o + 8, o + 8 + size)
		o += 8 + size + (size & 1)
	}
	if (!info || !data || info.version !== 1) throw new Error('Unbekanntes Klangformat')
	const samples = info.samples.map(s => ({ rate: s.rate, data: decodeAdpcm(data, info.block, s.start, s.length) }))
	return { name: info.name, zones: info.zones, samples }
}

export class SoundBank {
	/** urlFor(name) gives the address of a sound file, e.g. name => 'sounds/' + name + '.wav'. */
	constructor(urlFor) {
		this.urlFor = urlFor
		this.loaded = new Map() // file name -> Promise of instrument
	}

	/** Loads an instrument for a context; resolves with null when it cannot be loaded. */
	instrument(context, name) {
		if (!this.loaded.has(name)) {
			this.loaded.set(name, fetch(this.urlFor(name))
				.then(response => {
					if (!response.ok) throw new Error(`${response.status}`)
					return response.arrayBuffer()
				})
				.then(buffer => {
					const instrument = parseInstrument(buffer)
					instrument.buffers = instrument.samples.map(s => {
						const audio = context.createBuffer(1, Math.max(1, s.data.length), s.rate)
						audio.getChannelData(0).set(s.data)
						return audio
					})
					instrument.samples = null
					return instrument
				})
				.catch(e => {
					console.warn('Klang nicht geladen: ' + name, e)
					this.loaded.delete(name)
					return null
				}))
		}
		return this.loaded.get(name)
	}
}

/** Zones of an instrument that sound for a key and velocity; drums have no sound outside their keys. */
export function zonesFor(instrument, key, velocity, drums = false) {
	const zones = instrument.zones.filter(z => key >= z.keys[0] && key <= z.keys[1] && velocity >= z.vels[0] && velocity <= z.vels[1])
	if (zones.length > 0) return zones
	// Velocities of layers left out of the sound files use the kept layer.
	const anyVelocity = instrument.zones.filter(z => key >= z.keys[0] && key <= z.keys[1])
	if (anyVelocity.length > 0 || drums) return anyVelocity.slice(0, 1)
	// Keys outside the instrument's range use its nearest zone.
	let best = null, distance = Infinity
	for (const z of instrument.zones) {
		const d = key < z.keys[0] ? z.keys[0] - key : key - z.keys[1]
		if (d < distance) { distance = d; best = z }
	}
	return best ? [best] : []
}
