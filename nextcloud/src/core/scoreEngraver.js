import * as Glyphs from './glyphs.js'
import { Annotation, SpannerKind } from './musicModel.js'

/**
 * Lays out a score into pages and systems and draws it through a painter.
 * The engraving follows MuseScore's default style closely enough for reading from a screen;
 * all lengths are staff spaces.
 *
 * A painter implements line, polygon, curveBand, glyph, text, textWidth and frame (see museScoreDocument.js).
 */
const G = Glyphs.G
export const BOLD = 1, ITALIC = 2
export const LEFT = 0, CENTER = 1, RIGHT = 2

const PT = 0.3528 / 1.75
const STAFF_LINE = 0.11, STEM = 0.12, LEDGER = 0.16, BEAM = 0.5, BEAM_DISTANCE = 0.75
const THIN = 0.18, THICK = 0.55, BAR_GAP = 0.37
const TEXT = 10 * PT, TEMPO = 12 * PT, LYRICS = 10 * PT, TITLE = 22 * PT, SUBTITLE = 16 * PT,
	COMPOSER = 12 * PT, NUMBER = 8 * PT, TUPLET = 10 * PT, REHEARSAL = 14 * PT, NAME = 10 * PT, CHORD_SYMBOL = 12 * PT
const STAFF_DISTANCE = 6.5, SYSTEM_DISTANCE = 8.5, MAX_SYSTEM_DISTANCE = 15, GRACE = 0.6
const SHARP_POSITIONS = [0, 3, -1, 2, 5, 1, 4], FLAT_POSITIONS = [4, 1, 5, 2, 6, 3, 7]
const SHARP_STEPS = [3, 0, 4, 1, 5, 2, 6], FLAT_STEPS = [6, 2, 5, 1, 4, 0, 3]
const TPC_STEPS = [3, 0, 4, 1, 5, 2, 6]

const floorMod = (a, b) => ((a % b) + b) % b
const trailingZeros = v => 31 - Math.clz32(v & -v)

class MeasurePlacement {
	constructor() { this.index = 0; this.measure = null; this.x = 0; this.width = 0; this.changesX = 0; this.segX = []; this.ticks = []; this.systemStart = false }
	end() { return this.x + this.width }
	xAt(tick) {
		const ticks = this.ticks, segX = this.segX
		if (ticks.length === 0 || tick <= ticks[0]) return segX.length === 0 ? this.x + 1 : segX[0]
		for (let i = 0; i < ticks.length; i++) {
			if (ticks[i] === tick) return segX[i]
			const nextTick = i + 1 < ticks.length ? ticks[i + 1] : this.measure.tick + this.measure.ticks
			const nextX = i + 1 < ticks.length ? segX[i + 1] : this.end() - 0.6
			if (tick < nextTick) return segX[i] + (nextX - segX[i]) * (tick - ticks[i]) / Math.max(1, nextTick - ticks[i])
		}
		return this.end() - 0.6
	}
}

class SystemLayout {
	constructor() {
		this.first = 0; this.last = 0; this.x0 = 0; this.x1 = 0; this.headerEnd = 0; this.staffY = []
		this.firstSystem = false; this.top = 0; this.bottom = 0; this.measures = []
		this.chords = []; this.beams = []
		this.chordsTop = []; this.chordsBottom = []; this.lyricBase = []; this.dynamicBase = []; this.textBase = []; this.voltaY = []
	}

	placement(tick) {
		for (const p of this.measures) if (tick < p.measure.tick + p.measure.ticks) return tick >= p.measure.tick ? p : null
		return null
	}

	startTick() { return this.measures[0].measure.tick }
	endTick() { const m = this.measures[this.measures.length - 1].measure; return m.tick + m.ticks }

	/** X position of a tick inside the system; ticks at a barline map to the barline. */
	xAt(tick, atBarline) {
		for (let i = 0; i < this.measures.length; i++) {
			const p = this.measures[i]
			if (atBarline && tick === p.measure.tick && i > 0) return p.x
			if (tick < p.measure.tick + p.measure.ticks) return p.xAt(tick)
		}
		return this.x1
	}
}

class ChordLayout {
	constructor() {
		this.cr = null; this.staff = 0; this.system = null; this.measure = null
		this.x = 0; this.noteWidth = 1.3; this.scale = 1; this.up = false; this.hasStem = false; this.multiVoice = false
		this.flags = 0; this.beam = null
		this.stemX = 0; this.stemStartY = 0; this.stemEndY = 0; this.dotX = 0; this.top = 0; this.bottom = 0
		this.head = ''; this.restGlyph = ''; this.restY = 0
		this.notes = []; this.noteX = []; this.accX = []; this.marks = []
	}

	centerX() { return this.x + this.noteWidth / 2 }
	topNoteY() { return this.notes[0].position * 0.5 }
	bottomNoteY() { return this.notes[this.notes.length - 1].position * 0.5 }
}

class Beam {
	constructor() { this.chords = []; this.up = false; this.x1 = 0; this.y1 = 0; this.x2 = 0; this.y2 = 0 }
	yAt(x) { return this.x2 === this.x1 ? this.y1 : this.y1 + (this.y2 - this.y1) * (x - this.x1) / (this.x2 - this.x1) }
}

export class ScoreEngraver {
	constructor(score, measurer) {
		this.score = score
		this.measurer = measurer
		const sp = Math.max(0.5, score.spatiumMm)
		this.pageWidth = score.pageWidthMm / sp; this.pageHeight = score.pageHeightMm / sp
		this.marginLeft = score.marginLeftMm / sp; this.marginRight = score.marginRightMm / sp
		this.marginTop = score.marginTopMm / sp; this.marginBottom = score.marginBottomMm / sp
		this.staffCount = score.staves.length
		let parts = 0
		for (const staff of score.staves) parts = Math.max(parts, staff.part + 1)
		this.showNames = parts > 1
		const measures = score.measures.length
		const grid = value => Array.from({ length: measures }, () => new Array(this.staffCount).fill(value))
		this.clefAtStart = grid('G'); this.keyAtStart = grid(0); this.keyBefore = grid(0)
		this.keyChanged = grid(false); this.clefChanged = grid(false)
		this.systems = []; this.pages = []
		this.chordLayouts = new Map(); this.noteOwners = new Map(); this.tieSources = new Map()
		this.tupletIds = new Map()
		if (measures === 0 || this.staffCount === 0) { this.pages.push(newPage()); return }
		this.prepareStates()
		this.prepareNotes()
		this.computeSpacing()
		this.breakSystems()
		for (const system of this.systems) this.layoutSystem(system)
		this.paginate()
	}

	pageCount() { return this.pages.length }

	// ---- preparation --------------------------------------------------------------------------------------

	prepareStates() {
		const score = this.score
		for (let s = 0; s < this.staffCount; s++) {
			let clef = score.staves[s].clef
			let key = 0
			for (let m = 0; m < score.measures.length; m++) {
				const measure = score.measures[m]
				const staffMeasure = measure.staves[s]
				for (const change of staffMeasure.clefs) {
					if (change.tick !== measure.tick) continue
					if (m > 0 && change.clef !== clef) this.clefChanged[m][s] = true
					clef = change.clef
				}
				this.clefAtStart[m][s] = clef
				this.keyBefore[m][s] = key
				if (staffMeasure.key !== null) {
					this.keyChanged[m][s] = m > 0 && staffMeasure.key !== key
					key = staffMeasure.key
				}
				this.keyAtStart[m][s] = key
				for (const change of staffMeasure.clefs) if (change.tick > measure.tick) clef = change.clef
			}
		}
	}

	clefAt(measureIndex, staff, tick) {
		let clef = this.clefAtStart[measureIndex][staff]
		for (const change of this.score.measures[measureIndex].staves[staff].clefs) if (change.tick <= tick) clef = change.clef
		return clef
	}

	prepareNotes() {
		const score = this.score
		for (let s = 0; s < this.staffCount; s++) {
			for (let m = 0; m < score.measures.length; m++) {
				const staffMeasure = score.measures[m].staves[s]
				const keyAlter = new Array(7).fill(0)
				const key = this.keyAtStart[m][s]
				for (let i = 0; i < Math.min(7, Math.abs(key)); i++) keyAlter[key > 0 ? SHARP_STEPS[i] : FLAT_STEPS[i]] = key > 0 ? 1 : -1
				const state = new Map()
				const ordered = [...staffMeasure.chordRests].sort((a, b) => a.tick - b.tick)
				for (const chordRest of ordered) {
					for (const item of [...chordRest.graces, chordRest]) {
						const topLine = clefTopLine(this.clefAt(m, s, item.tick))
						for (const note of item.notes) {
							const step = TPC_STEPS[floorMod(note.tpc - 13, 7)]
							const alter = Math.floor((note.tpc - 13) / 7)
							const octave = Math.floor((note.pitch - alter) / 12) - 1
							const diatonic = octave * 7 + step
							note.position = topLine - diatonic
							const current = state.get(diatonic)
							const expected = current !== undefined ? current : keyAlter[step]
							const show = alter !== expected && !note.tieEnd
							if (!note.tieEnd) state.set(diatonic, alter)
							note.shownAccidental = show ? accidentalGlyph(alter) : note.accidental ? Glyphs.byName(note.accidental) : ''
							if (note.tieTo) this.tieSources.set(note.tieTo, note)
						}
						item.notes.sort((a, b) => a.position - b.position)
					}
				}
			}
		}
	}

	// ---- horizontal spacing -------------------------------------------------------------------------------

	durationSpace(ticks) {
		const quarters = Math.max(0.0625, ticks / this.score.division)
		return Math.min(9, Math.max(1.9, 3.3 * Math.sqrt(quarters)))
	}

	computeSpacing() {
		const score = this.score
		this.spacing = []
		for (let m = 0; m < score.measures.length; m++) {
			const measure = score.measures[m]
			const tickSet = new Set()
			for (const staffMeasure of measure.staves) {
				for (const chordRest of staffMeasure.chordRests) tickSet.add(chordRest.tick)
				for (const change of staffMeasure.clefs) if (change.tick > measure.tick) tickSet.add(change.tick)
			}
			if (tickSet.size === 0) tickSet.add(measure.tick)
			const ticks = [...tickSet].sort((a, b) => a - b)
			const n = ticks.length
			const ms = { ticks, base: new Array(n).fill(0), extra: new Array(n).fill(0), lead: 0, changes: 0, trail: 0 }
			const lyricWidth = new Array(n).fill(0)
			for (let i = 0; i < n; i++) {
				const tick = ticks[i]
				const next = i + 1 < n ? ticks[i + 1] : measure.tick + measure.ticks
				let onlyMeasureRests = true, any = false, extra = 0, dots = 0
				for (let s = 0; s < this.staffCount; s++) {
					const staffMeasure = measure.staves[s]
					for (const chordRest of staffMeasure.chordRests) {
						if (chordRest.tick !== tick) continue
						any = true
						if (!chordRest.measureRest) onlyMeasureRests = false
						let accidentals = 0, seconds = false
						chordRest.notes.forEach((note, k) => {
							if (note.shownAccidental) accidentals++
							if (k > 0 && note.position - chordRest.notes[k - 1].position === 1) seconds = true
						})
						let e = accidentals === 0 ? 0 : 1.25 + 1.0 * Math.min(2, accidentals - 1)
						if (seconds) e += 1.0
						e += chordRest.graces.length * 1.25 + (chordRest.graces.length === 0 ? 0 : 0.3)
						extra = Math.max(extra, e)
						dots = Math.max(dots, chordRest.dots * 0.55)
						for (const lyric of chordRest.lyrics) lyricWidth[i] = Math.max(lyricWidth[i], this.measurer.textWidth(lyric.text, LYRICS, 0))
					}
					for (const change of staffMeasure.clefs) if (change.tick === tick && tick > measure.tick) extra = Math.max(extra, 2.6)
				}
				ms.base[i] = onlyMeasureRests && any ? 5.5 : this.durationSpace(next - tick) + dots
				ms.extra[i] = extra
			}
			for (let i = 0; i + 1 < n; i++) {
				if (lyricWidth[i] === 0 && lyricWidth[i + 1] === 0) continue
				const need = (lyricWidth[i] + lyricWidth[i + 1]) / 2 + 0.9 - ms.extra[i + 1]
				ms.base[i] = Math.max(ms.base[i], need)
			}
			if (n > 0 && lyricWidth[n - 1] > 0) ms.base[n - 1] = Math.max(ms.base[n - 1], lyricWidth[n - 1] / 2 + 0.8)
			ms.lead = 1.2 + (measure.startRepeat ? 1.7 : 0)
			let changes = 0, clefChange = false, keyWidthMax = 0
			for (let s = 0; s < this.staffCount; s++) {
				if (this.clefChanged[m][s]) clefChange = true
				if (this.keyChanged[m][s]) keyWidthMax = Math.max(keyWidthMax, keyChangeWidth(this.keyBefore[m][s], this.keyAtStart[m][s]))
			}
			if (clefChange) changes += 2.6
			if (keyWidthMax > 0) changes += keyWidthMax + 0.8
			if (measure.timeChange && m > 0) changes += timeWidth(measure) + 0.9
			ms.changes = changes
			ms.trail = measure.endRepeat > 0 ? 1.5 : measure.endBarline === 'end' ? 0.4 : 0
			this.spacing.push(ms)
		}
	}

	// ---- systems ------------------------------------------------------------------------------------------

	headerWidth(measureIndex) {
		let width = 0.75 + 2.6 + 0.8
		let maxKey = 0
		for (let s = 0; s < this.staffCount; s++) maxKey = Math.max(maxKey, Math.ceil(keyWidth(this.keyAtStart[measureIndex][s]) * 100))
		if (maxKey > 0) width += maxKey / 100 + 0.7
		const measure = this.score.measures[measureIndex]
		if (measure.timeChange || measureIndex === 0) width += timeWidth(measure) + 0.8
		return width
	}

	nameWidth(first) {
		if (!this.showNames) return 0
		let width = 0
		for (const staff of this.score.staves) width = Math.max(width, this.measurer.textWidth(first ? staff.name : staff.shortName, NAME, 0))
		return width === 0 ? 0 : width + 1.2
	}

	bracketWidth() {
		for (const staff of this.score.staves) if (staff.bracket !== 0) return 1.3
		return this.staffCount > 1 ? 0.3 : 0
	}

	breakSystems() {
		const score = this.score
		const contentRight = this.pageWidth - this.marginRight
		let m = 0
		while (m < score.measures.length) {
			const system = new SystemLayout()
			system.firstSystem = this.systems.length === 0
			const indent = system.firstSystem ? Math.max(5, this.nameWidth(true)) : this.nameWidth(false)
			system.x0 = this.marginLeft + indent + this.bracketWidth()
			system.x1 = contentRight
			system.headerEnd = system.x0 + this.headerWidth(m)
			const available = system.x1 - system.headerEnd
			system.first = m
			let used = 0, last = m
			for (let j = m; j < score.measures.length; j++) {
				const width = fixedWidth(this.spacing[j], j === m) + stretchWidth(this.spacing[j])
				if (j > m && used + width > available) break
				used += width; last = j
				const measure = score.measures[j]
				if (measure.lineBreak || measure.pageBreak) break
			}
			system.last = last
			this.systems.push(system)
			m = last + 1
		}
	}

	placeMeasures(system) {
		let fixed = 0, stretch = 0
		for (let m = system.first; m <= system.last; m++) {
			fixed += fixedWidth(this.spacing[m], m === system.first); stretch += stretchWidth(this.spacing[m])
		}
		const available = system.x1 - system.headerEnd
		let factor = stretch <= 0 ? 1 : (available - fixed) / stretch
		const lastSystem = system.last === this.score.measures.length - 1
		if (lastSystem && (fixed + stretch) < available * 0.3) factor = Math.min(factor, 1)
		factor = Math.max(0.6, factor)
		let x = system.headerEnd
		for (let m = system.first; m <= system.last; m++) {
			const ms = this.spacing[m]
			const placement = new MeasurePlacement()
			placement.index = m; placement.measure = this.score.measures[m]; placement.systemStart = m === system.first
			placement.x = x
			placement.changesX = x + (placement.measure.startRepeat ? 1.7 : 0) + 0.5
			let cursor = x + ms.lead + (placement.systemStart ? 0 : ms.changes)
			placement.ticks = ms.ticks; placement.segX = new Array(ms.ticks.length)
			for (let i = 0; i < ms.ticks.length; i++) {
				cursor += ms.extra[i]
				placement.segX[i] = cursor
				cursor += ms.base[i] * factor
			}
			cursor += ms.trail
			placement.width = cursor - x
			system.measures.push(placement)
			x = cursor
		}
		system.x1 = Math.max(x, system.headerEnd + 1)
	}

	layoutSystem(system) {
		const staffCount = this.staffCount
		this.placeMeasures(system)
		system.staffY = new Array(staffCount).fill(0)
		for (let s = 0; s < staffCount; s++) {
			const chords = [], beams = []
			for (const placement of system.measures) this.layoutStaffMeasure(system, placement, s, chords, beams)
			system.chords.push(chords); system.beams.push(beams)
			let top = 0, bottom = 4
			for (const chord of chords) {
				if (!chord.cr.visible) continue
				top = Math.min(top, chord.top); bottom = Math.max(bottom, chord.bottom)
			}
			system.chordsTop[s] = top; system.chordsBottom[s] = bottom
			let verses = 0
			for (const chord of chords) for (const lyric of chord.cr.lyrics) verses = Math.max(verses, lyric.verse + 1)
			system.lyricBase[s] = bottom + 2.6
			system.dynamicBase[s] = verses > 0 ? system.lyricBase[s] + verses * 2.5 + 1.0 : Math.max(6.6, bottom + 2.4)
			let volta = false
			if (s === 0) for (const spanner of this.score.spanners) if (spanner.kind === SpannerKind.VOLTA && overlaps(system, spanner)) volta = true
			system.voltaY[s] = Math.min(-1.5, top - 1.2) - 1.0
			system.textBase[s] = volta ? system.voltaY[s] - 0.9 : Math.min(-1.3, top - 0.9)
		}
		const above = [], below = []
		for (let s = 0; s < staffCount; s++) {
			const bounds = new BoundsPainter(this.measurer)
			this.drawStaff(bounds, system, s)
			above[s] = Math.max(0, -bounds.minY); below[s] = Math.max(0, bounds.maxY - 4)
		}
		for (let s = 1; s < staffCount; s++) {
			system.staffY[s] = system.staffY[s - 1] + 4 + Math.max(STAFF_DISTANCE, below[s - 1] + above[s] + 1.0)
		}
		const bounds = new BoundsPainter(this.measurer)
		this.drawSystem(bounds, system)
		system.top = Math.min(-above[0], bounds.minY)
		system.bottom = Math.max(system.staffY[staffCount - 1] + 4 + below[staffCount - 1], bounds.maxY)
	}

	// ---- chords -------------------------------------------------------------------------------------------

	layoutStaffMeasure(system, placement, staff, chords, beams) {
		const measure = placement.measure
		const staffMeasure = measure.staves[staff]
		const voices = [false, false, false, false]
		for (const chordRest of staffMeasure.chordRests) if (chordRest.visible || !chordRest.rest) voices[Math.min(3, chordRest.voice)] = true
		const multiVoice = voices.filter(Boolean).length > 1
		const measureChords = []
		for (const chordRest of staffMeasure.chordRests) {
			const chord = new ChordLayout()
			chord.cr = chordRest; chord.staff = staff; chord.system = system; chord.measure = placement
			chord.multiVoice = multiVoice
			chord.x = placement.xAt(chordRest.tick)
			chord.scale = chordRest.small ? 0.7 : 1
			this.chordLayouts.set(chordRest, chord)
			for (const note of chordRest.notes) this.noteOwners.set(note, chord)
			if (chordRest.rest) this.layoutRest(chord, placement)
			else {
				chord.notes.push(...chordRest.notes)
				chord.head = chordRest.value === 0 ? G.NOTEHEAD_DOUBLE_WHOLE : chordRest.value === 1 ? G.NOTEHEAD_WHOLE
					: chordRest.value === 2 ? G.NOTEHEAD_HALF : G.NOTEHEAD_BLACK
				if (chord.notes.length > 0 && chord.notes[0].head === 'cross') chord.head = G.NOTEHEAD_X
				chord.noteWidth = Glyphs.width(chord.head) * chord.scale
				chord.hasStem = chordRest.value >= 2
				chord.flags = chordRest.value >= 8 ? Math.min(4, trailingZeros(chordRest.value) - 2) : 0
				if (chordRest.stemDirection !== 0) chord.up = chordRest.stemDirection > 0
				else if (multiVoice) chord.up = chordRest.voice % 2 === 0
				else chord.up = (chord.bottomNoteY() - 2) > (2 - chord.topNoteY())
			}
			measureChords.push(chord)
		}
		// Voices meeting at a second are shifted apart, the lower voice to the right.
		for (const lower of measureChords) {
			if (lower.cr.rest || lower.cr.voice % 2 === 0) continue
			for (const upper of measureChords) {
				if (upper === lower || upper.cr.rest || upper.cr.tick !== lower.cr.tick || upper.cr.voice % 2 !== 0) continue
				let clash = false
				for (const a of upper.notes) {
					for (const b of lower.notes) {
						const distance = Math.abs(a.position - b.position)
						if (distance === 1 || (distance === 0 && (upper.head !== lower.head || upper.cr.dots !== lower.cr.dots))) clash = true
					}
				}
				if (clash) lower.x += upper.noteWidth
			}
		}
		for (let voice = 0; voice < 4; voice++) this.buildBeams(measure, measureChords, voice, beams)
		for (const chord of measureChords) if (!chord.cr.rest) this.placeNotes(chord)
		for (const beam of beams) if (beam.chords.length > 0 && beam.chords[0].measure === placement) this.placeBeam(beam)
		for (const chord of measureChords) if (!chord.cr.rest && chord.beam === null) this.placeStem(chord)
		for (const chord of measureChords) this.finishChord(chord)
		chords.push(...measureChords)
	}

	layoutRest(chord, placement) {
		const rest = chord.cr
		const value = rest.measureRest ? (placement.measure.ticks >= this.score.division * 8 ? 0 : 1) : rest.value
		const glyphs = { 0: G.REST_DOUBLE_WHOLE, 1: G.REST_WHOLE, 2: G.REST_HALF, 4: G.REST_QUARTER, 8: G.REST_8TH, 16: G.REST_16TH, 32: G.REST_32ND }
		chord.restGlyph = glyphs[value] || G.REST_64TH
		const offset = chord.multiVoice ? (rest.voice % 2 === 0 ? -2 : 2) : 0
		chord.restY = (value === 1 ? 1 : value === 0 ? 1 : 2) + offset
		if (value === 1 && chord.multiVoice) chord.restY = rest.voice % 2 === 0 ? 0 : 3
		chord.noteWidth = Glyphs.width(chord.restGlyph)
		if (rest.measureRest) {
			const start = placement.x + (placement.measure.startRepeat ? 1.7 : 0)
				+ (placement.systemStart ? 0 : this.spacing[placement.index].changes)
			chord.x = (start + placement.end()) / 2 - chord.noteWidth / 2
		}
		const b = Glyphs.box(chord.restGlyph)
		chord.top = chord.restY + b[1]; chord.bottom = chord.restY + b[3]
		chord.dotX = chord.x + chord.noteWidth + 0.35
	}

	buildBeams(measure, chords, voice, beams) {
		const list = chords.filter(chord => chord.cr.voice === voice).sort((a, b) => a.cr.tick - b.cr.tick)
		let current = null, currentGroup = null
		for (const chord of list) {
			const cr = chord.cr
			const beamable = !cr.rest && cr.value >= 8 && cr.beamMode !== 'no'
			if (!beamable) {
				if (cr.rest && current !== null && cr.beamMode === 'mid') continue
				current = this.closeBeam(current, beams); currentGroup = null
				continue
			}
			// MuseScore 2 stores explicit beams with an id; everything else is beamed automatically.
			const group = cr.beamId >= 0 ? 2000000 + cr.beamId : this.beamGroup(measure, cr)
			const join = current !== null && (cr.beamMode === 'mid' || (cr.beamMode !== 'begin' && group === currentGroup))
			if (!join) { current = this.closeBeam(current, beams); current = new Beam() }
			current.chords.push(chord)
			currentGroup = group
		}
		this.closeBeam(current, beams)
	}

	closeBeam(beam, beams) {
		if (beam === null) return null
		if (beam.chords.length > 1) {
			beams.push(beam)
			const forced = beam.chords.find(chord => chord.cr.stemDirection !== 0)
			if (forced) beam.up = forced.cr.stemDirection > 0
			else if (beam.chords[0].multiVoice) beam.up = beam.chords[0].cr.voice % 2 === 0
			else {
				let highest = Infinity, lowest = -Infinity
				for (const chord of beam.chords) { highest = Math.min(highest, chord.topNoteY()); lowest = Math.max(lowest, chord.bottomNoteY()) }
				beam.up = (lowest - 2) > (2 - highest)
			}
			for (const chord of beam.chords) { chord.beam = beam; chord.up = beam.up }
		}
		return null
	}

	/** Beat group for automatic beaming, following MuseScore's default beam groups. */
	beamGroup(measure, cr) {
		if (cr.tuplet) {
			if (!this.tupletIds.has(cr.tuplet)) this.tupletIds.set(cr.tuplet, this.tupletIds.size)
			return 1000000 + this.tupletIds.get(cr.tuplet)
		}
		const offset = cr.tick - measure.tick
		const quarter = this.score.division
		let group
		if (measure.timeD === 8 && measure.timeN % 3 === 0) group = Math.trunc(quarter * 3 / 2)
		else if (measure.timeD === 8) group = Math.max(Math.trunc(quarter / 2), measure.ticks)
		else if (measure.timeD === 2) group = cr.value <= 8 ? quarter * 2 : quarter
		else if (measure.timeD === 4 && (measure.timeN === 4 || measure.timeN === 2) && cr.value <= 8) group = quarter * 2
		else group = Math.trunc(quarter * 4 / Math.max(1, measure.timeD))
		if (cr.value > 8) group = Math.min(group, measure.timeD === 8 && measure.timeN % 3 === 0 ? Math.trunc(quarter * 3 / 2) : quarter)
		return Math.trunc(offset / Math.max(1, group))
	}

	placeNotes(chord) {
		const n = chord.notes.length
		chord.noteX = new Array(n).fill(0); chord.accX = new Array(n).fill(0)
		const base = chord.x
		if (chord.up) {
			let previous = null, previousShifted = false
			for (let i = n - 1; i >= 0; i--) {
				const position = chord.notes[i].position
				const shift = previous !== null && previous - position === 1 && !previousShifted
				chord.noteX[i] = base + (shift ? chord.noteWidth : 0)
				previousShifted = shift; previous = position
			}
		} else {
			let previous = null, previousShifted = false
			for (let i = 0; i < n; i++) {
				const position = chord.notes[i].position
				const shift = previous !== null && position - previous === 1 && !previousShifted
				chord.noteX[i] = base - (shift ? chord.noteWidth : 0)
				previousShifted = shift; previous = position
			}
		}
		let left = Infinity, right = -Infinity
		for (const x of chord.noteX) { left = Math.min(left, x); right = Math.max(right, x + chord.noteWidth) }
		// Accidentals stack leftwards in columns whenever they would collide vertically.
		const placed = []
		for (let i = 0; i < n; i++) {
			const accidental = chord.notes[i].shownAccidental
			if (!accidental) continue
			const width = Glyphs.width(accidental) * chord.scale
			const y = chord.notes[i].position * 0.5
			let x = left - 0.2 - width
			let moved = true
			while (moved) {
				moved = false
				for (const other of placed) {
					if (Math.abs(other[1] - y) < 2.5 && x < other[0] + other[2] && x + width > other[0]) { x = other[0] - 0.15 - width; moved = true }
				}
			}
			chord.accX[i] = x
			placed.push([x, y, width])
		}
		chord.dotX = right + 0.35
		chord.stemX = chord.up ? base + chord.noteWidth - STEM / 2 : base + STEM / 2
		chord.stemStartY = chord.up ? chord.bottomNoteY() - 0.16 : chord.topNoteY() + 0.17
	}

	placeStem(chord) {
		if (!chord.hasStem) { chord.stemEndY = chord.up ? chord.topNoteY() : chord.bottomNoteY(); return }
		const length = 3.5 + Math.max(0, chord.flags - 2) * 0.5
		if (chord.up) {
			let end = chord.topNoteY() - length * chord.scale
			if (end > 2 && !chord.multiVoice) end = 2
			chord.stemEndY = end
		} else {
			let end = chord.bottomNoteY() + length * chord.scale
			if (end < 2 && !chord.multiVoice) end = 2
			chord.stemEndY = end
		}
	}

	placeBeam(beam) {
		const first = beam.chords[0], last = beam.chords[beam.chords.length - 1]
		let levels = 1
		for (const chord of beam.chords) levels = Math.max(levels, chord.flags)
		const minLength = 2.75 + (levels - 1) * BEAM_DISTANCE
		beam.x1 = first.stemX; beam.x2 = last.stemX
		const y1 = beam.up ? first.topNoteY() - 3.5 : first.bottomNoteY() + 3.5
		const y2 = beam.up ? last.topNoteY() - 3.5 : last.bottomNoteY() + 3.5
		const maxSlope = Math.min(1.0, Math.max(0.25, (beam.x2 - beam.x1) * 0.12))
		let dy = Math.max(-maxSlope, Math.min(maxSlope, y2 - y1))
		let concave = false
		for (let i = 1; i + 1 < beam.chords.length; i++) {
			const chord = beam.chords[i]
			const y = beam.up ? chord.topNoteY() : chord.bottomNoteY()
			const a = beam.up ? first.topNoteY() : first.bottomNoteY(), b = beam.up ? last.topNoteY() : last.bottomNoteY()
			if (beam.up ? y < Math.min(a, b) : y > Math.max(a, b)) concave = true
		}
		if (concave || first.notes[0].position === last.notes[0].position) dy = 0
		beam.y1 = y1; beam.y2 = y1 + dy
		let violation = -Infinity
		for (const chord of beam.chords) {
			const y = beam.yAt(chord.stemX)
			if (beam.up) {
				let limit = chord.topNoteY() - minLength
				if (chord.topNoteY() - 3.5 > 2 && !chord.multiVoice) limit = Math.min(limit, 2)
				violation = Math.max(violation, y - limit)
			} else {
				let limit = chord.bottomNoteY() + minLength
				if (chord.bottomNoteY() + 3.5 < 2 && !chord.multiVoice) limit = Math.max(limit, 2)
				violation = Math.max(violation, limit - y)
			}
		}
		if (violation > 0 || violation < -0.01) {
			// Bring the beam as close to the notes as the shortest stem allows.
			const shift = beam.up ? -violation : violation
			beam.y1 += shift; beam.y2 += shift
		}
		for (const chord of beam.chords) chord.stemEndY = beam.yAt(chord.stemX)
	}

	finishChord(chord) {
		if (chord.cr.rest) return
		let top = chord.topNoteY() - 0.6, bottom = chord.bottomNoteY() + 0.6
		if (chord.hasStem) {
			if (chord.up) top = Math.min(top, chord.stemEndY - (chord.beam !== null ? 0 : 0.2))
			else bottom = Math.max(bottom, chord.stemEndY + (chord.beam !== null ? 0 : 0.2))
		}
		for (const note of chord.notes) {
			if (!note.shownAccidental) continue
			const y = note.position * 0.5
			top = Math.min(top, y - 1.4); bottom = Math.max(bottom, y + 1.4)
		}
		// Articulations: staccato/tenuto/accent go to the notehead side, others above the staff.
		let aboveY = Math.min(top, chord.topNoteY() - 0.5), belowY = Math.max(bottom, chord.bottomNoteY() + 0.5)
		let noteSideAbove = chord.topNoteY() - 0.7, noteSideBelow = chord.bottomNoteY() + 0.7
		for (const articulation of chord.cr.articulations) {
			const ornament = articulation.startsWith('ornament') || articulation.startsWith('brass') || articulation.startsWith('articMarcato')
			let above = ornament || !chord.up || (chord.multiVoice && chord.cr.voice % 2 === 0)
			if (chord.multiVoice && chord.cr.voice % 2 === 1 && !ornament) above = false
			const parts = articulation.endsWith('Staccato') && articulation !== 'articStaccato'
				? ['articStaccato', articulation.substring(0, articulation.length - 'Staccato'.length)]
				: [articulation]
			for (const part of parts) {
				const glyph = Glyphs.byName(part.startsWith('artic') ? part + (above ? 'Above' : 'Below') : part)
				if (!glyph) continue
				const b = Glyphs.box(glyph)
				const height = b[3] - b[1], width = b[2] - b[0]
				let y
				if (ornament) {
					y = Math.min(-0.6, Math.min(aboveY, noteSideAbove) - 0.4)
					aboveY = y - height; noteSideAbove = aboveY
				} else if (above) {
					let center = noteSideAbove - height / 2 - (chord.up && chord.hasStem ? 0 : 0.2)
					if (!chord.up && chord.hasStem) center = Math.min(center, chord.topNoteY() - 0.9)
					if (center > -0.2 && center < 4.2 && Math.abs(center - Math.round(center)) < 0.3) center -= 0.5
					y = center + height / 2
					noteSideAbove = center - height / 2 - 0.25
					aboveY = Math.min(aboveY, noteSideAbove)
				} else {
					let center = noteSideBelow + height / 2
					if (center > -0.2 && center < 4.2 && Math.abs(center - Math.round(center)) < 0.3) center += 0.5
					y = center - height / 2
					noteSideBelow = center + height / 2 + 0.25
					belowY = Math.max(belowY, noteSideBelow)
				}
				chord.marks.push([glyph, chord.centerX() - width / 2 - b[0], y, 1])
			}
		}
		top = Math.min(top, aboveY); bottom = Math.max(bottom, belowY)
		if (chord.cr.fermata) {
			const below = chord.cr.fermata.includes('Below')
			const glyph = below ? G.FERMATA_BELOW : G.FERMATA_ABOVE
			const width = Glyphs.width(glyph)
			const y = below ? Math.max(4.6, bottom + 0.4) : Math.min(-0.5, top - 0.4)
			chord.marks.push([glyph, chord.centerX() - width / 2, y, 1])
			if (below) bottom = y + 1.5; else top = y - 1.5
		}
		if (chord.cr.breath) chord.marks.push([G.BREATH, chord.x + chord.noteWidth + 0.9 + chord.cr.dots * 0.5, -0.4, 1])
		chord.top = top; chord.bottom = bottom
	}

	// ---- pages --------------------------------------------------------------------------------------------

	paginate() {
		const score = this.score, staffCount = this.staffCount
		const usableBottom = this.pageHeight - this.marginBottom
		let page = newPage()
		let y = this.marginTop
		const hasTitle = (score.title + score.subtitle + score.composer + score.lyricist).trim() !== ''
		if (hasTitle) {
			page.title = true
			let cursor = this.marginTop
			if (score.title) cursor += TITLE * 1.1
			if (score.subtitle) cursor += SUBTITLE * 1.4
			if (score.composer || score.lyricist) cursor += COMPOSER * 1.8
			page.titleBottom = cursor
			y = cursor + 2
		}
		this.pages.push(page)
		let previous = null
		for (const system of this.systems) {
			let staffTop
			if (previous === null || page.systems.length === 0) staffTop = y - system.top
			else {
				const previousStaffTop = page.y[page.y.length - 1]
				const previousBottomLine = previousStaffTop + previous.staffY[staffCount - 1] + 4
				const distance = Math.max(SYSTEM_DISTANCE, (previousStaffTop + previous.bottom) - previousBottomLine + (-system.top) + 1.5)
				staffTop = previousBottomLine + distance
			}
			const pageBreak = previous !== null && score.measures[previous.last].pageBreak
			if (page.systems.length > 0 && (pageBreak || staffTop + system.bottom > usableBottom)) {
				page = newPage()
				this.pages.push(page)
				staffTop = this.marginTop - system.top
			}
			page.systems.push(system); page.y.push(staffTop)
			previous = system
		}
		// Spread the systems of full pages over the page height like MuseScore does.
		for (let p = 0; p + 1 < this.pages.length; p++) {
			const layout = this.pages[p]
			const n = layout.systems.length
			if (n < 2) continue
			const lastSystem = layout.systems[n - 1]
			const free = usableBottom - (layout.y[n - 1] + lastSystem.bottom)
			if (free <= 0) continue
			const add = free / (n - 1)
			for (let i = 1; i < n; i++) {
				const above = layout.systems[i - 1]
				const gap = layout.y[i] - (layout.y[i - 1] + above.staffY[staffCount - 1] + 4)
				const extra = Math.max(0, Math.min(add, MAX_SYSTEM_DISTANCE - gap))
				for (let j = i; j < n; j++) layout.y[j] += extra
			}
		}
	}

	/** Top and bottom staff line of every staff on a page as ratios of the page height, as [top0, bottom0, ...]. */
	staffRatios(pageIndex) {
		const page = this.pages[pageIndex]
		const ratios = []
		page.systems.forEach((system, i) => {
			const y = page.y[i]
			for (let s = 0; s < this.staffCount; s++) {
				ratios.push((y + system.staffY[s]) / this.pageHeight, (y + system.staffY[s] + 4) / this.pageHeight)
			}
		})
		return ratios
	}

	/** System bounds of a page as ratios of the page height, as [top0, bottom0, top1, bottom1, ...]. */
	systemRatios(pageIndex) {
		const page = this.pages[pageIndex]
		const n = page.systems.length
		const ratios = new Array(n * 2)
		for (let i = 0; i < n; i++) {
			const system = page.systems[i]
			const y = page.y[i]
			ratios[i * 2] = Math.max(0, (y + system.top - 1.0) / this.pageHeight)
			ratios[i * 2 + 1] = Math.min(1, (y + system.bottom + 1.0) / this.pageHeight)
		}
		for (let i = 1; i < n; i++) {
			if (ratios[i * 2] < ratios[i * 2 - 1]) {
				const middle = (ratios[i * 2] + ratios[i * 2 - 1]) / 2
				ratios[i * 2 - 1] = middle; ratios[i * 2] = middle
			}
		}
		return ratios
	}

	/**
	 * Playback cursor for a tick as {page, system, x, left, right, top, bottom};
	 * x values are ratios of the page width, top and bottom ratios of the page height. Null outside the score.
	 */
	cursorAt(tick) {
		for (let p = 0; p < this.pages.length; p++) {
			const page = this.pages[p]
			for (let i = 0; i < page.systems.length; i++) {
				const system = page.systems[i]
				if (tick < system.startTick() || tick >= system.endTick()) continue
				const placement = system.placement(tick)
				const y = page.y[i]
				const top = y + system.staffY[0] - 1.5, bottom = y + system.staffY[this.staffCount - 1] + 5.5
				const x = system.xAt(tick, false)
				const left = placement === null ? x : placement.x, right = placement === null ? x : placement.end()
				return {
					page: p, system: i, x: x / this.pageWidth, left: left / this.pageWidth, right: right / this.pageWidth,
					top: Math.max(0, top / this.pageHeight), bottom: Math.min(1, bottom / this.pageHeight),
				}
			}
		}
		return null
	}

	/**
	 * Index of the measure at a point of a page (ratios of page width and height), or -1 when the page has no
	 * systems. Points beside a system pick its nearest measure, points between systems the nearest system.
	 */
	measureAt(pageIndex, xRatio, yRatio) {
		if (pageIndex < 0 || pageIndex >= this.pages.length) return -1
		const page = this.pages[pageIndex]
		const x = xRatio * this.pageWidth, y = yRatio * this.pageHeight
		let best = null, bestDistance = Infinity
		page.systems.forEach((system, i) => {
			const top = page.y[i] + system.staffY[0], bottom = page.y[i] + system.staffY[this.staffCount - 1] + 4
			const distance = y < top ? top - y : y > bottom ? y - bottom : 0
			if (distance < bestDistance) { bestDistance = distance; best = system }
		})
		if (best === null) return -1
		for (const p of best.measures) if (x < p.end()) return p.index
		return best.measures[best.measures.length - 1].index
	}

	/**
	 * Areas of the measures first..last on a page as [{system, left, right, top, bottom}], one per system;
	 * values are ratios like in cursorAt.
	 */
	measureBoxes(pageIndex, first, last) {
		const boxes = []
		if (pageIndex < 0 || pageIndex >= this.pages.length) return boxes
		const page = this.pages[pageIndex]
		page.systems.forEach((system, i) => {
			const inside = system.measures.filter(p => p.index >= first && p.index <= last)
			if (inside.length === 0) return
			const y = page.y[i]
			const top = y + system.staffY[0] - 1.5, bottom = y + system.staffY[this.staffCount - 1] + 5.5
			boxes.push({
				system: i, left: inside[0].x / this.pageWidth, right: inside[inside.length - 1].end() / this.pageWidth,
				top: Math.max(0, top / this.pageHeight), bottom: Math.min(1, bottom / this.pageHeight),
			})
		})
		return boxes
	}

	/** First tick of a system, or -1 if the page has no such system. */
	systemStartTick(pageIndex, systemIndex) {
		if (pageIndex < 0 || pageIndex >= this.pages.length) return -1
		const page = this.pages[pageIndex]
		return systemIndex < 0 || systemIndex >= page.systems.length ? -1 : page.systems[systemIndex].startTick()
	}

	drawPage(painter, pageIndex) {
		const score = this.score
		const page = this.pages[pageIndex]
		if (page.title) {
			let y = this.marginTop
			const center = this.pageWidth / 2
			if (score.title) { y += TITLE * 1.1; painter.text(score.title, center, y - TITLE * 0.25, TITLE, 0, CENTER) }
			if (score.subtitle) { y += SUBTITLE * 1.4; painter.text(score.subtitle, center, y - SUBTITLE * 0.3, SUBTITLE, 0, CENTER) }
			if (score.composer || score.lyricist) {
				y += COMPOSER * 1.8
				painter.text(score.composer, this.pageWidth - this.marginRight, y - COMPOSER * 0.3, COMPOSER, 0, RIGHT)
				painter.text(score.lyricist, this.marginLeft, y - COMPOSER * 0.3, COMPOSER, 0, LEFT)
			}
		}
		page.systems.forEach((system, i) => this.drawSystem(new OffsetPainter(painter, 0, page.y[i]), system))
	}

	// ---- drawing ------------------------------------------------------------------------------------------

	drawSystem(p, system) {
		const staffCount = this.staffCount, staves = this.score.staves
		for (let s = 0; s < staffCount; s++) this.drawStaff(new OffsetPainter(p, 0, system.staffY[s]), system, s)
		const bottom = system.staffY[staffCount - 1] + 4
		if (staffCount > 1) p.line(system.x0, 0, system.x0, bottom, THIN)
		for (let s = 0; s < staffCount; s++) {
			const staff = staves[s]
			if (staff.bracket === 0) continue
			const end = Math.min(staffCount - 1, s + staff.bracketSpan - 1)
			if (end === s && staff.bracket === 2) continue
			const top = system.staffY[s], bracketBottom = system.staffY[end] + 4
			if (staff.bracket === 2) {
				const scale = (bracketBottom - top) / 4
				p.glyph(G.BRACE, system.x0 - 0.35 - Glyphs.width(G.BRACE) * scale, bracketBottom, scale)
			} else {
				const x = system.x0 - 0.8
				p.line(x, top - 0.45, x, bracketBottom + 0.45, 0.45)
				p.curveBand(x - 0.225, top - 0.45, x + 0.5, top - 0.45, x + 1.0, top - 0.6,
					x + 0.5, top - 0.05, x + 1.0, top - 0.6, x + 1.4, top - 1.15)
				p.curveBand(x - 0.225, bracketBottom + 0.45, x + 0.5, bracketBottom + 0.45, x + 1.0, bracketBottom + 0.6,
					x + 0.5, bracketBottom + 0.05, x + 1.0, bracketBottom + 0.6, x + 1.4, bracketBottom + 1.15)
			}
		}
		// Barlines run through all staves of a barline group.
		let group = 0
		while (group < staffCount) {
			let end = group
			while (end + 1 < staffCount && staves[end].barLineToNext) end++
			for (const placement of system.measures) {
				const measure = placement.measure
				const type = measure.endRepeat > 0 ? 'end-repeat' : measure.endBarline
				this.drawBarline(p, type, placement.end(), system, group, end)
				if (measure.startRepeat) this.drawBarline(p, 'start-repeat', placement.x, system, group, end)
			}
			group = end + 1
		}
		if (this.showNames) {
			for (let s = 0; s < staffCount; s++) {
				const staff = staves[s]
				const name = system.firstSystem ? staff.name : staff.shortName
				if (!name) continue
				let end = s
				while (end + 1 < staffCount && staves[end + 1].part === staff.part) end++
				const center = (system.staffY[s] + system.staffY[end] + 4) / 2
				p.text(name, system.x0 - this.bracketWidth() - 0.6, center + NAME * 0.35, NAME, 0, RIGHT)
			}
		}
	}

	drawBarline(p, type, x, system, firstStaff, lastStaff) {
		const top = system.staffY[firstStaff], bottom = system.staffY[lastStaff] + 4
		const repeatDots = dotX => {
			for (let s = firstStaff; s <= lastStaff; s++) {
				p.glyph(G.REPEAT_DOT, dotX, system.staffY[s] + 1.5, 1)
				p.glyph(G.REPEAT_DOT, dotX, system.staffY[s] + 2.5, 1)
			}
		}
		switch (type) {
		case 'double':
		case 'reverse-end':
			p.line(x - THIN / 2, top, x - THIN / 2, bottom, THIN)
			p.line(x - THIN * 1.5 - BAR_GAP, top, x - THIN * 1.5 - BAR_GAP, bottom, THIN)
			break
		case 'end':
			p.line(x - THICK / 2, top, x - THICK / 2, bottom, THICK)
			p.line(x - THICK - BAR_GAP - THIN / 2, top, x - THICK - BAR_GAP - THIN / 2, bottom, THIN)
			break
		case 'heavy':
			p.line(x - THICK / 2, top, x - THICK / 2, bottom, THICK)
			break
		case 'dashed': case 'dotted': {
			const dash = type === 'dashed' ? 0.6 : 0.2, gap = type === 'dashed' ? 0.57 : 0.3
			for (let y = top; y < bottom; y += dash + gap) p.line(x - THIN / 2, y, x - THIN / 2, Math.min(bottom, y + dash), THIN)
			break
		}
		case 'end-repeat': {
			p.line(x - THICK / 2, top, x - THICK / 2, bottom, THICK)
			const thin = x - THICK - BAR_GAP - THIN / 2
			p.line(thin, top, thin, bottom, THIN)
			repeatDots(thin - THIN / 2 - BAR_GAP - Glyphs.width(G.REPEAT_DOT))
			break
		}
		case 'start-repeat': {
			p.line(x + THICK / 2, top, x + THICK / 2, bottom, THICK)
			const thin = x + THICK + BAR_GAP + THIN / 2
			p.line(thin, top, thin, bottom, THIN)
			repeatDots(thin + THIN / 2 + BAR_GAP)
			break
		}
		default:
			p.line(x - THIN / 2, top, x - THIN / 2, bottom, THIN)
		}
	}

	drawStaff(p, system, s) {
		const staffCount = this.staffCount
		for (let i = 0; i < 5; i++) p.line(system.x0, i, system.x1, i, STAFF_LINE)
		// Header: clef, key signature and, where it changes, the time signature.
		const clef = this.clefAtStart[system.first][s]
		let x = system.x0 + 0.75
		drawClef(p, clef, x, 1)
		x += 2.6 + 0.8
		let maxKey = 0
		for (let staff = 0; staff < staffCount; staff++) maxKey = Math.max(maxKey, Math.ceil(keyWidth(this.keyAtStart[system.first][staff]) * 100))
		drawKey(p, clef, 0, this.keyAtStart[system.first][s], x)
		if (maxKey > 0) x += maxKey / 100 + 0.7
		const firstMeasure = this.score.measures[system.first]
		if (firstMeasure.timeChange || system.first === 0) drawTime(p, firstMeasure, x)

		for (const placement of system.measures) {
			const measure = placement.measure
			if (placement.systemStart) continue
			let cx = placement.changesX
			const index = placement.index
			if (this.clefChanged[index][s]) drawClef(p, this.clefAtStart[index][s], cx, 0.75)
			let anyClef = false
			for (let staff = 0; staff < staffCount; staff++) anyClef = anyClef || this.clefChanged[index][staff]
			if (anyClef) cx += 2.6
			let keyWidthMax = 0
			for (let staff = 0; staff < staffCount; staff++) {
				if (this.keyChanged[index][staff]) keyWidthMax = Math.max(keyWidthMax, keyChangeWidth(this.keyBefore[index][staff], this.keyAtStart[index][staff]))
			}
			if (this.keyChanged[index][s]) drawKey(p, this.clefAtStart[index][s], this.keyBefore[index][s], this.keyAtStart[index][s], cx)
			if (keyWidthMax > 0) cx += keyWidthMax + 0.8
			if (measure.timeChange) drawTime(p, measure, cx)
		}
		// Mid-measure clef changes are drawn small in front of their segment.
		for (const placement of system.measures) {
			for (const change of placement.measure.staves[s].clefs) {
				if (change.tick > placement.measure.tick) drawClef(p, change.clef, placement.xAt(change.tick) - 2.3, 0.75)
			}
		}
		if (s === 0 && !system.firstSystem) {
			const measure = this.score.measures[system.first]
			p.text(String(measure.number), system.x0, -1.9, NUMBER, ITALIC, LEFT)
		}

		const chords = system.chords[s]
		for (const chord of chords) this.drawChord(p, chord)
		for (const beam of system.beams[s]) drawBeam(p, beam)
		this.drawTuplets(p, chords)
		this.drawTies(p, system, chords)
		for (const spanner of this.score.spanners) {
			if (spanner.staff !== s || (!overlaps(system, spanner) && spanner.kind !== SpannerKind.SLUR)) continue
			if (spanner.kind === SpannerKind.SLUR) this.drawSlur(p, system, spanner)
			else if (spanner.kind === SpannerKind.VOLTA) { if (s === 0) drawVolta(p, system, spanner) } else this.drawHairpin(p, system, s, spanner)
		}
		drawLyrics(p, system, chords)
		this.drawAnnotations(p, system, s)
	}

	drawChord(p, chord) {
		const cr = chord.cr
		if (!cr.visible) return
		if (cr.rest) {
			p.glyph(chord.restGlyph, chord.x, chord.restY, chord.scale)
			for (let i = 0; i < cr.dots; i++) p.glyph(G.DOT, chord.dotX + i * 0.5, chord.restY > 2.5 ? 2.5 : 1.5, 1)
			return
		}
		drawGraces(p, chord)
		const scale = chord.scale
		let ledgerLeft = Infinity, ledgerRight = -Infinity
		for (const x of chord.noteX) { ledgerLeft = Math.min(ledgerLeft, x); ledgerRight = Math.max(ledgerRight, x + chord.noteWidth) }
		drawLedgers(p, chord.topNoteY(), chord.bottomNoteY(), ledgerLeft - 0.33 * scale, ledgerRight + 0.33 * scale)
		chord.notes.forEach((note, i) => {
			const y = note.position * 0.5
			p.glyph(chord.head, chord.noteX[i], y, scale)
			if (note.shownAccidental) p.glyph(note.shownAccidental, chord.accX[i], y, scale)
			for (let d = 0; d < cr.dots; d++) {
				const dotY = floorMod(note.position, 2) === 0 ? y + (chord.multiVoice && cr.voice % 2 === 1 ? 0.5 : -0.5) : y
				p.glyph(G.DOT, chord.dotX + d * 0.5, dotY, scale)
			}
		})
		if (chord.hasStem) p.line(chord.stemX, chord.stemStartY, chord.stemX, chord.stemEndY, STEM * scale)
		if (chord.flags > 0 && chord.beam === null) {
			const flag = chord.up ? G.FLAGS_UP[chord.flags - 1] : G.FLAGS_DOWN[chord.flags - 1]
			p.glyph(flag, chord.stemX - STEM * scale / 2, chord.stemEndY, scale)
		}
		for (const mark of chord.marks) p.glyph(mark[0], mark[1], mark[2], mark[3])
	}

	drawTuplets(p, chords) {
		for (const chord of chords) {
			const tuplet = chord.cr.tuplet
			if (!tuplet || tuplet.members[0] !== chord.cr || !tuplet.showNumber) continue
			let members = []
			for (const member of tuplet.members) {
				const layout = this.chordLayouts.get(member)
				if (!layout || layout.system !== chord.system) { members = null; break }
				members.push(layout)
			}
			if (!members || members.length === 0) continue
			let upCount = 0
			const beam = members[0].beam
			let oneBeam = beam !== null
			for (const member of members) {
				if (member.cr.rest || member.up) upCount++
				if (member.beam !== beam) oneBeam = false
			}
			const above = upCount * 2 >= members.length
			const first = members[0], last = members[members.length - 1]
			const left = first.x - 0.3, right = last.x + last.noteWidth + 0.3
			let edge = above ? Infinity : -Infinity
			for (const member of members) edge = above ? Math.min(edge, member.top) : Math.max(edge, member.bottom)
			edge = above ? Math.min(edge, -0.3) - 0.9 : Math.max(edge, 4.3) + 0.9
			const number = String(tuplet.actual)
			const center = (left + right) / 2
			if (oneBeam) {
				const beamSide = beam.up === above
				const y = beamSide ? (above ? beam.yAt(center) - 0.8 : beam.yAt(center) + 1.8) : (above ? edge + 0.6 : edge + 1.0)
				p.text(number, center, y, TUPLET, BOLD | ITALIC, CENTER)
			} else {
				const half = p.textWidth(number, TUPLET, BOLD | ITALIC) / 2 + 0.4
				const hook = above ? 0.6 : -0.6
				p.line(left, edge + hook, left, edge, 0.1)
				p.line(left, edge, center - half, edge, 0.1)
				p.line(center + half, edge, right, edge, 0.1)
				p.line(right, edge, right, edge + hook, 0.1)
				p.text(number, center, edge + TUPLET * 0.35, TUPLET, BOLD | ITALIC, CENTER)
			}
		}
	}

	drawTies(p, system, chords) {
		for (const chord of chords) {
			if (chord.cr.rest) continue
			chord.notes.forEach((note, i) => {
				const up = tieUp(chord, i)
				const y = note.position * 0.5 + (up ? -0.45 : 0.45)
				if (note.tieTo) {
					const target = this.noteOwners.get(note.tieTo)
					const start = chord.noteX[i] + chord.noteWidth + 0.15 + (chord.cr.dots > 0 ? 0.25 + chord.cr.dots * 0.5 : 0)
					let end
					if (target && target.system === system) {
						const index = target.notes.indexOf(note.tieTo)
						end = (index >= 0 ? target.noteX[index] : target.x) - 0.15
					} else end = system.x1 - 0.3
					drawArc(p, start, y, end, y, up, 0.18)
				}
				const source = this.tieSources.get(note)
				if (source) {
					const origin = this.noteOwners.get(source)
					if (!origin || origin.system !== system) drawArc(p, system.headerEnd - 0.8, y, chord.noteX[i] - 0.15, y, up, 0.18)
				}
			})
		}
	}

	drawSlur(p, system, slur) {
		const start = this.chordLayouts.get(slur.start), end = this.chordLayouts.get(slur.end)
		const startHere = start !== undefined && start.system === system, endHere = end !== undefined && end.system === system
		if (!startHere && !endHere) {
			if (slur.startTick < system.startTick() && slur.endTick >= system.endTick() && start && end) {
				const above = !(start.up && end.up)
				const y = above ? Math.min(-1, system.chordsTop[slur.staff] - 0.5) : Math.max(5, system.chordsBottom[slur.staff] + 0.5)
				drawCurve(p, system.headerEnd, y, system.x1, y, above, 1.2, 0.18)
			}
			return
		}
		const reference = startHere ? start : end
		let above
		if (reference.multiVoice) above = reference.cr.voice % 2 === 0
		else above = !((!start || start.up) && (!end || end.up))
		let x1, y1, x2, y2
		if (startHere) { x1 = slurX(start, above); y1 = slurY(start, above) } else { x1 = system.headerEnd; y1 = slurY(end, above) }
		if (endHere) { x2 = slurX(end, above); y2 = slurY(end, above) } else { x2 = system.x1 - 0.3; y2 = y1 }
		if (x2 - x1 < 0.5) return
		let bulge = Math.max(1.0, Math.min(2.6, (x2 - x1) * 0.12)) / 0.75
		for (const chord of system.chords[slur.staff]) {
			if (chord === start || chord === end || chord.cr.voice !== reference.cr.voice || chord.cr.rest) continue
			const x = chord.centerX()
			if (x <= x1 || x >= x2) continue
			const t = (x - x1) / (x2 - x1)
			const line = y1 + (y2 - y1) * t
			const need = above ? line - (chord.top - 0.5) : (chord.bottom + 0.5) - line
			if (need > 0) bulge = Math.max(bulge, need / (3 * t * (1 - t)))
		}
		drawCurve(p, x1, y1, x2, y2, above, Math.min(bulge, 6), 0.2)
	}

	drawHairpin(p, system, s, hairpin) {
		const startHere = hairpin.startTick >= system.startTick(), endHere = hairpin.endTick <= system.endTick()
		let x1 = startHere ? system.xAt(hairpin.startTick, false) : system.headerEnd
		let x2 = endHere ? system.xAt(hairpin.endTick, true) - 0.6 : system.x1 - 0.3
		if (startHere) {
			const dynamic = annotationAt(system, s, hairpin.startTick, Annotation.DYNAMIC)
			if (dynamic) x1 += dynamicWidth(p, dynamic.text) / 2 + 0.6
		}
		if (endHere) {
			const dynamic = annotationAt(system, s, hairpin.endTick, Annotation.DYNAMIC)
			if (dynamic) x2 = Math.min(x2, noteCenterAt(system, s, hairpin.endTick) - dynamicWidth(p, dynamic.text) / 2 - 0.6)
		}
		if (x2 - x1 < 1) return
		const y = system.dynamicBase[s] - 0.6, open = 0.6
		const crescendo = hairpin.kind === SpannerKind.CRESCENDO
		const startOpen = crescendo ? (startHere ? 0 : open * 0.5) : open
		const endOpen = crescendo ? open : (endHere ? 0 : open * 0.5)
		p.line(x1, y - startOpen, x2, y - endOpen, 0.12)
		p.line(x1, y + startOpen, x2, y + endOpen, 0.12)
	}

	drawAnnotations(p, system, s) {
		const rows = [], rowHeights = []
		for (const placement of system.measures) {
			const measure = placement.measure
			const measureEnd = measure.tick + measure.ticks
			for (const annotation of measure.staves[s].annotations) {
				if (annotation.kind === Annotation.DYNAMIC) {
					drawDynamic(p, annotation.text, noteCenterAt(system, s, annotation.tick), system.dynamicBase[s])
					continue
				}
				if (annotation.kind === Annotation.TEXT_BELOW) {
					p.text(annotation.text, system.xAt(annotation.tick, false), system.dynamicBase[s], TEXT, ITALIC, LEFT)
					continue
				}
				let size, style = 0, boxed = false, glyph = ''
				switch (annotation.kind) {
				case Annotation.TEMPO: size = TEMPO; style = BOLD; break
				case Annotation.REHEARSAL: size = REHEARSAL; style = BOLD; boxed = true; break
				case Annotation.CHORD_SYMBOL: size = CHORD_SYMBOL; break
				case Annotation.SEGNO: size = 0; glyph = G.SEGNO; break
				case Annotation.CODA: size = 0; glyph = G.CODA; break
				default: size = TEXT
				}
				const atEnd = annotation.tick >= measureEnd
				const lines = annotation.text.split('\n')
				let width = 0
				if (glyph) width = Glyphs.width(glyph)
				else for (const line of lines) width = Math.max(width, p.textWidth(line, size, style))
				const height = glyph ? 3.6 : size * 0.8 + (lines.length - 1) * size * 1.15 + (boxed ? 0.8 : 0)
				let x
				if (atEnd) x = placement.end() - width - 0.2
				else if (glyph || annotation.kind === Annotation.REHEARSAL) x = placement.xAt(annotation.tick) - (annotation.tick === measure.tick ? 1.0 : 0)
				else x = placement.xAt(annotation.tick)
				x = Math.max(this.marginLeft, Math.min(x, system.x1 - width))
				// Stack texts in rows above the staff so that they never overlap.
				let row = 0
				for (;;) {
					if (row >= rows.length) { rows.push([]); rowHeights.push(0) }
					if (rows[row].every(used => !(x < used[1] + 0.8 && x + width + 0.8 > used[0]))) break
					row++
				}
				let baseline = system.textBase[s]
				for (let r = 0; r < row; r++) baseline -= rowHeights[r] + 0.6
				rows[row].push([x, x + width])
				rowHeights[row] = Math.max(rowHeights[row], height)
				if (glyph) { p.glyph(glyph, x, baseline, 1); continue }
				lines.forEach((line, i) => p.text(line, x, baseline - (lines.length - 1 - i) * size * 1.15, size, style, LEFT))
				if (boxed) p.frame(x - 0.5, baseline - size * 0.8 - 0.4, x + width + 0.5, baseline + 0.5, 0.15)
			}
		}
	}
}

function newPage() { return { systems: [], y: [], title: false, titleBottom: 0 } }

function fixedWidth(ms, systemStart) {
	let sum = ms.lead + (systemStart ? 0 : ms.changes) + ms.trail
	for (const e of ms.extra) sum += e
	return sum
}

function stretchWidth(ms) { let sum = 0; for (const b of ms.base) sum += b; return sum }

function overlaps(system, spanner) { return spanner.startTick < system.endTick() && spanner.endTick > system.startTick() }

function accidentalGlyph(alter) {
	switch (alter) {
	case -2: return G.DOUBLE_FLAT
	case -1: return G.FLAT
	case 1: return G.SHARP
	case 2: return G.DOUBLE_SHARP
	default: return G.NATURAL
	}
}

const CLEF_TOP_LINES = { G8vb: 31, G8va: 45, G15ma: 52, G15mb: 24, F: 26, F8vb: 19, F15mb: 12, F8va: 33, F3: 28, C1: 36, C2: 34, C3: 32, C4: 30, C5: 28 }

/** Diatonic number (octave * 7 + step) of the top staff line for a clef. */
function clefTopLine(clef) { return CLEF_TOP_LINES[clef] ?? 38 }

function clefGlyph(clef) {
	if (clef.startsWith('G')) {
		return clef.includes('vb') || clef.includes('mb') ? G.G_CLEF_8VB : clef.includes('va') || clef.includes('ma') ? G.G_CLEF_8VA : G.G_CLEF
	}
	if (clef.startsWith('F')) return clef.includes('vb') || clef.includes('mb') ? G.F_CLEF_8VB : G.F_CLEF
	if (clef.startsWith('C')) return G.C_CLEF
	return clef.startsWith('PERC') ? G.PERCUSSION_CLEF : G.G_CLEF
}

/** Staff position (half spaces below the top line) of the clef glyph origin. */
function clefOrigin(clef) {
	if (clef.startsWith('F')) return clef === 'F3' ? 4 : 2
	switch (clef) {
	case 'C1': return 8
	case 'C2': return 6
	case 'C3': return 4
	case 'C4': return 2
	case 'C5': return 0
	default: return clef.startsWith('PERC') ? 4 : 6
	}
}

function keyWidth(key) { return Math.abs(key) * (key > 0 ? 1.0 : 0.95) }

function naturalsNeeded(before, after) {
	if (before === 0) return 0
	if (Math.sign(before) !== Math.sign(after)) return Math.abs(before)
	return Math.max(0, Math.abs(before) - Math.abs(after))
}

function keyChangeWidth(before, after) {
	const naturals = naturalsNeeded(before, after)
	return naturals * 0.8 + keyWidth(after) + (naturals > 0 && after !== 0 ? 0.4 : 0)
}

function digitsWidth(digits) {
	let width = 0
	for (const c of digits) if (c >= '0' && c <= '9') width += Glyphs.width(G.TIME_DIGITS[c.charCodeAt(0) - 48]) - 0.06
	return width
}

function timeWidth(measure) {
	if (measure.timeSymbol === 1 || measure.timeSymbol === 2) return Glyphs.width(G.TIME_COMMON)
	return Math.max(digitsWidth(String(measure.timeN)), digitsWidth(String(measure.timeD)))
}

function drawClef(p, clef, x, scale) { p.glyph(clefGlyph(clef), x, clefOrigin(clef) * 0.5, scale) }

function drawKey(p, clef, before, key, x) {
	let shift = clefTopLine(clef) - 38
	while (shift < -1) shift += 7
	while (shift > 5) shift -= 7
	const naturals = naturalsNeeded(before, key)
	if (naturals > 0) {
		const sharps = before > 0
		const start = Math.sign(before) === Math.sign(key) ? Math.abs(key) : 0
		for (let i = start; i < start + naturals && i < 7; i++) {
			const position = (sharps ? SHARP_POSITIONS[i] : FLAT_POSITIONS[i]) + shift
			p.glyph(G.NATURAL, x, position * 0.5, 1)
			x += 0.8
		}
		if (key !== 0) x += 0.4
	}
	for (let i = 0; i < Math.min(7, Math.abs(key)); i++) {
		let position = (key > 0 ? SHARP_POSITIONS[i] : FLAT_POSITIONS[i]) + shift
		if (key > 0 && clef === 'C4') position = [6, 2, 5, 1, 4, 0, 3][i]
		p.glyph(key > 0 ? G.SHARP : G.FLAT, x, position * 0.5, 1)
		x += key > 0 ? 1.0 : 0.95
	}
}

function drawTime(p, measure, x) {
	if (measure.timeSymbol === 1 || measure.timeSymbol === 2) {
		p.glyph(measure.timeSymbol === 1 ? G.TIME_COMMON : G.TIME_CUT, x, 2, 1)
		return
	}
	const numerator = String(measure.timeN), denominator = String(measure.timeD)
	const width = timeWidth(measure)
	drawDigits(p, numerator, x + (width - digitsWidth(numerator)) / 2, 1)
	drawDigits(p, denominator, x + (width - digitsWidth(denominator)) / 2, 3)
}

function drawDigits(p, digits, x, y) {
	for (const c of digits) {
		if (c < '0' || c > '9') continue
		const glyph = G.TIME_DIGITS[c.charCodeAt(0) - 48]
		p.glyph(glyph, x - 0.06, y, 1)
		x += Glyphs.width(glyph) - 0.06
	}
}

function drawLedgers(p, topY, bottomY, left, right) {
	for (let y = -1; y >= topY - 0.01; y -= 1) p.line(left, y, right, y, LEDGER)
	for (let y = 5; y <= bottomY + 0.01; y += 1) p.line(left, y, right, y, LEDGER)
}

function drawGraces(p, chord) {
	const n = chord.cr.graces.length
	if (n === 0) return
	let left = chord.x
	for (const x of chord.noteX) left = Math.min(left, x)
	for (const x of chord.accX) if (x !== 0) left = Math.min(left, x)
	const width = Glyphs.width(G.NOTEHEAD_BLACK) * GRACE
	chord.cr.graces.forEach((grace, k) => {
		if (grace.notes.length === 0) return
		const x = left - 0.3 - (n - k) * 1.25
		const top = grace.notes[0].position * 0.5, bottom = grace.notes[grace.notes.length - 1].position * 0.5
		drawLedgers(p, top, bottom, x - 0.25, x + width + 0.25)
		for (const note of grace.notes) {
			p.glyph(G.NOTEHEAD_BLACK, x, note.position * 0.5, GRACE)
			if (note.shownAccidental) p.glyph(note.shownAccidental, x - 0.2 - Glyphs.width(note.shownAccidental) * GRACE, note.position * 0.5, GRACE)
		}
		const stemX = x + width - STEM * GRACE / 2, end = top - 2.4
		p.line(stemX, bottom - 0.1, stemX, end, STEM * GRACE)
		if (grace.value >= 8) p.glyph(G.FLAGS_UP[Math.min(3, trailingZeros(grace.value) - 3)], stemX - STEM * GRACE / 2, end, GRACE)
	})
}

function drawBeam(p, beam) {
	const direction = beam.up ? 1 : -1
	let levels = 0
	for (const chord of beam.chords) levels = Math.max(levels, chord.flags)
	for (let level = 0; level < levels; level++) {
		const offset = level * BEAM_DISTANCE * direction
		let i = 0
		while (i < beam.chords.length) {
			if (beam.chords[i].flags <= level) { i++; continue }
			let j = i
			while (j + 1 < beam.chords.length && beam.chords[j + 1].flags > level) j++
			let xa = beam.chords[i].stemX - STEM / 2, xb = beam.chords[j].stemX + STEM / 2
			if (i === j) {
				// A lonely shorter note gets a beam stub pointing into the group.
				const left = i === beam.chords.length - 1 || (i > 0 && beam.chords[i - 1].cr.dots > 0)
				if (left) { xb = xa + STEM; xa = xb - 1.1 } else xb = xa + 1.1
			}
			const ya = beam.yAt(xa) + offset, yb = beam.yAt(xb) + offset
			p.polygon([xa, ya, xb, yb, xb, yb + BEAM * direction, xa, ya + BEAM * direction])
			i = j + 1
		}
	}
}

function tieUp(chord, noteIndex) {
	if (chord.multiVoice) return chord.cr.voice % 2 === 0
	const n = chord.notes.length
	if (n === 1) return !chord.up
	if (n % 2 === 1 && noteIndex === Math.trunc(n / 2)) return chord.notes[noteIndex].position < 4
	return noteIndex < n / 2
}

function drawArc(p, x1, y1, x2, y2, up, thickness) {
	const length = x2 - x1
	if (length < 0.3) return
	const height = Math.min(1.1, 0.25 + length * 0.06)
	drawCurve(p, x1, y1, x2, y2, up, height / 0.75, thickness)
}

function drawCurve(p, x1, y1, x2, y2, up, bulge, thickness) {
	const direction = up ? -1 : 1
	const dx = (x2 - x1) / 4, dy = (y2 - y1) / 4
	const inner = Math.max(0.1, bulge - thickness / 0.75)
	p.curveBand(x1, y1,
		x1 + dx, y1 + dy + direction * bulge, x2 - dx, y2 - dy + direction * bulge,
		x1 + dx, y1 + dy + direction * inner, x2 - dx, y2 - dy + direction * inner,
		x2, y2)
}

function slurX(chord, above) { return chord.hasStem && chord.up === above ? chord.stemX : chord.centerX() }

function slurY(chord, above) {
	if (chord.cr.rest) return above ? chord.top - 0.5 : chord.bottom + 0.5
	if (chord.hasStem && chord.up === above) return chord.stemEndY + (above ? -0.4 : 0.4)
	return above ? chord.topNoteY() - 0.9 : chord.bottomNoteY() + 0.9
}

function drawVolta(p, system, volta) {
	const startHere = volta.startTick >= system.startTick(), endHere = volta.endTick <= system.endTick()
	let x1 = startHere ? system.xAt(volta.startTick, true) + 0.4 : system.headerEnd
	const startPlacement = system.placement(volta.startTick)
	if (startHere && startPlacement !== null && startPlacement.systemStart) x1 = system.headerEnd + 0.2
	const x2 = endHere ? system.xAt(volta.endTick, true) - 0.5 : system.x1
	const y = system.voltaY[0]
	p.line(x1, y, x2, y, 0.11)
	if (startHere) {
		p.line(x1, y, x1, y + 2.2, 0.11)
		p.text(volta.text, x1 + 0.5, y + 1.9, 11 * PT, 0, LEFT)
	}
	if (endHere && volta.endHook) p.line(x2, y, x2, y + 2.2, 0.11)
}

function drawLyrics(p, system, chords) {
	const ordered = [...chords].sort((a, b) => a.cr.tick - b.cr.tick)
	const pendingHyphen = new Map()
	for (const chord of ordered) {
		for (const lyric of chord.cr.lyrics) {
			const baseline = system.lyricBase[chord.staff] + lyric.verse * 2.5
			const center = chord.cr.rest ? chord.x + chord.noteWidth / 2 : chord.centerX()
			const width = p.textWidth(lyric.text, LYRICS, 0)
			const hyphen = pendingHyphen.get(lyric.verse)
			pendingHyphen.delete(lyric.verse)
			if (hyphen !== undefined) {
				const from = hyphen, to = center - width / 2
				if (to - from > 0.8) p.line((from + to) / 2 - 0.4, baseline - LYRICS * 0.28, (from + to) / 2 + 0.4, baseline - LYRICS * 0.28, 0.12)
			}
			p.text(lyric.text, center, baseline, LYRICS, 0, CENTER)
			if (lyric.syllabic === 'begin' || lyric.syllabic === 'middle') pendingHyphen.set(lyric.verse, center + width / 2)
		}
	}
}

function annotationAt(system, s, tick, kind) {
	for (const placement of system.measures) {
		for (const annotation of placement.measure.staves[s].annotations) if (annotation.kind === kind && annotation.tick === tick) return annotation
	}
	return null
}

function noteCenterAt(system, s, tick) {
	for (const chord of system.chords[s]) if (chord.cr.tick === tick && chord.cr.voice === 0) return chord.cr.rest ? chord.x + chord.noteWidth / 2 : chord.centerX()
	for (const chord of system.chords[s]) if (chord.cr.tick === tick) return chord.centerX()
	return system.xAt(tick, false) + 0.65
}

function isDynamicLetters(text) { return text.length > 0 && [...text].every(c => Glyphs.dynamicLetter(c)) }

function dynamicWidth(p, text) {
	if (!isDynamicLetters(text)) return p.textWidth(text, TEXT, ITALIC)
	let width = 0
	for (const c of text) width += Glyphs.box(Glyphs.dynamicLetter(c))[2] + 0.05
	return width
}

function drawDynamic(p, text, center, baseline) {
	if (!isDynamicLetters(text)) { p.text(text, center, baseline, TEXT, ITALIC, CENTER); return }
	let x = center - dynamicWidth(p, text) / 2
	for (const c of text) {
		const glyph = Glyphs.dynamicLetter(c)
		p.glyph(glyph, x, baseline, 1)
		x += Glyphs.box(glyph)[2] + 0.05
	}
}

// ---- painters -----------------------------------------------------------------------------------------------

/** Translates all drawing by a fixed offset. */
class OffsetPainter {
	constructor(target, dx, dy) { this.target = target; this.dx = dx; this.dy = dy }
	line(x1, y1, x2, y2, width) { this.target.line(x1 + this.dx, y1 + this.dy, x2 + this.dx, y2 + this.dy, width) }
	polygon(points) { this.target.polygon(points.map((v, i) => v + (i % 2 === 0 ? this.dx : this.dy))) }
	curveBand(x1, y1, ax, ay, bx, by, cx, cy, ex, ey, x2, y2) {
		const { dx, dy } = this
		this.target.curveBand(x1 + dx, y1 + dy, ax + dx, ay + dy, bx + dx, by + dy, cx + dx, cy + dy, ex + dx, ey + dy, x2 + dx, y2 + dy)
	}

	glyph(glyph, x, y, scale) { this.target.glyph(glyph, x + this.dx, y + this.dy, scale) }
	text(text, x, y, size, style, align) { this.target.text(text, x + this.dx, y + this.dy, size, style, align) }
	textWidth(text, size, style) { return this.target.textWidth(text, size, style) }
	frame(left, top, right, bottom, width) { this.target.frame(left + this.dx, top + this.dy, right + this.dx, bottom + this.dy, width) }
}

/** Collects the vertical extent of everything drawn. */
class BoundsPainter {
	constructor(measurer) { this.measurer = measurer; this.minY = Infinity; this.maxY = -Infinity }
	add(y) { this.minY = Math.min(this.minY, y); this.maxY = Math.max(this.maxY, y) }
	line(x1, y1, x2, y2, width) { this.add(Math.min(y1, y2) - width / 2); this.add(Math.max(y1, y2) + width / 2) }
	polygon(points) { for (let i = 1; i < points.length; i += 2) this.add(points[i]) }
	curveBand(x1, y1, ax, ay, bx, by, cx, cy, dx, dy, x2, y2) {
		this.add(y1); this.add(y2)
		this.add(0.125 * y1 + 0.375 * ay + 0.375 * by + 0.125 * y2)
		this.add(0.125 * y1 + 0.375 * cy + 0.375 * dy + 0.125 * y2)
	}

	glyph(glyph, x, y, scale) {
		const b = Glyphs.box(glyph)
		if (!b) { this.add(y - scale); this.add(y + scale); return }
		this.add(y + b[1] * scale); this.add(y + b[3] * scale)
	}

	text(text, x, y, size) {
		if (!text) return
		this.add(y - size * 0.75); this.add(y + size * 0.25)
	}

	textWidth(text, size, style) { return this.measurer.textWidth(text, size, style) }
	frame(left, top, right, bottom, width) { this.add(top - width / 2); this.add(bottom + width / 2) }
}
