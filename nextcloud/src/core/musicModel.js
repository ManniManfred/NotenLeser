/** Format-independent description of an imported score; ticks use score.division per quarter. */

export function newScore() {
	return {
		title: '', subtitle: '', composer: '', lyricist: '',
		division: 480,
		// Page geometry in millimetres; the staff space ("spatium") defines all music sizes.
		spatiumMm: 1.75, pageWidthMm: 210, pageHeightMm: 297,
		marginLeftMm: 15, marginRightMm: 15, marginTopMm: 15, marginBottomMm: 15,
		staves: [], measures: [], spanners: [],
		/** Tempo changes as tick -> quarter notes per minute, including hidden tempo markings. */
		tempos: new Map(),
	}
}

export function newStaff() {
	// bracket: 0 = none, 1 = bracket, 2 = brace; program: General MIDI program (0 = piano)
	return { name: '', shortName: '', part: 0, bracket: 0, bracketSpan: 0, barLineToNext: false, clef: 'G', program: 0 }
}

export function newMeasure() {
	return {
		tick: 0, ticks: 0, timeN: 4, timeD: 4, timeChange: false,
		timeSymbol: 0, // 0 = numeric, 1 = common time, 2 = cut time
		startRepeat: false, irregular: false, endRepeat: 0,
		endBarline: null, // null or "double", "end", "dashed", "dotted", "heavy", "reverse-end", "end-repeat"
		lineBreak: false, pageBreak: false, number: 0,
		staves: [],
	}
}

export function newStaffMeasure() {
	return { key: null, clefs: [], chordRests: [], annotations: [] }
}

export function newChordRest() {
	return {
		tick: 0, duration: 0, voice: 0,
		value: 4, // 0 = breve, 1 = whole, 2 = half, 4 = quarter, 8 = eighth, ...
		dots: 0, rest: false, measureRest: false, grace: false, small: false, visible: true,
		notes: [],
		stemDirection: 0, // 1 = up, -1 = down, 0 = automatic
		beamMode: null, beamId: -1,
		articulations: [], fermata: null, breath: false, lyrics: [], tuplet: null, graces: [],
	}
}

export function newNote() {
	return {
		pitch: 0, tpc: 14, soundPitch: 0, tieStart: false, tieEnd: false, tieTo: null, head: null,
		accidental: null,
		// Layout: staff position in half spaces below the top line and the accidental glyph to show ('' for none).
		position: 0, shownAccidental: '',
	}
}

export const Annotation = { TEXT_ABOVE: 0, TEXT_BELOW: 1, DYNAMIC: 2, REHEARSAL: 3, TEMPO: 4, SEGNO: 5, CODA: 6, CHORD_SYMBOL: 7 }

export const SpannerKind = { SLUR: 0, CRESCENDO: 1, DIMINUENDO: 2, VOLTA: 3 }

export function newSpanner() {
	return { kind: 0, staff: 0, voice: 0, startTick: 0, endTick: 0, start: null, end: null, text: '', endHook: false }
}
