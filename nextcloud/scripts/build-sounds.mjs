// Converts a General MIDI SoundFont (.sf2 or .sf3) into the small instrument files the web player loads on demand:
//   node scripts/build-sounds.mjs <soundfont> [output folder, default sounds/]
// Needs ffmpeg for the Ogg Vorbis samples of .sf3 files.
//
// Each GM program becomes sounds/<program>.wav, the drum kit sounds/drums.wav. The files are WAVE files with
// IMA ADPCM (4 bits per sample, blocks of 256 bytes) and an extra "nlsf" chunk with the instrument as JSON:
//   samples: [{start, length, rate}]       start/length in decoded frames of the data chunk
//   zones:   [{keys, vels, sample, root, tune, scale, loop, loopStart, loopEnd, gain,
//              attack, hold, decay, sustain, release, keyHold, keyDecay, filter, q}]
// Times are seconds, gain and sustain linear factors, filter the low-pass cutoff in Hz (0 = none).
// To keep the files small, samples are resampled to about 22 kHz (drums 32 kHz), only one velocity layer
// is kept (other velocities use it too), stereo pairs become mono and unlooped samples end after 8 seconds.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [input, output = join(import.meta.dirname, '..', 'sounds')] = process.argv.slice(2)
if (!input) { console.error('Aufruf: node scripts/build-sounds.mjs <soundfont.sf2|sf3> [Zielordner]'); process.exit(1) }

const MELODIC_RATE = 22050, DRUM_RATE = 32000, LAYER_VELOCITY = 100, BLOCK = 256, MAX_SECONDS = 8, FADE_SECONDS = 0.5
const SAMPLES_PER_BLOCK = (BLOCK - 4) * 2 + 1

// ---- SoundFont parsing ---------------------------------------------------------------------------------------

const buf = readFileSync(input)
const str = (o, n) => buf.toString('latin1', o, o + n).replace(/\0.*$/s, '')
const chunks = {}
;(function walk(start, end) {
	for (let o = start; o + 8 <= end;) {
		const id = str(o, 4), size = buf.readUInt32LE(o + 4)
		if (id === 'RIFF' || id === 'LIST') walk(o + 12, o + 8 + size)
		else chunks[id] = { offset: o + 8, size }
		o += 8 + size + (size & 1)
	}
})(0, buf.length)
const records = (id, size, read) => {
	const c = chunks[id], out = []
	for (let o = c.offset; o + size <= c.offset + c.size; o += size) out.push(read(o))
	return out
}
const phdr = records('phdr', 38, o => ({ name: str(o, 20), preset: buf.readUInt16LE(o + 20), bank: buf.readUInt16LE(o + 22), bag: buf.readUInt16LE(o + 24) }))
const bags = id => records(id, 4, o => buf.readUInt16LE(o))
const gens = id => records(id, 4, o => ({ op: buf.readUInt16LE(o), lo: buf[o + 2], hi: buf[o + 3], amount: buf.readInt16LE(o + 2) }))
const pbag = bags('pbag'), pgen = gens('pgen'), ibag = bags('ibag'), igen = gens('igen')
const inst = records('inst', 22, o => ({ name: str(o, 20), bag: buf.readUInt16LE(o + 20) }))
const shdr = records('shdr', 46, o => ({
	name: str(o, 20), start: buf.readUInt32LE(o + 20), end: buf.readUInt32LE(o + 24),
	loopStart: buf.readUInt32LE(o + 28), loopEnd: buf.readUInt32LE(o + 32), rate: buf.readUInt32LE(o + 36),
	key: buf[o + 40], correction: buf.readInt8(o + 41), type: buf.readUInt16LE(o + 44),
}))
const smpl = chunks.smpl

const KEY_RANGE = 43, VEL_RANGE = 44, INSTRUMENT = 41, SAMPLE_ID = 53
function zonesOf(bagList, genList, from, to, terminal) {
	const zones = []
	for (let b = from; b < to; b++) {
		const g = {}
		for (let i = bagList[b]; i < bagList[b + 1]; i++) {
			const e = genList[i]
			g[e.op] = e.op === KEY_RANGE || e.op === VEL_RANGE ? [e.lo, e.hi] : e.amount
		}
		zones.push(g)
	}
	const global = zones.length > 0 && zones[0][terminal] === undefined ? zones.shift() : {}
	return { global, zones }
}
const instruments = inst.slice(0, -1).map((ins, i) => ({ name: ins.name, ...zonesOf(ibag, igen, ins.bag, inst[i + 1].bag, SAMPLE_ID) }))
const presets = phdr.slice(0, -1).map((p, i) => ({ ...p, ...zonesOf(pbag, pgen, p.bag, phdr[i + 1].bag, INSTRUMENT) }))

// ---- samples -------------------------------------------------------------------------------------------------

const compressed = shdr.some(s => s.type & 0x10)
const decodedCache = new Map()
/** Sample data as Float32Array at the sample's own rate; loop points of .sf3 samples are relative to the sample. */
function decode(id) {
	if (decodedCache.has(id)) return decodedCache.get(id)
	const s = shdr[id]
	let data
	if (s.type & 0x10) {
		const ogg = buf.subarray(smpl.offset + s.start, smpl.offset + s.end)
		const raw = execFileSync('ffmpeg', ['-v', 'error', '-f', 'ogg', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', 'pipe:1'], { input: ogg, maxBuffer: 1 << 28 })
		data = new Float32Array(raw.buffer, raw.byteOffset, raw.length >> 2).slice()
	} else {
		data = new Float32Array(s.end - s.start)
		for (let i = 0; i < data.length; i++) data[i] = buf.readInt16LE(smpl.offset + (s.start + i) * 2) / 32768
	}
	decodedCache.set(id, data)
	return data
}
const loopOf = s => compressed ? [s.loopStart, s.loopEnd] : [s.loopStart - s.start, s.loopEnd - s.start]

/** Windowed-sinc resampling by an arbitrary ratio (output rate / input rate). */
function resample(data, ratio) {
	if (ratio === 1) return data
	const length = Math.max(1, Math.round(data.length * ratio))
	const out = new Float32Array(length)
	const cutoff = Math.min(1, ratio) * 0.94, half = 16
	for (let i = 0; i < length; i++) {
		const center = i / ratio
		const first = Math.ceil(center - half / Math.min(1, ratio)), last = Math.floor(center + half / Math.min(1, ratio))
		let sum = 0, weight = 0
		for (let j = first; j <= last; j++) {
			const x = (j - center) * cutoff
			const window = 0.5 + 0.5 * Math.cos(Math.PI * (j - center) / (half / Math.min(1, ratio) + 1))
			const w = (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * window
			weight += w
			if (j >= 0 && j < data.length) sum += data[j] * w
		}
		out[i] = weight > 0 ? sum / weight : 0
	}
	return out
}

// ---- IMA ADPCM -----------------------------------------------------------------------------------------------

const STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767]
const INDEX_STEP = [-1, -1, -1, -1, 2, 4, 6, 8]

/** Encodes 16-bit samples into whole ADPCM blocks; the decoder in the browser mirrors this exactly. */
function encodeAdpcm(pcm) {
	const blocks = Math.ceil(pcm.length / SAMPLES_PER_BLOCK)
	const out = Buffer.alloc(blocks * BLOCK)
	let index = 0
	for (let b = 0; b < blocks; b++) {
		const base = b * SAMPLES_PER_BLOCK, o = b * BLOCK
		let predictor = pcm[base] ?? 0
		out.writeInt16LE(predictor, o); out[o + 2] = index; out[o + 3] = 0
		for (let i = 1; i < SAMPLES_PER_BLOCK; i++) {
			const target = pcm[base + i] ?? 0
			const step = STEPS[index]
			let diff = target - predictor, nibble = 0
			if (diff < 0) { nibble = 8; diff = -diff }
			let delta = step >> 3
			if (diff >= step) { nibble |= 4; diff -= step; delta += step }
			if (diff >= step >> 1) { nibble |= 2; diff -= step >> 1; delta += step >> 1 }
			if (diff >= step >> 2) { nibble |= 1; delta += step >> 2 }
			predictor = Math.max(-32768, Math.min(32767, nibble & 8 ? predictor - delta : predictor + delta))
			index = Math.max(0, Math.min(88, index + INDEX_STEP[nibble & 7]))
			const position = o + 4 + ((i - 1) >> 1)
			if ((i - 1) & 1) out[position] |= nibble << 4; else out[position] = nibble
		}
	}
	return out
}

// ---- instruments ---------------------------------------------------------------------------------------------

const timecents = (tc, fallback = -12000) => Math.pow(2, (tc ?? fallback) / 1200)
const ADDITIVE = new Set([0, 1, 2, 3, 4, 8, 9, 12, 17, 33, 34, 35, 36, 37, 38, 39, 40, 45, 48, 50, 51, 52, 56])
// Generator defaults of the SoundFont specification that differ from 0; preset values are added to them.
const DEFAULTS = { 8: 13500, 21: -12000, 23: -12000, 25: -12000, 26: -12000, 27: -12000, 28: -12000, 30: -12000,
	33: -12000, 34: -12000, 35: -12000, 36: -12000, 38: -12000, 56: 100 }
const ATTENUATION_FACTOR = 0.4 // FluidSynth and MuseScore scale the attenuation like EMU hardware

function buildInstrument(preset, drums) {
	const target = drums ? DRUM_RATE : MELODIC_RATE
	const samples = [], sampleIndex = new Map(), zones = [], parts = []
	let frames = 0
	const inLayer = z => { const vel = z[VEL_RANGE] || [0, 127]; return vel[0] <= LAYER_VELOCITY && LAYER_VELOCITY <= vel[1] }
	// Preset zones of other velocity layers stay only when they reuse an instrument of the kept layer.
	const keptInstruments = new Set(preset.zones.filter(inLayer).map(z => z[INSTRUMENT]))
	const presetZones = preset.zones.filter(z => inLayer(z) || keptInstruments.has(z[INSTRUMENT]) || keptInstruments.size === 0)
	for (const pz of presetZones) {
		const instrument = instruments[pz[INSTRUMENT]]
		if (!instrument) continue
		// One velocity layer per key range keeps the files small.
		const layered = instrument.zones.filter(z => z[SAMPLE_ID] !== undefined)
		const sameRange = (a, b) => String(a[KEY_RANGE] || [0, 127]) === String(b[KEY_RANGE] || [0, 127])
		const chosen = layered.filter(z => inLayer(z) || !layered.some(o => o !== z && sameRange(o, z) && inLayer(o)))
			// Stereo pairs share key and velocity range; one side is enough for mono playback.
			.filter((z, i, all) => all.findIndex(o => sameRange(o, z) && String(o[VEL_RANGE] || [0, 127]) === String(z[VEL_RANGE] || [0, 127])) === i)
		for (const iz of chosen) {
			const g = { ...instrument.global, ...iz }
			for (const [op, value] of Object.entries({ ...preset.global, ...pz })) {
				if (ADDITIVE.has(Number(op))) g[op] = (g[op] ?? DEFAULTS[op] ?? 0) + value
			}
			const pk = pz[KEY_RANGE] || preset.global[KEY_RANGE] || [0, 127], ik = g[KEY_RANGE] || [0, 127]
			const pv = pz[VEL_RANGE] || preset.global[VEL_RANGE] || [0, 127]
			const keys = [Math.max(pk[0], ik[0]), Math.min(pk[1], ik[1])]
			if (keys[0] > keys[1]) continue
			const id = g[SAMPLE_ID], s = shdr[id]
			const loopMode = g[54] ?? 0
			let [loopStart, loopEnd] = loopOf(s)
			loopStart += (g[2] ?? 0) + (g[45] ?? 0) * 32768
			loopEnd += (g[3] ?? 0) + (g[50] ?? 0) * 32768
			const startOffset = (g[0] ?? 0) + (g[4] ?? 0) * 32768
			if (!sampleIndex.has(id)) {
				const data = decode(id)
				const loopLength = loopEnd - loopStart
				let ratio = Math.min(1, target / s.rate)
				// A whole number of output frames per loop keeps the loop in tune.
				if (loopMode && loopLength > 0) {
					const frames = Math.ceil(loopLength * ratio)
					ratio = frames < 24 ? 1 : frames / loopLength
				}
				let pcmFloat = resample(data, ratio)
				const maxFrames = Math.round(MAX_SECONDS * s.rate * ratio)
				if (!loopMode && pcmFloat.length > maxFrames) {
					pcmFloat = pcmFloat.slice(0, maxFrames)
					const fade = Math.round(FADE_SECONDS * s.rate * ratio)
					for (let i = 0; i < fade; i++) pcmFloat[maxFrames - 1 - i] *= i / fade
				}
				const pcm = Int16Array.from(pcmFloat, v => Math.max(-32768, Math.min(32767, Math.round(v * 32767))))
				sampleIndex.set(id, samples.length)
				samples.push({ start: frames, length: pcm.length, rate: Math.round(s.rate * ratio), ratio })
				parts.push(encodeAdpcm(pcm))
				frames += Math.ceil(pcm.length / SAMPLES_PER_BLOCK) * SAMPLES_PER_BLOCK
			}
			const sample = samples[sampleIndex.get(id)]
			const scale = v => Math.round(v * sample.ratio)
			const root = g[58] !== undefined && g[58] >= 0 ? g[58] : s.key > 127 ? 60 : s.key
			const fc = g[8] ?? 13500
			zones.push({
				keys, vels: [pv[0], pv[1]], sample: sampleIndex.get(id),
				root, tune: (g[51] ?? 0) * 100 + (g[52] ?? 0) + s.correction, scale: g[56] ?? 100,
				loop: loopMode === 1 || loopMode === 3 ? 1 : 0,
				start: scale(Math.max(0, startOffset)), loopStart: scale(loopStart), loopEnd: scale(loopEnd),
				gain: round(Math.pow(10, -(g[48] ?? 0) * ATTENUATION_FACTOR / 200)),
				attack: round(timecents(g[34])), hold: round(timecents(g[35])), decay: round(timecents(g[36])),
				sustain: round(Math.pow(10, -Math.max(0, Math.min(1440, g[37] ?? 0)) / 200)), release: round(timecents(g[38])),
				keyHold: g[39] ?? 0, keyDecay: g[40] ?? 0,
				filter: fc >= 13500 ? 0 : Math.round(8.176 * Math.pow(2, fc / 1200)), q: round((g[9] ?? 0) / 10),
			})
		}
	}
	for (const sample of samples) delete sample.ratio
	return { name: preset.name, samples, zones, data: Buffer.concat(parts) }
}

const round = v => Math.round(v * 10000) / 10000

function wave(instrument) {
	const json = Buffer.from(JSON.stringify({ version: 1, name: instrument.name, block: BLOCK, samples: instrument.samples, zones: instrument.zones }))
	const chunk = (id, body) => {
		const head = Buffer.alloc(8); head.write(id, 0, 'latin1'); head.writeUInt32LE(body.length, 4)
		return Buffer.concat([head, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])
	}
	const fmt = Buffer.alloc(20)
	fmt.writeUInt16LE(0x11, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(MELODIC_RATE, 4)
	fmt.writeUInt32LE(Math.round(MELODIC_RATE * BLOCK / SAMPLES_PER_BLOCK), 8); fmt.writeUInt16LE(BLOCK, 12); fmt.writeUInt16LE(4, 14)
	fmt.writeUInt16LE(2, 16); fmt.writeUInt16LE(SAMPLES_PER_BLOCK, 18)
	const fact = Buffer.alloc(4); fact.writeUInt32LE(instrument.data.length / BLOCK * SAMPLES_PER_BLOCK, 0)
	const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('fact', fact), chunk('nlsf', json), chunk('data', instrument.data)])
	return Buffer.concat([Buffer.from('RIFF'), Buffer.from(Uint32Array.of(body.length).buffer), body])
}

mkdirSync(output, { recursive: true })
let total = 0
const jobs = presets.filter(p => p.bank === 0 && p.preset < 128).map(p => [p, String(p.preset), false])
const kit = presets.find(p => p.bank === 128 && p.preset === 0)
if (kit) jobs.push([kit, 'drums', true])
for (const [preset, name, drums] of jobs) {
	const file = wave(buildInstrument(preset, drums))
	writeFileSync(join(output, name + '.wav'), file)
	total += file.length
	console.log(`${name.padStart(5)}  ${preset.name.padEnd(20)} ${(file.length / 1024).toFixed(0).padStart(6)} KB`)
}
console.log(`Zusammen ${(total / 1048576).toFixed(1)} MB in ${output}`)
