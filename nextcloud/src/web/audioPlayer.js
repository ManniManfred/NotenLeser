import { Performance } from '../core/performance.js'

/**
 * Plays a score with a small Web Audio synthesizer. Instruments are approximated per General MIDI family;
 * notes are scheduled a little ahead of time so playback stays smooth even on busy pages.
 */
const LOOKAHEAD_MS = 1500, TICK_MS = 100

function family(program) {
	if (program < 8) return 'piano'
	if (program < 16) return 'mallet'
	if (program < 24) return 'organ'
	if (program < 32) return 'guitar'
	if (program < 40) return 'bass'
	if (program < 56) return 'strings'
	if (program < 64) return 'brass'
	if (program < 72) return 'reed'
	if (program < 80) return 'pipe'
	return 'synth'
}

const VOICES = {
	piano: { wave: 'triangle', attack: 0.005, decay: 1.2, sustain: 0.15, release: 0.25, filter: 4000 },
	mallet: { wave: 'sine', attack: 0.002, decay: 0.6, sustain: 0.0, release: 0.3, filter: 6000 },
	organ: { wave: 'square', attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.08, filter: 2200 },
	guitar: { wave: 'triangle', attack: 0.004, decay: 0.8, sustain: 0.1, release: 0.2, filter: 3000 },
	bass: { wave: 'triangle', attack: 0.01, decay: 0.4, sustain: 0.5, release: 0.12, filter: 1200 },
	strings: { wave: 'sawtooth', attack: 0.08, decay: 0.2, sustain: 0.8, release: 0.25, filter: 2500 },
	brass: { wave: 'sawtooth', attack: 0.04, decay: 0.15, sustain: 0.75, release: 0.12, filter: 1800 },
	reed: { wave: 'square', attack: 0.03, decay: 0.1, sustain: 0.8, release: 0.1, filter: 2000 },
	pipe: { wave: 'sine', attack: 0.05, decay: 0.1, sustain: 0.9, release: 0.12, filter: 5000 },
	synth: { wave: 'triangle', attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.15, filter: 3000 },
}

export class AudioPlayer {
	constructor(score) {
		this.score = score
		this.context = null
		this.performance = null
		this.timer = null
		this.nodes = new Set()
		this.onEnd = null
	}

	get playing() { return this.timer !== null }

	/**
	 * Starts at a score tick with a tempo factor; onEnd runs when the score has finished. With a range
	 * {first, last} of measure indices only these measures are played, over and over until stopped.
	 */
	async start(startTick, speed, onEnd, range = null, mix = null) {
		this.stop()
		const sameRange = (a, b) => (!a && !b) || (a && b && a.first === b.first && a.last === b.last)
		const sameMix = (a, b) => (!a && !b) || (a && b && a.others === b.others && a.parts.size === b.parts.size && [...a.parts].every(p => b.parts.has(p)))
		if (!this.performance || this.performance.speed !== speed || !sameRange(this.performance.range, range) || !sameMix(this.performance.mix, mix)) {
			this.performance = new Performance(this.score, speed, range, mix)
		}
		if (this.performance.notes.length === 0) {
			throw new Error(mix ? 'Die gewählten Stimmen haben hier nichts zu spielen' : range ? 'Der Bereich enthält nichts zum Abspielen' : 'Die Partitur enthält nichts zum Abspielen')
		}
		this.loop = !!range
		if (!this.context) {
			const AudioContextClass = window.AudioContext || window.webkitAudioContext
			if (!AudioContextClass) throw new Error('Der Browser unterstützt keine Audiowiedergabe')
			this.context = new AudioContextClass()
			this.master = this.context.createDynamicsCompressor()
			const volume = this.context.createGain()
			volume.gain.value = 0.8
			this.master.connect(volume).connect(this.context.destination)
			this.noise = this.makeNoise()
		}
		await this.context.resume()
		this.onEnd = onEnd
		this.offsetMs = this.loop ? 0 : this.performance.msAtTick(Math.max(0, startTick))
		this.startTime = this.context.currentTime + 0.1
		// A loop pass starts at cycleTime; the next pass is scheduled once all notes of this one are.
		this.cycleTime = this.startTime
		this.nextNote = this.performance.notes.findIndex(note => note.start >= this.offsetMs - 1)
		if (this.nextNote < 0) this.nextNote = this.performance.notes.length
		this.timer = setInterval(() => this.schedule(), TICK_MS)
		this.schedule()
	}

	stop() {
		if (this.timer !== null) clearInterval(this.timer)
		this.timer = null
		const now = this.context ? this.context.currentTime : 0
		for (const node of this.nodes) {
			try {
				node.gain.gain.cancelScheduledValues(now)
				node.gain.gain.setTargetAtTime(0, now, 0.02)
				node.source.stop(now + 0.1)
			} catch (e) { /* already stopped */ }
		}
		this.nodes.clear()
	}

	/** Playback position in ms of the unfolded score; a looped range starts again at 0 on every pass. */
	positionMs() {
		const elapsed = (this.context.currentTime - this.startTime) * 1000
		if (!this.loop || elapsed < 0) return this.offsetMs + elapsed
		return elapsed % Math.max(1, this.performance.durationMs)
	}

	/** Score tick currently sounding, or -1 when not playing. */
	currentTick() {
		if (!this.playing) return -1
		const ms = this.positionMs()
		return ms < this.offsetMs ? this.performance.tickAtMs(this.offsetMs) : this.performance.tickAtMs(ms)
	}

	schedule() {
		const notes = this.performance.notes
		if (!this.loop && this.positionMs() > this.performance.durationMs + 300) {
			const onEnd = this.onEnd
			this.stop()
			if (onEnd) onEnd()
			return
		}
		const horizon = this.context.currentTime + LOOKAHEAD_MS / 1000
		for (;;) {
			if (this.nextNote >= notes.length) {
				if (!this.loop) break
				this.cycleTime += this.performance.durationMs / 1000
				this.nextNote = 0
			}
			const note = notes[this.nextNote]
			if (this.timeOf(note.start) >= horizon) break
			this.play(note)
			this.nextNote++
		}
	}

	timeOf(ms) { return this.cycleTime + (ms - this.offsetMs) / 1000 }

	play(note) {
		const ctx = this.context
		const start = Math.max(ctx.currentTime, this.timeOf(note.start))
		const end = Math.max(start + 0.02, this.timeOf(this.loop ? Math.min(note.end, this.performance.durationMs) : note.end))
		const level = (note.velocity / 127) ** 1.5 * 0.22
		const gain = ctx.createGain()
		gain.gain.value = 0
		let source
		if (note.percussion) {
			source = ctx.createBufferSource()
			source.buffer = this.noise
			const filter = ctx.createBiquadFilter()
			filter.type = 'bandpass'
			filter.frequency.value = 200 + (note.pitch - 35) * 120
			filter.Q.value = 1.2
			source.connect(filter).connect(gain)
			gain.gain.setValueAtTime(level * 1.5, start)
			gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18)
			source.start(start)
			source.stop(start + 0.25)
		} else {
			const voice = VOICES[family(note.program)]
			source = ctx.createOscillator()
			source.type = voice.wave
			source.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12)
			const filter = ctx.createBiquadFilter()
			filter.type = 'lowpass'
			filter.frequency.value = Math.min(voice.filter, 400 + source.frequency.value * 6)
			source.connect(filter).connect(gain)
			const g = gain.gain
			g.setValueAtTime(0, start)
			g.linearRampToValueAtTime(level, start + voice.attack)
			g.setTargetAtTime(level * voice.sustain, start + voice.attack, voice.decay / 3)
			g.setTargetAtTime(0, end, voice.release / 3)
			source.start(start)
			source.stop(end + voice.release * 2)
		}
		gain.connect(this.master)
		const entry = { source, gain }
		this.nodes.add(entry)
		source.onended = () => { this.nodes.delete(entry); gain.disconnect() }
	}

	makeNoise() {
		const length = this.context.sampleRate * 0.3
		const buffer = this.context.createBuffer(1, length, this.context.sampleRate)
		const data = buffer.getChannelData(0)
		for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
		return buffer
	}

	close() {
		this.stop()
		if (this.context) this.context.close()
		this.context = null
	}
}
