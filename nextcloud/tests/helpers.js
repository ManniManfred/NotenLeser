import { DOMParser } from '@xmldom/xmldom'

export const parseXml = text => new DOMParser().parseFromString(text, 'text/xml')

/** A painter that records drawing calls and measures text with a fixed average glyph width. */
export class RecordingPainter {
	constructor() { this.calls = [] }
	line(...args) { this.calls.push(['line', ...args]) }
	polygon(points) { this.calls.push(['polygon', points]) }
	curveBand(...args) { this.calls.push(['curveBand', ...args]) }
	glyph(glyph, x, y, scale) { this.calls.push(['glyph', glyph, x, y, scale]) }
	text(text, x, y, size, style, align) { this.calls.push(['text', text, x, y, size, style, align]) }
	textWidth(text, size) { return text ? text.length * size * 0.5 : 0 }
	frame(...args) { this.calls.push(['frame', ...args]) }
}
