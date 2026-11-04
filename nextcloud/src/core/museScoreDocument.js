import * as Glyphs from './glyphs.js'
import { readMuseScore } from './museScoreReader.js'
import { BOLD, CENTER, ITALIC, RIGHT, ScoreEngraver } from './scoreEngraver.js'

export const MUSIC_FONT = 'NotenLeserLeland'
const TEXT_FONT = 'Georgia, "Times New Roman", serif'

/**
 * MuseScore scores (.mscz/.mscx) engraved with the Leland music font onto canvases.
 * createCanvas(width, height) must return a canvas with a 2D context (HTMLCanvasElement or OffscreenCanvas).
 */
export class MuseScoreDocument {
	constructor(data, { parseXml, createCanvas }) {
		this.createCanvas = createCanvas
		this.score = readMuseScore(data, parseXml)
		if (this.score.measures.length === 0) throw new Error('Die MuseScore-Datei enthält keine Takte')
		const measureCanvas = createCanvas(1, 1)
		this.engraver = new ScoreEngraver(this.score, new CanvasPainter(measureCanvas.getContext('2d'), 1, false))
		this.kind = 'musescore'
	}

	get pageCount() { return this.engraver.pageCount() }

	pageAspect() { return this.engraver.pageHeight / this.engraver.pageWidth }

	async renderPage(page, width) {
		const height = Math.max(1, Math.round(width * this.pageAspect(page)))
		const canvas = this.createCanvas(width, height)
		const context = canvas.getContext('2d')
		context.fillStyle = '#fff'
		context.fillRect(0, 0, width, height)
		this.engraver.drawPage(new CanvasPainter(context, width / this.engraver.pageWidth, true), page)
		return canvas
	}

	systemRatios(page) { return this.engraver.systemRatios(page) }
	staffRatios(page) { return this.engraver.staffRatios(page) }
	cursorAt(tick) { return this.engraver.cursorAt(tick) }
	systemStartTick(page, system) { return this.engraver.systemStartTick(page, system) }
	measureAt(page, x, y) { return this.engraver.measureAt(page, x, y) }
	measureBoxes(page, first, last) { return this.engraver.measureBoxes(page, first, last) }
	close() {}
}

/** Draws in staff spaces scaled by k pixels per staff space. */
export class CanvasPainter {
	constructor(context, k, draw) {
		this.c = context; this.k = k; this.draw = draw
		this.widthCache = new Map()
	}

	line(x1, y1, x2, y2, width) {
		if (!this.draw) return
		const { c, k } = this
		c.strokeStyle = '#000'
		c.lineCap = 'butt'
		c.lineWidth = Math.max(1, width * k)
		c.beginPath(); c.moveTo(x1 * k, y1 * k); c.lineTo(x2 * k, y2 * k); c.stroke()
	}

	polygon(points) {
		if (!this.draw) return
		const { c, k } = this
		c.fillStyle = '#000'
		c.beginPath()
		c.moveTo(points[0] * k, points[1] * k)
		for (let i = 2; i + 1 < points.length; i += 2) c.lineTo(points[i] * k, points[i + 1] * k)
		c.closePath(); c.fill()
	}

	curveBand(x1, y1, ax, ay, bx, by, cx, cy, dx, dy, x2, y2) {
		if (!this.draw) return
		const { c, k } = this
		c.fillStyle = '#000'
		c.beginPath()
		c.moveTo(x1 * k, y1 * k)
		c.bezierCurveTo(ax * k, ay * k, bx * k, by * k, x2 * k, y2 * k)
		c.bezierCurveTo(dx * k, dy * k, cx * k, cy * k, x1 * k, y1 * k)
		c.closePath(); c.fill()
	}

	glyph(glyph, x, y, scale) {
		if (!this.draw || !glyph) return
		const { c, k } = this
		c.fillStyle = '#000'
		c.textAlign = 'left'
		c.textBaseline = 'alphabetic'
		c.font = `${4 * k * scale}px ${MUSIC_FONT}`
		c.fillText(glyph, x * k, y * k)
	}

	static font(size, style) {
		return `${(style & ITALIC) ? 'italic ' : ''}${(style & BOLD) ? 'bold ' : ''}${size}px ${TEXT_FONT}`
	}

	runWidth(run, size, style, symbol) {
		if (symbol) {
			let width = 0
			for (const ch of run) width += Glyphs.width(ch) * size / 4 + 0.1
			return width
		}
		const key = style + '|' + run
		let unit = this.widthCache.get(key)
		if (unit === undefined) {
			this.c.font = CanvasPainter.font(100, style)
			unit = this.c.measureText(run).width / 100
			this.widthCache.set(key, unit)
		}
		return unit * size
	}

	runs(value) {
		const result = []
		let start = 0
		const chars = [...value]
		while (start < chars.length) {
			const symbol = Glyphs.isMusic(chars[start])
			let end = start
			while (end < chars.length && Glyphs.isMusic(chars[end]) === symbol) end++
			result.push([chars.slice(start, end).join(''), symbol])
			start = end
		}
		return result
	}

	text(value, x, y, size, style, align) {
		if (!this.draw || !value) return
		const { c, k } = this
		const width = this.textWidth(value, size, style)
		let cursor = align === CENTER ? x - width / 2 : align === RIGHT ? x - width : x
		c.fillStyle = '#000'
		c.textAlign = 'left'
		c.textBaseline = 'alphabetic'
		// Text runs alternate between the text font and music symbols such as metronome notes.
		for (const [run, symbol] of this.runs(value)) {
			c.font = symbol ? `${size * k}px ${MUSIC_FONT}` : CanvasPainter.font(size * k, style)
			c.fillText(run, cursor * k, y * k)
			cursor += this.runWidth(run, size, style, symbol)
		}
	}

	textWidth(value, size, style) {
		if (!value) return 0
		let width = 0
		for (const [run, symbol] of this.runs(value)) width += this.runWidth(run, size, style, symbol)
		return width
	}

	frame(left, top, right, bottom, width) {
		if (!this.draw) return
		const { c, k } = this
		c.strokeStyle = '#000'
		c.lineWidth = Math.max(1, width * k)
		c.strokeRect(left * k, top * k, (right - left) * k, (bottom - top) * k)
	}
}
