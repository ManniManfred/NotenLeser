/**
 * PDF scores rendered with pdf.js. The pdf.js module is passed in, so this file has no bundler or DOM dependency
 * beyond the canvas factory.
 */
export class PdfDocument {
	static async open(pdfjs, data, createCanvas) {
		const task = pdfjs.getDocument({ data, isEvalSupported: false })
		const pdf = await task.promise
		// Page sizes are needed synchronously for the layout, so they are read up front.
		const aspects = await Promise.all(Array.from({ length: pdf.numPages }, async (_, i) => {
			const page = await pdf.getPage(i + 1)
			const viewport = page.getViewport({ scale: 1 })
			return viewport.height / viewport.width
		}))
		return new PdfDocument(task, pdf, aspects, createCanvas)
	}

	constructor(task, pdf, aspects, createCanvas) {
		this.task = task; this.pdf = pdf; this.aspects = aspects; this.createCanvas = createCanvas
		this.kind = 'pdf'
	}

	get pageCount() { return this.aspects.length }

	pageAspect(page) { return this.aspects[page] }

	async renderPage(pageIndex, width) {
		const page = await this.pdf.getPage(pageIndex + 1)
		const base = page.getViewport({ scale: 1 })
		const viewport = page.getViewport({ scale: width / base.width })
		const height = Math.max(1, Math.round(width * this.aspects[pageIndex]))
		const canvas = this.createCanvas(width, height)
		const context = canvas.getContext('2d', { willReadFrequently: true })
		context.fillStyle = '#fff'
		context.fillRect(0, 0, width, height)
		await page.render({ canvas, canvasContext: context, viewport, background: '#fff' }).promise
		page.cleanup()
		return canvas
	}

	systemRatios() { return null }
	staffRatios() { return null }
	close() { this.task.destroy() }
}
