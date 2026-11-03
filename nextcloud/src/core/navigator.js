/**
 * Knows the systems of every page and moves through them: system by system, by whole screens or page by page.
 * All positions are ratios of the page height, so nothing depends on the rendering resolution.
 * Heights for fitting systems on screen are measured in screen pixels at the current view width.
 */
const FALLBACK_SYSTEMS = 4

export class ScoreNavigator {
	/**
	 * @param doc        score document (pageCount, pageAspect, systemRatios, staffRatios)
	 * @param detectPage async page => {systems: [t0, b0, ...], staves: [t0, b0, ...]} for pages without known systems
	 * @param manual     Map page => [t0, b0, ...] of manually marked systems
	 */
	constructor(doc, detectPage, manual = new Map()) {
		this.doc = doc
		this.detectPage = detectPage
		this.manual = manual
		this.detected = new Map() // page => {systems, staves}
		this.pending = new Map()
		this.page = 0
		this.system = 0
		this.autoDetection = true
		this.twoSystemsMinimum = false
		this.viewWidth = 1000
		this.viewHeight = 1000
		this.gap = 7
		this.visible = []
	}

	setViewport(width, height, gap) { this.viewWidth = Math.max(1, width); this.viewHeight = Math.max(1, height); this.gap = gap }

	pageHeight(page) { return this.viewWidth * this.doc.pageAspect(page) }

	async analysis(page) {
		if (this.detected.has(page)) return this.detected.get(page)
		if (!this.pending.has(page)) {
			const known = this.doc.systemRatios(page)
			const promise = known
				? Promise.resolve({ systems: known, staves: this.doc.staffRatios(page) || [] })
				: this.detectPage(page).catch(() => ({ systems: [], staves: [] }))
			this.pending.set(page, promise.then(result => { this.detected.set(page, result); this.pending.delete(page); return result }))
		}
		return this.pending.get(page)
	}

	/** System bounds of a page as [t0, b0, ...]; manual marks win over detection. */
	async systemsOf(page) {
		if (this.manual.has(page)) return this.manual.get(page)
		return (await this.analysis(page)).systems
	}

	async stavesOf(page) { return (await this.analysis(page)).staves }

	/** Cached system count without detection, or null when the page has not been analysed yet. */
	knownSystemCount(page) {
		if (this.manual.has(page)) return this.manual.get(page).length / 2
		const result = this.detected.get(page)
		return result ? result.systems.length / 2 : null
	}

	async systemCount(page) {
		const count = (await this.systemsOf(page)).length / 2
		return this.autoDetection && count > 0 ? count : FALLBACK_SYSTEMS
	}

	async systemRef(page, index) {
		const systems = await this.systemsOf(page)
		const detected = systems.length / 2
		const useDetection = this.autoDetection && detected > 0
		const count = useDetection ? detected : FALLBACK_SYSTEMS
		if (index < 0 || index >= count) return null
		const top = useDetection ? systems[index * 2] : index / count
		const bottom = useDetection ? systems[index * 2 + 1] : (index + 1) / count
		return { page, index, top, bottom, height: (bottom - top) * this.pageHeight(page) }
	}

	/** Next page in the direction that has systems, or -1. */
	async findScorePage(start, direction) {
		for (let i = start; i >= 0 && i < this.doc.pageCount; i += direction) {
			if ((await this.systemsOf(i)).length > 0) return i
		}
		return -1
	}

	async adjacentSystem(source, direction) {
		const count = await this.systemCount(source.page)
		const target = source.index + direction
		if (target >= 0 && target < count) return this.systemRef(source.page, target)
		const targetPage = this.autoDetection ? await this.findScorePage(source.page + direction, direction) : source.page + direction
		if (targetPage < 0 || targetPage >= this.doc.pageCount) return null
		const targetSystems = await this.systemsOf(targetPage)
		if (this.autoDetection && targetSystems.length === 0) return null
		return this.systemRef(targetPage, direction > 0 ? 0 : (await this.systemCount(targetPage)) - 1)
	}

	/** Whether another system joins the screen; with the two-system minimum the second one always does. */
	fits(usedHeight, candidate, shownCount) {
		return usedHeight + this.gap + candidate.height <= this.viewHeight || (this.twoSystemsMinimum && shownCount < 2)
	}

	/**
	 * Systems to show for the current position. The current system is anchored at the top so a whole-screen swipe
	 * continues exactly after the last system shown; earlier systems only fill the end of the score.
	 */
	async computeVisible() {
		if (!this.autoDetection) { this.visible = []; return [] }
		if ((await this.systemsOf(this.page)).length === 0 && this.page + 1 < this.doc.pageCount) {
			const next = await this.findScorePage(this.page + 1, 1)
			if (next >= 0) { this.page = next; this.system = 0 }
		}
		const count = await this.systemCount(this.page)
		this.system = Math.max(0, Math.min(this.system, count - 1))
		const current = await this.systemRef(this.page, this.system)
		if (!current) { this.visible = []; return [] }
		const before = [], after = []
		let used = current.height, previousCursor = current, nextCursor = current
		let canLookBack = true, canLookForward = true
		for (;;) {
			let added = false
			if (canLookBack && !canLookForward) {
				const candidate = await this.adjacentSystem(previousCursor, -1)
				if (candidate === null) canLookBack = false
				else if (this.fits(used, candidate, before.length + after.length + 1)) {
					before.push(candidate); previousCursor = candidate; used += this.gap + candidate.height; added = true
				} else canLookBack = false
			}
			if (canLookForward) {
				const candidate = await this.adjacentSystem(nextCursor, 1)
				if (candidate === null) canLookForward = false
				else if (this.fits(used, candidate, before.length + after.length + 1)) {
					after.push(candidate); nextCursor = candidate; used += this.gap + candidate.height; added = true
				} else canLookForward = false
			}
			if (!added && !canLookBack) break
		}
		this.visible = [...before.reverse(), current, ...after]
		return this.visible
	}

	/** The shown systems if they still belong to the current position, otherwise null. */
	currentVisible() {
		if (!this.autoDetection || this.visible.length === 0) return null
		return this.visible.some(s => s.page === this.page && s.index === this.system) ? this.visible : null
	}

	/** Finds the earliest system of a screen that ends with the given system. */
	async screenStartingBefore(last) {
		let used = last.height, shown = 1, first = last
		for (;;) {
			const candidate = await this.adjacentSystem(first, -1)
			if (candidate === null || !this.fits(used, candidate, shown)) return first
			used += this.gap + candidate.height; shown++
			first = candidate
		}
	}

	/**
	 * Advances by one system, or past all visible systems when wholeScreen is set.
	 * Returns 'moved' or 'end' (nothing left in this score).
	 */
	async next(wholeScreen = false) {
		const shown = wholeScreen ? this.currentVisible() : null
		let nextPage
		if (shown) {
			const next = await this.adjacentSystem(shown[shown.length - 1], 1)
			if (next) { this.page = next.page; this.system = next.index; return 'moved' }
			nextPage = -1
		} else {
			if (this.autoDetection && this.system + 1 < await this.systemCount(this.page)) { this.system++; return 'moved' }
			nextPage = this.autoDetection ? await this.findScorePage(this.page + 1, 1) : (this.page + 1 < this.doc.pageCount ? this.page + 1 : -1)
		}
		if (nextPage < 0) return 'end'
		this.page = nextPage; this.system = 0
		return 'moved'
	}

	/** Goes back by one system or one screen. Returns 'moved' or 'start'. */
	async previous(wholeScreen = false) {
		const shown = wholeScreen ? this.currentVisible() : null
		let previousPage
		if (shown) {
			const previous = await this.adjacentSystem(shown[0], -1)
			if (previous) {
				const first = await this.screenStartingBefore(previous)
				this.page = first.page; this.system = first.index
				return 'moved'
			}
			previousPage = -1
		} else {
			if (this.autoDetection && this.system > 0) { this.system--; return 'moved' }
			previousPage = this.autoDetection ? await this.findScorePage(this.page - 1, -1) : this.page - 1
		}
		if (previousPage < 0) return 'start'
		this.page = previousPage
		this.system = this.autoDetection ? Math.max(0, (await this.systemCount(previousPage)) - 1) : 0
		return 'moved'
	}

	/** Moves to the last page with systems, used when coming back from the following file. */
	async goToEnd() {
		this.page = this.doc.pageCount - 1
		this.system = 0
		if (this.autoDetection) {
			const last = await this.findScorePage(this.page, -1)
			if (last >= 0) this.page = last
			this.system = Math.max(0, (await this.systemCount(this.page)) - 1)
		}
	}

	/** Staff bounds {top, bottom} (ratios) of the player's voice within a system, or null if nothing is highlighted. */
	async voiceStaff(page, systemTop, systemBottom, voice) {
		if (voice <= 0) return null
		const staves = await this.stavesOf(page)
		const inSystem = []
		for (let i = 0; i + 1 < staves.length; i += 2) {
			const center = (staves[i] + staves[i + 1]) / 2
			if (center >= systemTop && center < systemBottom) inSystem.push({ top: staves[i], bottom: staves[i + 1] })
		}
		// A single staff is already the player's own part; highlighting it would add nothing.
		if (inSystem.length < 2 || voice > inSystem.length) return null
		return inSystem[voice - 1]
	}
}
