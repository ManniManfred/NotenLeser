import { unzipSync } from 'fflate'
import { symbolForName } from './glyphs.js'
import {
	Annotation, SpannerKind, newChordRest, newMeasure, newNote, newScore, newSpanner, newStaff, newStaffMeasure,
} from './musicModel.js'

/**
 * Reads MuseScore files (.mscz archives and plain .mscx, format versions 2 to 4) into a score model.
 * Pitches, spellings, keys and clefs are converted to written pitch unless the score is saved in concert pitch.
 *
 * parseXml(text) must return a DOM Document (DOMParser in the browser, @xmldom/xmldom in tests).
 */
export function readMuseScore(data, parseXml) {
	try {
		return new Reader(parseXml).parse(data)
	} catch (e) {
		throw new Error('MuseScore-Datei kann nicht gelesen werden: ' + (e && e.message ? e.message : e))
	}
}

export function looksLikeMuseScore(head, name) {
	const lower = (name || '').toLowerCase()
	if (lower.endsWith('.mscz') || lower.endsWith('.mscx')) return true
	return new TextDecoder().decode(head.subarray(0, 400)).includes('<museScore')
}

const floorMod = (a, b) => ((a % b) + b) % b

class Reader {
	constructor(parseXml) {
		this.parseXmlText = parseXml
		this.score = newScore()
		this.contexts = []
		this.pending = []
		this.legacySpanners = new Map()
		this.legacyTuplets = new Map()
		this.concertPitch = false
		this.version = 4
		this.timeN = 4; this.timeD = 4
	}

	parseXml(bytes) {
		const doc = this.parseXmlText(new TextDecoder('utf-8').decode(bytes))
		if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) throw new Error('Ungültiges XML')
		return doc
	}

	parse(data) {
		let scoreXml = data, styleXml = null
		const score = this.score
		if (data.length > 4 && data[0] === 0x50 && data[1] === 0x4B) {
			const entries = unzipSync(data, {
				filter: file => {
					const lower = file.name.toLowerCase()
					return lower.endsWith('.mscx') || lower.endsWith('.mss') || lower.endsWith('container.xml')
				},
			})
			let root = null
			const container = entries['META-INF/container.xml']
			if (container) {
				for (const file of descendants(this.parseXml(container).documentElement, 'rootfile')) {
					const path = file.getAttribute('full-path') || ''
					if (path.toLowerCase().endsWith('.mscx')) { root = path; break }
				}
			}
			if (root === null) root = Object.keys(entries).find(name => name.toLowerCase().endsWith('.mscx')) || null
			if (root === null || !entries[root]) throw new Error('Im MuseScore-Archiv fehlt die Partitur')
			scoreXml = entries[root]
			for (const name of Object.keys(entries)) if (name.toLowerCase().endsWith('.mss')) styleXml = entries[name]
		}
		const museScore = this.parseXml(scoreXml).documentElement
		const version = parseFloat(museScore.getAttribute('version'))
		if (!isNaN(version)) this.version = version
		const scoreElement = child(museScore, 'Score')
		if (!scoreElement) throw new Error('Keine Partitur in der Datei gefunden')
		if (styleXml) {
			const style = child(this.parseXml(styleXml).documentElement, 'Style')
			if (style) this.applyStyle(style)
		}
		const style = child(scoreElement, 'Style')
		if (style) this.applyStyle(style)
		score.division = intValue(child(scoreElement, 'Division'), 480)

		for (const metaTag of children(scoreElement, 'metaTag')) {
			const name = metaTag.getAttribute('name'), value = textContent(metaTag).trim()
			if (!value) continue
			if (name === 'workTitle' && !score.title) score.title = value
			else if (name === 'composer' && !score.composer) score.composer = value
			else if (name === 'lyricist' && !score.lyricist) score.lyricist = value
			else if (name === 'subtitle' && !score.subtitle) score.subtitle = value
		}

		let partIndex = 0
		for (const part of children(scoreElement, 'Part')) {
			const instrument = child(part, 'Instrument')
			let longName = text(instrument, 'longName')
			const shortName = text(instrument, 'shortName')
			if (!longName) longName = text(part, 'trackName')
			let staffInPart = 0
			for (const staffElement of children(part, 'Staff')) {
				staffInPart++
				const staff = newStaff()
				const context = { transposeChromatic: 0, transposeDiatonic: 0, fifths: 0, defaultClef: 'G' }
				staff.part = partIndex; staff.name = staffInPart === 1 ? longName : ''; staff.shortName = staffInPart === 1 ? shortName : ''
				if (instrument) {
					const channel = child(instrument, 'Channel')
					const program = channel ? child(channel, 'program') : null
					if (program) staff.program = Math.max(0, Math.min(127, parseInteger(program.getAttribute('value'), 0)))
					context.transposeChromatic = intValue(child(instrument, 'transposeChromatic'), 0)
					context.transposeDiatonic = intValue(child(instrument, 'transposeDiatonic'), 0)
					for (const clef of children(instrument, 'clef')) {
						const target = clef.getAttribute('staff') || ''
						if (target === '' ? staffInPart === 1 : target === String(staffInPart)) context.defaultClef = clefName(textContent(clef).trim())
					}
				}
				const staffType = child(staffElement, 'StaffType')
				if (staffType && staffType.getAttribute('group') === 'percussion') context.defaultClef = 'PERC'
				const defaultClef = text(staffElement, 'defaultClef')
				if (defaultClef) context.defaultClef = clefName(defaultClef)
				const bracket = child(staffElement, 'bracket')
				if (bracket) {
					const type = parseInteger(bracket.getAttribute('type'), -1), span = parseInteger(bracket.getAttribute('span'), 0)
					if (type >= 0 && span > 0) { staff.bracket = type === 1 ? 2 : 1; staff.bracketSpan = span }
				}
				// MuseScore 2 counts the spanned staves including itself, later versions store a flag.
				staff.barLineToNext = intValue(child(staffElement, 'barLineSpan'), 0) > (this.version < 3 ? 1 : 0)
				context.fifths = this.concertPitch ? 0 : transposeFifths(context.transposeChromatic, context.transposeDiatonic)
				staff.clef = context.defaultClef
				score.staves.push(staff); this.contexts.push(context)
			}
			partIndex++
		}
		const staffContents = children(scoreElement, 'Staff')
		// Files without part definitions still contain playable staves.
		while (score.staves.length < staffContents.length) {
			const staff = newStaff(); staff.part = score.staves.length
			score.staves.push(staff)
			this.contexts.push({ transposeChromatic: 0, transposeDiatonic: 0, fifths: 0, defaultClef: 'G' })
		}
		staffContents.forEach((staffElement, staffIndex) => {
			const id = parseInteger(staffElement.getAttribute('id'), staffIndex + 1) - 1
			this.readStaff(staffElement, id >= 0 && id < score.staves.length ? id : staffIndex)
		})
		this.finish()
		return score
	}

	applyStyle(style) {
		const score = this.score
		const inch = 25.4
		let width = floatValue(child(style, 'pageWidth'), -1), height = floatValue(child(style, 'pageHeight'), -1)
		if (width > 0) score.pageWidthMm = width * inch
		if (height > 0) score.pageHeightMm = height * inch
		const left = floatValue(child(style, 'pageOddLeftMargin'), -1)
		if (left >= 0) score.marginLeftMm = left * inch
		const printable = floatValue(child(style, 'pagePrintableWidth'), -1)
		if (printable > 0) score.marginRightMm = Math.max(0, score.pageWidthMm - score.marginLeftMm - printable * inch)
		const top = floatValue(child(style, 'pageOddTopMargin'), -1)
		if (top >= 0) score.marginTopMm = top * inch
		const bottom = floatValue(child(style, 'pageOddBottomMargin'), -1)
		if (bottom >= 0) score.marginBottomMm = bottom * inch
		const spatium = floatValue(child(style, 'spatium'), floatValue(child(style, 'Spatium'), -1))
		if (spatium > 0.3) score.spatiumMm = spatium
		if (child(style, 'concertPitch')) this.concertPitch = intValue(child(style, 'concertPitch'), 0) !== 0
		const pageLayout = child(style, 'page-layout')
		if (pageLayout) {
			// MuseScore 2 stores the page in 1/144 inch.
			const unit = inch / 144
			width = floatValue(child(pageLayout, 'page-width'), -1); height = floatValue(child(pageLayout, 'page-height'), -1)
			if (width > 0) score.pageWidthMm = width * unit
			if (height > 0) score.pageHeightMm = height * unit
			const margins = child(pageLayout, 'page-margins')
			if (margins) {
				score.marginLeftMm = floatValue(child(margins, 'left-margin'), score.marginLeftMm / unit) * unit
				score.marginRightMm = floatValue(child(margins, 'right-margin'), score.marginRightMm / unit) * unit
				score.marginTopMm = floatValue(child(margins, 'top-margin'), score.marginTopMm / unit) * unit
				score.marginBottomMm = floatValue(child(margins, 'bottom-margin'), score.marginBottomMm / unit) * unit
			}
		}
	}

	readStaff(staffElement, staffIndex) {
		let measureIndex = 0
		this.timeN = 4; this.timeD = 4
		for (const element of children(staffElement)) {
			const tag = element.tagName
			if (tag === 'VBox' || tag === 'TBox') {
				if (staffIndex === 0 && measureIndex === 0) this.readTitleFrame(element)
				else if (measureIndex > 0) applyLayoutBreaks(element, this.score.measures[measureIndex - 1])
			} else if (tag === 'Measure') {
				this.readMeasure(element, staffIndex, measureIndex++)
			}
		}
	}

	readTitleFrame(frame) {
		const score = this.score
		for (const textElement of children(frame, 'Text')) {
			const style = text(textElement, 'style').toLowerCase()
			const textChild = child(textElement, 'text')
			const value = textChild ? richText(textChild) : textContent(textElement).trim()
			if (!value) continue
			if (style === 'title') score.title = value
			else if (style === 'subtitle') score.subtitle = value
			else if (style === 'composer') score.composer = value
			else if (style === 'lyricist' || style === 'poet') score.lyricist = value
		}
	}

	readMeasure(element, staffIndex, measureIndex) {
		const score = this.score
		let measure
		if (measureIndex < score.measures.length) measure = score.measures[measureIndex]
		else {
			measure = newMeasure()
			if (measureIndex > 0) {
				const previous = score.measures[measureIndex - 1]
				measure.tick = previous.tick + previous.ticks
			}
			score.measures.push(measure)
		}
		while (measure.staves.length < score.staves.length) measure.staves.push(newStaffMeasure())
		const staffMeasure = measure.staves[staffIndex]

		for (const timeSig of descendants(element, 'TimeSig')) {
			if (intValue(child(timeSig, 'isCourtesy'), 0) !== 0) continue
			this.timeN = intValue(child(timeSig, 'sigN'), this.timeN); this.timeD = intValue(child(timeSig, 'sigD'), this.timeD)
			if (staffIndex === 0 || !measure.timeChange) {
				measure.timeChange = true
				measure.timeSymbol = intValue(child(timeSig, 'subtype'), 0)
			}
			break
		}
		if (staffIndex === 0 || measure.ticks === 0) {
			measure.timeN = this.timeN; measure.timeD = this.timeD
			const length = element.getAttribute('len') || ''
			measure.ticks = length === '' ? this.fractionTicks(this.timeN + '/' + this.timeD) : this.fractionTicks(length)
		}
		if (child(element, 'irregular')) measure.irregular = true
		if (child(element, 'startRepeat')) measure.startRepeat = true
		const endRepeat = child(element, 'endRepeat')
		if (endRepeat) measure.endRepeat = Math.max(2, intValue(endRepeat, 2))
		applyLayoutBreaks(element, measure)

		const voices = children(element, 'voice')
		if (voices.length === 0) this.readVoice(element, 0, measure, measureIndex, staffMeasure, staffIndex, true)
		else voices.forEach((voice, index) => this.readVoice(voice, index, measure, measureIndex, staffMeasure, staffIndex, false))
	}

	readVoice(container, voice, measure, measureIndex, staffMeasure, staffIndex, legacy) {
		const context = this.contexts[staffIndex]
		let cursor = measure.tick
		const tuplets = [] // stack, last = innermost
		const graces = []
		let fermata = null, last = null
		for (const element of children(container)) {
			switch (element.tagName) {
			case 'location':
				cursor += this.fractionTicks(text(element, 'fractions'))
				break
			case 'tick':
				cursor = intValue(element, cursor)
				break
			case 'Chord': case 'Rest': {
				const chordRest = this.readChordRest(element, cursor, voice, measure, measureIndex, staffIndex, context, tuplets)
				if (chordRest.grace) { graces.push(chordRest); break }
				chordRest.graces.push(...graces); graces.length = 0
				if (fermata !== null) { chordRest.fermata = fermata; fermata = null }
				staffMeasure.chordRests.push(chordRest)
				cursor += chordRest.duration
				last = chordRest
				break
			}
			case 'Tuplet': {
				const tuplet = {
					normal: Math.max(1, intValue(child(element, 'normalNotes'), 2)),
					actual: Math.max(1, intValue(child(element, 'actualNotes'), 3)),
					showNumber: intValue(child(element, 'numberType'), 0) !== 2 && intValue(child(element, 'visible'), 1) !== 0,
					members: [],
				}
				const id = element.getAttribute('id') || ''
				if (legacy && id) this.legacyTuplets.set(staffIndex + ':' + id, tuplet)
				else tuplets.push(tuplet)
				break
			}
			case 'endTuplet':
				tuplets.pop()
				break
			case 'KeySig':
				if (intValue(child(element, 'isCourtesy'), 0) === 0) staffMeasure.key = this.readKey(element, context)
				break
			case 'Clef':
				if (intValue(child(element, 'isCourtesy'), 0) === 0) {
					const clef = this.readClef(element)
					if (clef !== null) staffMeasure.clefs.push({ tick: cursor, clef })
				}
				break
			case 'Fermata':
				fermata = text(element, 'subtype').toLowerCase().includes('below') ? 'fermataBelow' : 'fermataAbove'
				break
			case 'Breath':
				if (last) last.breath = true
				break
			case 'BarLine': {
				const type = barlineType(text(element, 'subtype'))
				if (cursor > measure.tick && (staffIndex === 0 || measure.endBarline === null)) measure.endBarline = type
				break
			}
			case 'Spanner':
				this.readSpanner(element, null, cursor, measureIndex, staffIndex, voice)
				break
			case 'HairPin': case 'Volta':
				if (legacy) this.startLegacySpanner(element, cursor, measure, staffIndex, voice)
				break
			case 'Slur':
				break
			case 'endSpanner': {
				const id = element.getAttribute('id') || ''
				const spanner = this.legacySpanners.get(id)
				this.legacySpanners.delete(id)
				// MuseScore 2 ends a volta inside the last measure it covers.
				if (spanner) spanner.endTick = spanner.kind === SpannerKind.VOLTA ? measure.tick + measure.ticks : cursor
				break
			}
			default:
				this.readAnnotation(element, cursor, measure, staffMeasure)
			}
		}
		if (graces.length > 0 && last) last.graces.push(...graces)
	}

	readChordRest(element, tick, voice, measure, measureIndex, staffIndex, context, tuplets) {
		const score = this.score
		const chordRest = newChordRest()
		chordRest.rest = element.tagName === 'Rest'
		chordRest.tick = tick; chordRest.voice = voice
		const track = intValue(child(element, 'track'), -1)
		if (track >= 0) chordRest.voice = track % 4
		const type = text(element, 'durationType')
		chordRest.dots = intValue(child(element, 'dots'), 0)
		if (type === 'measure') {
			chordRest.measureRest = true
			const duration = text(element, 'duration')
			chordRest.duration = duration === '' ? measure.ticks : this.fractionTicks(duration)
			chordRest.value = 1
		} else {
			chordRest.value = durationValue(type)
			const base = chordRest.value === 0 ? score.division * 8 : Math.trunc(score.division * 4 / chordRest.value)
			let duration = base, dot = base
			for (let i = 0; i < chordRest.dots; i++) { dot = Math.trunc(dot / 2); duration += dot }
			chordRest.duration = duration
		}
		for (const grace of ['acciaccatura', 'appoggiatura', 'grace4', 'grace8after', 'grace16', 'grace16after', 'grace32', 'grace32after']) {
			if (child(element, grace)) chordRest.grace = true
		}
		if (chordRest.grace) chordRest.duration = 0
		chordRest.small = intValue(child(element, 'small'), 0) !== 0
		chordRest.visible = intValue(child(element, 'visible'), 1) !== 0
		const stem = text(element, 'StemDirection')
		chordRest.stemDirection = stem === 'up' ? 1 : stem === 'down' ? -1 : 0
		const beamMode = text(element, 'BeamMode')
		if (beamMode) chordRest.beamMode = beamMode.startsWith('begin') && beamMode !== 'begin' ? 'mid' : beamMode
		chordRest.beamId = intValue(child(element, 'Beam'), -1)

		let tuplet = null
		const legacyTuplet = child(element, 'Tuplet')
		if (legacyTuplet) tuplet = this.legacyTuplets.get(staffIndex + ':' + textContent(legacyTuplet).trim()) || null
		if (tuplet === null && tuplets.length > 0) tuplet = tuplets[tuplets.length - 1]
		if (tuplet !== null && !chordRest.grace) {
			chordRest.tuplet = tuplet; tuplet.members.push(chordRest)
			let duration = chordRest.duration
			if (tuplets.length === 0) duration = Math.trunc(duration * tuplet.normal / tuplet.actual)
			else for (let i = tuplets.length - 1; i >= 0; i--) duration = Math.trunc(duration * tuplets[i].normal / tuplets[i].actual)
			chordRest.duration = duration
		}

		for (const item of children(element)) {
			switch (item.tagName) {
			case 'Note': {
				const note = this.readNote(item, context)
				if (note) chordRest.notes.push(note)
				break
			}
			case 'Articulation': case 'Ornament': {
				const articulation = articulationName(text(item, 'subtype'))
				if (articulation === null) break
				if (articulation.startsWith('fermata')) chordRest.fermata = articulation
				else chordRest.articulations.push(articulation)
				break
			}
			case 'Lyrics': {
				const textElement = child(item, 'text')
				const lyric = {
					verse: intValue(child(item, 'no'), 0),
					syllabic: text(item, 'syllabic'),
					text: textElement ? richText(textElement) : '',
				}
				if (lyric.text) chordRest.lyrics.push(lyric)
				break
			}
			case 'Spanner':
				this.readSpanner(item, chordRest, tick, measureIndex, staffIndex, chordRest.voice)
				break
			case 'Slur': {
				const id = staffIndex + ':slur:' + (item.getAttribute('id') || '')
				if (item.getAttribute('type') === 'start') {
					const slur = newSpanner(); slur.kind = SpannerKind.SLUR; slur.staff = staffIndex
					slur.voice = chordRest.voice; slur.start = chordRest; slur.startTick = tick
					this.legacySpanners.set(id, slur); score.spanners.push(slur)
				} else if (item.getAttribute('type') === 'stop') {
					const slur = this.legacySpanners.get(id)
					this.legacySpanners.delete(id)
					if (slur) { slur.end = chordRest; slur.endTick = tick }
				}
				break
			}
			default:
			}
		}
		if (!chordRest.rest && chordRest.notes.length === 0) chordRest.rest = true
		return chordRest
	}

	readNote(element, context) {
		const note = newNote()
		const pitch = intValue(child(element, 'pitch'), -1)
		if (pitch < 0) return null
		note.soundPitch = pitch
		const tpc = intValue(child(element, 'tpc'), 14)
		const tpc2 = intValue(child(element, 'tpc2'), null)
		const transposed = context.fifths !== 0 || context.transposeChromatic % 12 !== 0
		if (transposed) {
			note.pitch = pitch - context.transposeChromatic
			note.tpc = tpc2 !== null ? tpc2 : tpc + context.fifths
		} else { note.pitch = pitch; note.tpc = tpc }
		const head = text(element, 'head')
		if (head === 'cross' || head === '1' || head === 'x') note.head = 'cross'
		const accidental = child(element, 'Accidental')
		if (accidental && !transposed) note.accidental = accidentalName(text(accidental, 'subtype'))
		if (child(element, 'Tie')) note.tieStart = true
		for (const spanner of children(element, 'Spanner')) {
			if (spanner.getAttribute('type') !== 'Tie') continue
			if (child(spanner, 'Tie') || child(spanner, 'next')) note.tieStart = true
			if (child(spanner, 'prev')) note.tieEnd = true
		}
		return note
	}

	readSpanner(element, chordRest, tick, measureIndex, staffIndex, voice) {
		const type = element.getAttribute('type') || ''
		let kind
		if (type === 'Slur') kind = SpannerKind.SLUR
		else if (type === 'HairPin') kind = SpannerKind.CRESCENDO
		else if (type === 'Volta') kind = SpannerKind.VOLTA
		else return
		const body = child(element, type)
		const next = child(element, 'next')
		if (!body || !next) return
		const spanner = newSpanner()
		spanner.kind = kind; spanner.staff = staffIndex; spanner.voice = voice; spanner.startTick = tick; spanner.start = chordRest
		if (kind === SpannerKind.CRESCENDO) {
			const subtype = intValue(child(body, 'subtype'), 0)
			if (subtype === 1 || subtype === 3) spanner.kind = SpannerKind.DIMINUENDO
		} else if (kind === SpannerKind.VOLTA) readVoltaDetails(body, spanner)
		const location = child(next, 'location')
		const entry = { spanner, startMeasure: measureIndex, measures: 0, fractionTicks: 0 }
		if (location) {
			entry.measures = intValue(child(location, 'measures'), 0)
			entry.fractionTicks = this.fractionTicks(text(location, 'fractions'))
		}
		this.pending.push(entry)
		this.score.spanners.push(spanner)
	}

	startLegacySpanner(element, tick, measure, staffIndex, voice) {
		const id = element.getAttribute('id') || ''
		if (!id || this.legacySpanners.has(id)) return
		const spanner = newSpanner()
		spanner.staff = staffIndex; spanner.voice = voice
		if (element.tagName === 'Volta') {
			spanner.kind = SpannerKind.VOLTA; spanner.startTick = measure.tick
			readVoltaDetails(element, spanner)
		} else {
			spanner.kind = intValue(child(element, 'subtype'), 0) % 2 === 1 ? SpannerKind.DIMINUENDO : SpannerKind.CRESCENDO
			spanner.startTick = tick
		}
		spanner.endTick = -1
		this.legacySpanners.set(id, spanner)
		this.score.spanners.push(spanner)
	}

	readAnnotation(element, tick, measure, staffMeasure) {
		const tag = element.tagName
		if (tag === 'Tempo') {
			// Stored as quarter notes per second; hidden markings still set the playback tempo.
			const quarterPerSecond = floatValue(child(element, 'tempo'), 0)
			if (quarterPerSecond > 0) this.score.tempos.set(tick, quarterPerSecond * 60)
		}
		if (intValue(child(element, 'visible'), 1) === 0) return
		const textElement = child(element, 'text')
		let value = textElement ? richText(textElement) : ''
		let kind
		switch (tag) {
		case 'Dynamic': {
			const subtype = text(element, 'subtype')
			value = subtype === '' || subtype === 'other-dynamics' ? value : subtype
			kind = Annotation.DYNAMIC; break
		}
		case 'StaffText': case 'SystemText': case 'InstrumentChange': case 'PlayTechAnnotation':
			kind = text(element, 'placement') === 'below' ? Annotation.TEXT_BELOW : Annotation.TEXT_ABOVE; break
		case 'Expression': kind = Annotation.TEXT_BELOW; break
		case 'RehearsalMark': kind = Annotation.REHEARSAL; break
		case 'Tempo': kind = Annotation.TEMPO; break
		case 'Harmony': {
			const root = intValue(child(element, 'root'), null)
			if (root === null) return
			value = tpcName(root) + text(element, 'name')
			const base = intValue(child(element, 'base'), null)
			if (base !== null) value += '/' + tpcName(base)
			kind = Annotation.CHORD_SYMBOL; break
		}
		case 'Marker': {
			const subtype = text(element, 'subtype').toLowerCase()
			if (subtype.includes('segno')) { kind = Annotation.SEGNO; value = '' } else if (subtype === 'coda' || subtype === 'varcoda' || subtype === 'codetta') { kind = Annotation.CODA; value = '' } else {
				kind = Annotation.TEXT_ABOVE
				if (!value) value = subtype === 'fine' ? 'Fine' : subtype === 'tocoda' ? 'To Coda' : ''
				if (subtype === 'fine' || subtype === 'tocoda') tick = measure.tick + measure.ticks
			}
			break
		}
		case 'Jump':
			kind = Annotation.TEXT_ABOVE; tick = measure.tick + measure.ticks; break
		default:
			return
		}
		if (!value.trim() && kind !== Annotation.SEGNO && kind !== Annotation.CODA) return
		staffMeasure.annotations.push({ kind, tick, text: value.trim() })
	}

	readKey(element, context) {
		if (child(element, 'custom') && !child(element, 'concertKey') && !child(element, 'accidental')) return 0
		const concert = child(element, 'concertKey')
		let key
		if (concert) {
			const concertKey = intValue(concert, 0)
			const actual = child(element, 'actualKey')
			key = this.concertPitch ? concertKey : actual ? intValue(actual, concertKey) : concertKey + context.fifths
		} else {
			// Older files store the key as displayed for the transposing instrument.
			const written = intValue(child(element, 'accidental'), intValue(child(element, 'subtype'), 0))
			key = this.concertPitch ? written - transposeFifths(context.transposeChromatic, context.transposeDiatonic) : written
		}
		while (key > 7) key -= 12
		while (key < -7) key += 12
		return key
	}

	readClef(element) {
		const concert = text(element, 'concertClefType'), transposing = text(element, 'transposingClefType')
		const value = !this.concertPitch && transposing ? transposing : concert || text(element, 'subtype')
		return value ? clefName(value) : null
	}

	finish() {
		const score = this.score
		for (const measure of score.measures) while (measure.staves.length < score.staves.length) measure.staves.push(newStaffMeasure())
		score.staves.forEach((staff, i) => { staff.clef = this.contexts[i].defaultClef })
		const lastMeasure = score.measures[score.measures.length - 1]
		for (const entry of this.pending) {
			const spanner = entry.spanner
			const target = Math.max(0, Math.min(score.measures.length - 1, entry.startMeasure + entry.measures))
			const startMeasureTick = score.measures[Math.min(entry.startMeasure, score.measures.length - 1)].tick
			const targetTick = entry.startMeasure + entry.measures >= score.measures.length
				? lastMeasure.tick + lastMeasure.ticks
				: score.measures[target].tick
			spanner.endTick = targetTick + (spanner.startTick - startMeasureTick) + entry.fractionTicks
		}
		for (const spanner of score.spanners) {
			if (spanner.endTick < spanner.startTick) {
				spanner.endTick = spanner.kind === SpannerKind.VOLTA ? lastMeasure.tick + lastMeasure.ticks : Math.max(spanner.startTick, lastMeasure.tick + lastMeasure.ticks)
			}
			if (spanner.kind === SpannerKind.SLUR && !spanner.end) spanner.end = this.chordAt(spanner.staff, spanner.voice, spanner.endTick)
			if (spanner.kind === SpannerKind.SLUR && !spanner.start) spanner.start = this.chordAt(spanner.staff, spanner.voice, spanner.startTick)
		}
		score.spanners = score.spanners.filter(s => !(s.kind === SpannerKind.SLUR && (!s.start || !s.end || s.start === s.end)))
		this.linkTies()
		let number = 1
		score.measures.forEach((measure, i) => {
			const pickup = i === 0 && measure.ticks < this.fractionTicks(measure.timeN + '/' + measure.timeD)
			measure.number = number
			if (!measure.irregular && !pickup) number++
		})
		if (lastMeasure && lastMeasure.endBarline === null && lastMeasure.endRepeat === 0) lastMeasure.endBarline = 'end'
	}

	chordAt(staff, voice, tick) {
		let best = null
		for (const measure of this.score.measures) {
			if (measure.tick > tick) break
			for (const chordRest of measure.staves[staff].chordRests) {
				if (chordRest.rest || chordRest.tick > tick) continue
				if (chordRest.voice === voice && (best === null || chordRest.tick >= best.tick)) best = chordRest
			}
		}
		return best
	}

	linkTies() {
		const score = this.score
		for (let staff = 0; staff < score.staves.length; staff++) {
			for (let voice = 0; voice < 4; voice++) {
				const chords = []
				for (const measure of score.measures) {
					for (const chordRest of measure.staves[staff].chordRests) if (chordRest.voice === voice && !chordRest.rest) chords.push(chordRest)
				}
				chords.sort((a, b) => a.tick - b.tick)
				for (let i = 0; i + 1 < chords.length; i++) {
					for (const note of chords[i].notes) {
						let target = null
						for (const candidate of chords[i + 1].notes) if (candidate.pitch === note.pitch) target = candidate
						if (target && (note.tieStart || target.tieEnd)) { note.tieTo = target; target.tieEnd = true }
					}
				}
			}
		}
	}

	fractionTicks(fraction) {
		if (!fraction) return 0
		const slash = fraction.indexOf('/')
		const division = this.score.division
		if (slash < 0) {
			const whole = parseInt(fraction.trim(), 10)
			return isNaN(whole) ? 0 : whole * division * 4
		}
		const numerator = parseInt(fraction.substring(0, slash).trim(), 10)
		const denominator = parseInt(fraction.substring(slash + 1).trim(), 10)
		if (isNaN(numerator) || isNaN(denominator) || denominator === 0) return 0
		return Math.trunc(numerator * division * 4 / denominator)
	}
}

function applyLayoutBreaks(element, measure) {
	for (const layoutBreak of children(element, 'LayoutBreak')) {
		const type = text(layoutBreak, 'subtype')
		if (type === 'page') measure.pageBreak = true
		else if (type === 'line' || type === 'section') measure.lineBreak = true
	}
}

function readVoltaDetails(volta, spanner) {
	let label = text(volta, 'beginText')
	if (!label) label = text(volta, 'text')
	if (!label) {
		const endings = text(volta, 'endings')
		label = endings === '' ? '1.' : endings.replaceAll(' ', '').replaceAll(',', '.,') + '.'
	}
	spanner.text = label
	const hook = text(volta, 'endHookType')
	spanner.endHook = hook === '' ? text(volta, 'subtype') === '1' || text(volta, 'subtype') === '' : hook !== '0'
}

// ---- value conversion ---------------------------------------------------------------------------------------

function durationValue(type) {
	switch (type) {
	case 'long': case 'breve': return 0
	case 'whole': return 1
	case 'half': return 2
	case 'eighth': return 8
	case '16th': return 16
	case '32nd': return 32
	case '64th': return 64
	case '128th': return 128
	default: return 4
	}
}

/** Number of fifths the written key lies above the concert key for an instrument transposition. */
export function transposeFifths(chromatic, diatonic) {
	const up = floorMod(-chromatic, 12), steps = floorMod(-diatonic, 7)
	let best = 0, bestScore = Infinity
	for (let fifths = -12; fifths <= 12; fifths++) {
		if (floorMod(fifths * 7, 12) !== up) continue
		const score = Math.abs(fifths) + (floorMod(fifths * 4, 7) === steps ? 0 : 100)
		if (score < bestScore) { bestScore = score; best = fifths }
	}
	return best
}

const CLEFS = {
	0: 'G', 1: 'G8va', 2: 'G15ma', 3: 'G8vb', 4: 'F', 5: 'F8vb', 6: 'F15mb', 7: 'F3', 9: 'C1', 10: 'C2', 11: 'C3', 12: 'C4',
	14: 'PERC', 15: 'PERC', G3: 'G', G1: 'G', PERC2: 'PERC', TAB: 'PERC', TAB2: 'PERC', TAB4: 'PERC', TAB_SERIF: 'PERC', TAB4_SERIF: 'PERC',
}

function clefName(value) { return Object.hasOwn(CLEFS, value) ? CLEFS[value] : value }

function barlineType(subtype) {
	switch (subtype) {
	case 'double': case '2': return 'double'
	case 'end': case 'final': case '5': return 'end'
	case 'dashed': case '1': return 'dashed'
	case 'dotted': return 'dotted'
	case 'heavy': case 'double-heavy': return 'heavy'
	case 'reverse-end': return 'reverse-end'
	case 'end-repeat': return 'end-repeat'
	default: return null
	}
}

function articulationName(subtype) {
	const s = subtype.toLowerCase()
	if (s.includes('fermata')) return s.includes('below') ? 'fermataBelow' : 'fermataAbove'
	if (s.includes('staccatissimo')) return 'articStaccatissimo'
	if (s.includes('marcato') || s.includes('strongaccent')) return s.includes('staccato') ? 'articMarcatoStaccato' : 'articMarcato'
	if (s.includes('accent') || s.includes('sforzato')) return s.includes('staccato') ? 'articAccentStaccato' : 'articAccent'
	if (s.includes('tenuto') || s.includes('portato')) return s.includes('staccato') || s.includes('portato') ? 'articTenutoStaccato' : 'articTenuto'
	if (s.includes('staccato')) return 'articStaccato'
	if (s.includes('shorttrill') || s.includes('prall')) return 'ornamentShortTrill'
	if (s.includes('trill')) return 'ornamentTrill'
	if (s.includes('mordent')) return 'ornamentMordent'
	if (s.includes('turn')) return 'ornamentTurn'
	if (s.includes('muteclosed') || s.includes('plusstop')) return 'brassMuteClosed'
	if (s.includes('muteopen') || s === 'ouvert') return 'brassMuteOpen'
	return null
}

function accidentalName(subtype) {
	switch (subtype) {
	case 'sharp': case 'accidentalSharp': case '1': return 'accidentalSharp'
	case 'flat': case 'accidentalFlat': case '2': return 'accidentalFlat'
	case 'natural': case 'accidentalNatural': case '5': return 'accidentalNatural'
	case 'double sharp': case 'accidentalDoubleSharp': case '3': return 'accidentalDoubleSharp'
	case 'double flat': case 'accidentalDoubleFlat': case '4': return 'accidentalDoubleFlat'
	default: return null
	}
}

export function tpcName(tpc) {
	const letter = 'FCGDAEB'.charAt(floorMod(tpc - 13, 7))
	const alter = Math.floor((tpc - 13) / 7)
	return letter + (alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter))
}

// ---- XML helpers --------------------------------------------------------------------------------------------

const ELEMENT_NODE = 1, TEXT_NODE = 3, CDATA_SECTION_NODE = 4

function textContent(node) { return node ? node.textContent || '' : '' }

/** Text content with MuseScore's <sym> elements replaced by SMuFL characters. */
function richText(element) {
	let result = ''
	const append = node => {
		for (let c = node.firstChild; c; c = c.nextSibling) {
			if (c.nodeType === TEXT_NODE || c.nodeType === CDATA_SECTION_NODE) result += c.nodeValue
			else if (c.nodeType === ELEMENT_NODE) {
				if (c.tagName === 'sym') result += symbolForName(textContent(c).trim())
				else append(c)
			}
		}
	}
	append(element)
	return result.replaceAll(' ', ' ').trim()
}

function children(parent, tag) {
	const result = []
	if (!parent) return result
	for (let node = parent.firstChild; node; node = node.nextSibling) {
		if (node.nodeType === ELEMENT_NODE && (tag === undefined || node.tagName === tag)) result.push(node)
	}
	return result
}

function child(parent, tag) {
	if (!parent) return null
	for (let node = parent.firstChild; node; node = node.nextSibling) {
		if (node.nodeType === ELEMENT_NODE && node.tagName === tag) return node
	}
	return null
}

function descendants(parent, tag) { return Array.from(parent.getElementsByTagName(tag)) }

function text(parent, tag) { const element = child(parent, tag); return element ? textContent(element).trim() : '' }

function parseInteger(value, fallback) {
	if (value === null || value === undefined) return fallback
	const trimmed = String(value).trim()
	return /^[-+]?\d+$/.test(trimmed) ? parseInt(trimmed, 10) : fallback
}

function intValue(element, fallback) { return element ? parseInteger(textContent(element), fallback) : fallback }

function floatValue(element, fallback) {
	if (!element) return fallback
	const value = parseFloat(textContent(element).trim())
	return isNaN(value) ? fallback : value
}
