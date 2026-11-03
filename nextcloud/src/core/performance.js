import { Annotation, SpannerKind } from './musicModel.js'

/**
 * Turns a score into timed note events for playback. Repeats and voltas are unfolded; times are milliseconds
 * from the start of the score at the given tempo factor (1 = as written).
 */
const DEFAULT_TEMPO = 120

export class Performance {
	constructor(score, speed = 1) {
		this.score = score
		this.speed = Math.max(0.25, Math.min(2, speed))
		const entries = [...score.tempos.entries()].sort((a, b) => a[0] - b[0])
		if (entries.length === 0 || entries[0][0] > 0) entries.unshift([0, entries.length === 0 ? DEFAULT_TEMPO : entries[0][1]])
		this.tempoTicks = entries.map(e => e[0])
		this.tempoValues = entries.map(e => e[1])
		this.timeline = this.unfold()
		this.notes = this.buildNotes()
	}

	get durationMs() { return this.timeline.length === 0 ? 0 : this.timeline[this.timeline.length - 1].endMs }

	// ---- timing -------------------------------------------------------------------------------------------

	tempoIndexAt(tick) {
		let low = 0, high = this.tempoTicks.length - 1
		while (low < high) {
			const mid = (low + high + 1) >> 1
			if (this.tempoTicks[mid] <= tick) low = mid; else high = mid - 1
		}
		return low
	}

	msPerTick(bpm) { return 60000 / (bpm * this.score.division * this.speed) }

	/** Milliseconds between two ticks of the score following the tempo map. */
	duration(fromTick, toTick) {
		let ms = 0, t = fromTick
		while (t < toTick) {
			const index = this.tempoIndexAt(t)
			const next = index + 1 < this.tempoTicks.length ? this.tempoTicks[index + 1] : Infinity
			const end = Math.min(toTick, next)
			ms += (end - t) * this.msPerTick(this.tempoValues[index])
			t = end
		}
		return ms
	}

	msAtPlayed(played, tick) { return played.startMs + this.duration(played.measure.tick, tick) }

	/** Time of the first occurrence of a tick, or 0 when the tick lies outside the score. */
	msAtTick(tick) {
		for (const played of this.timeline) {
			const m = played.measure
			if (tick >= m.tick && tick < m.tick + m.ticks) return this.msAtPlayed(played, tick)
		}
		return 0
	}

	/** Score tick sounding at a time, or -1 after the end. */
	tickAtMs(ms) {
		const timeline = this.timeline
		if (timeline.length === 0 || ms >= this.durationMs) return -1
		let low = 0, high = timeline.length - 1
		while (low < high) {
			const mid = (low + high + 1) >> 1
			if (timeline[mid].startMs <= ms) low = mid; else high = mid - 1
		}
		const played = timeline[low]
		const m = played.measure
		let rest = Math.max(0, ms - played.startMs)
		let t = m.tick
		const end = m.tick + m.ticks
		while (t < end) {
			const index = this.tempoIndexAt(t)
			const next = index + 1 < this.tempoTicks.length ? this.tempoTicks[index + 1] : Infinity
			const segmentEnd = Math.min(end, next)
			const perTick = this.msPerTick(this.tempoValues[index])
			const segmentMs = (segmentEnd - t) * perTick
			if (rest < segmentMs) return t + Math.floor(rest / perTick + 1e-6)
			rest -= segmentMs
			t = segmentEnd
		}
		return Math.max(m.tick, end - 1)
	}

	// ---- repeats ------------------------------------------------------------------------------------------

	/** Volta endings covering each measure. */
	voltaEndings() {
		const result = new Map()
		for (const spanner of this.score.spanners) {
			if (spanner.kind !== SpannerKind.VOLTA) continue
			const label = spanner.text || ''
			const numbers = (label.match(/\d+/g) || []).map(Number)
			const endings = new Set()
			if (numbers.length === 2 && /\d\s*[-–]\s*\d/.test(label)) for (let n = numbers[0]; n <= numbers[1]; n++) endings.add(n)
			else numbers.forEach(n => endings.add(n))
			if (endings.size === 0) endings.add(1)
			for (const m of this.score.measures) if (m.tick >= spanner.startTick && m.tick < spanner.endTick) result.set(m, endings)
		}
		return result
	}

	unfold() {
		const result = []
		const measures = this.score.measures
		const voltas = this.voltaEndings()
		const n = measures.length
		const counts = new Array(n).fill(0)
		let i = 0, repeatStart = 0, pass = 1, guard = 0, jumped = false, ms = 0
		while (i < n && guard++ < n * 20) {
			const m = measures[i]
			if (m.startRepeat && !jumped) { repeatStart = i; pass = 1 }
			jumped = false
			const endings = voltas.get(m)
			if (endings && !endings.has(pass)) { i++; continue }
			const length = this.duration(m.tick, m.tick + m.ticks)
			result.push({ measure: m, startMs: ms, endMs: ms + length })
			ms += length
			if (m.endRepeat > 0) {
				counts[i]++
				if (counts[i] < m.endRepeat) { pass++; i = repeatStart; jumped = true; continue }
				counts[i] = 0
				repeatStart = i + 1
			}
			i++
		}
		return result
	}

	// ---- notes --------------------------------------------------------------------------------------------

	buildNotes() {
		const score = this.score
		const staffCount = score.staves.length
		const dynamics = []
		for (let s = 0; s < staffCount; s++) {
			const map = []
			for (const m of score.measures) {
				if (s >= m.staves.length) continue
				for (const annotation of m.staves[s].annotations) {
					if (annotation.kind !== Annotation.DYNAMIC) continue
					const v = velocity(annotation.text)
					if (v > 0) map.push([annotation.tick, v])
				}
			}
			map.sort((a, b) => a[0] - b[0])
			dynamics.push(map)
		}
		const notes = []
		const openTies = Array.from({ length: staffCount }, () => new Map())
		for (const played of this.timeline) {
			const m = played.measure
			for (let s = 0; s < staffCount && s < m.staves.length; s++) {
				const staff = score.staves[s]
				const ordered = [...m.staves[s].chordRests].sort((a, b) => a.tick - b.tick)
				const ties = openTies[s]
				for (const cr of ordered) {
					if (cr.rest || cr.grace || cr.notes.length === 0) continue
					const start = this.msAtPlayed(played, cr.tick), end = this.msAtPlayed(played, cr.tick + cr.duration)
					let vel = 84
					for (const [tick, v] of dynamics[s]) { if (tick <= cr.tick) vel = v; else break }
					let staccato = false
					for (const articulation of cr.articulations) {
						if (articulation.includes('Accent') || articulation.includes('Marcato')) vel = Math.min(127, vel + 16)
						if (articulation.includes('Staccato')) staccato = true
					}
					const length = end - start
					const soundEnd = staccato ? start + length * 0.5 : end - Math.min(25, length * 0.08)
					for (const note of cr.notes) {
						const pitch = Math.max(0, Math.min(127, note.soundPitch))
						const tied = note.tieEnd ? ties.get(pitch) : undefined
						if (tied) {
							tied.end = soundEnd
							if (!note.tieStart) ties.delete(pitch)
							continue
						}
						const event = {
							staff: s, part: staff.part, program: staff.program, percussion: staff.clef === 'PERC',
							pitch, velocity: vel, start, end: Math.max(start + 10, soundEnd),
						}
						notes.push(event)
						if (note.tieStart) ties.set(pitch, event); else ties.delete(pitch)
					}
				}
			}
		}
		notes.sort((a, b) => a.start - b.start)
		return notes
	}
}

function velocity(dynamic) {
	const d = (dynamic || '').toLowerCase().replace(/[^a-z]/g, '')
	const values = { pppp: 20, ppp: 30, pp: 42, p: 56, mp: 70, mf: 84, f: 98, ff: 110, fff: 120, ffff: 126 }
	return values[d] ?? -1
}
