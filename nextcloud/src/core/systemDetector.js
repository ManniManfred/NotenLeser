/**
 * Finds five-line staves on a rendered score page and groups them into systems.
 *
 * Staff lines are searched locally in narrow vertical strips, so indented, shortened or slightly skewed staves are
 * found as well. Adjacent staves belong to the same system when they are joined on the left (system barline, bracket
 * or brace) or by a barline through the gap. Works on plain RGBA pixel arrays without any DOM dependency.
 */
const DARK_LUMINANCE = 200
const idiv = (a, b) => Math.trunc(a / b)

/** A staff follows its strip detections piecewise linearly, so slightly curved scans are tracked too. */
class Staff {
	constructor(xs, tops, height) {
		this.xs = xs; this.tops = tops; this.height = height; this.strips = xs.length
		this.left = 0; this.right = 0; this.bars = []
	}

	/** Adds the traced line ends, given with their drift from the outermost strip detections. */
	extend(left, leftDrift, right, rightDrift) {
		this.left = left; this.right = right
		const n = this.xs.length
		this.xs = [Math.min(left, this.xs[0] - 1), ...this.xs, Math.max(right, this.xs[n - 1] + 1)]
		this.tops = [this.tops[0] + leftDrift, ...this.tops, this.tops[n - 1] + rightDrift]
	}

	topAt(x) {
		const xs = this.xs, tops = this.tops, n = xs.length
		if (n === 1 || x <= xs[0]) return tops[0]
		if (x >= xs[n - 1]) return tops[n - 1]
		let i = 1
		while (xs[i] < x) i++
		const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
		return tops[i - 1] + t * (tops[i] - tops[i - 1])
	}

	bottomAt(x) { return this.topAt(x) + this.height }
	spacing() { return this.height / 4 }
	minTop() { return Math.round(Math.min(...this.tops)) }
	maxBottom() { return Math.round(Math.max(0, ...this.tops) + this.height) }
}

class Detector {
	constructor(rgba, width, height) {
		this.width = width; this.height = height
		const dark = new Uint8Array(width * height)
		for (let i = 0, p = 0; i < dark.length; i++, p += 4) {
			const luminance = idiv(rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114, 1000)
			dark[i] = luminance < DARK_LUMINANCE ? 1 : 0
		}
		this.dark = dark
	}

	isDark(x, y) { return x >= 0 && x < this.width && y >= 0 && y < this.height && this.dark[y * this.width + x] === 1 }

	run() {
		const spacing = this.estimateSpacing()
		if (spacing <= 0) return empty()
		const staffs = this.findStaffs(spacing)
		if (staffs.length === 0) return empty()
		for (let i = 0; i < staffs.length; i++) this.findBarlines(staffs[i], staffs[i - 1] || null, staffs[i + 1] || null)
		const groups = []
		let first = 0
		for (let i = 1; i < staffs.length; i++) {
			if (!this.sameSystem(staffs[i - 1], staffs[i])) { groups.push([first, i - 1]); first = i }
		}
		groups.push([first, staffs.length - 1])
		return this.systemExtents(staffs, groups, spacing)
	}

	/** Most common distance between neighbouring thin horizontal strokes, i.e. the staff line spacing. */
	estimateSpacing() {
		const { width, height, dark } = this
		const maxThickness = Math.max(3, idiv(width, 300))
		const maxDistance = Math.max(8, idiv(height, 25))
		const histogram = new Int32Array(maxDistance + 2)
		let samples = 0
		const step = Math.max(1, idiv(width, 300))
		for (let x = idiv(width, 10); x < idiv(width * 9, 10); x += step) {
			let previousCenter = -1, runStart = -1
			for (let y = 0; y <= height; y++) {
				const d = y < height && dark[y * width + x] === 1
				if (d && runStart < 0) runStart = y
				else if (!d && runStart >= 0) {
					const thickness = y - runStart
					const center = (runStart + y - 1) / 2
					if (thickness <= maxThickness) {
						if (previousCenter >= 0) {
							const distance = Math.round(center - previousCenter)
							if (distance >= 3 && distance <= maxDistance) { histogram[distance]++; samples++ }
						}
						previousCenter = center
					} else previousCenter = -1
					runStart = -1
				}
			}
		}
		if (samples < 50) return 0
		let best = 0, bestScore = -1
		for (let d = 3; d <= maxDistance; d++) {
			const score = histogram[d - 1] + 2 * histogram[d] + histogram[d + 1]
			if (score > bestScore) { bestScore = score; best = d }
		}
		const weighted = histogram[best - 1] * (best - 1) + histogram[best] * best + histogram[best + 1] * (best + 1)
		const count = histogram[best - 1] + histogram[best] + histogram[best + 1]
		return count === 0 ? 0 : weighted / count
	}

	findStaffs(spacing) {
		const { width, height, dark } = this
		const stripWidth = Math.max(12, Math.round(spacing * 5))
		const strips = idiv(width, stripWidth)
		const detections = [] // [strip, top, bottom]
		const maxLineThickness = Math.max(Math.max(3, idiv(width, 300)) + 1, Math.round(spacing * 0.45))
		const lineThickness = Math.max(1, spacing * 0.15)
		const coverage = new Int32Array(height)
		for (let k = 0; k < strips; k++) {
			const x0 = k * stripWidth, x1 = x0 + stripWidth
			for (let y = 0; y < height; y++) {
				let count = 0
				const row = y * width, nextRow = y + 1 < height ? row + width : row
				for (let x = x0; x < x1; x++) if (dark[row + x] || dark[nextRow + x]) count++
				coverage[y] = count
			}
			const lines = []
			const threshold = Math.round(stripWidth * 0.8)
			let runStart = -1
			for (let y = 0; y <= height; y++) {
				const hit = y < height && coverage[y] >= threshold
				if (hit && runStart < 0) runStart = y
				else if (!hit && runStart >= 0) {
					// a hit at y covers rows y and y+1, so the stroke ends one row later
					const thickness = y - runStart
					if (thickness <= maxLineThickness) lines.push((runStart + y) / 2)
					else if (thickness <= spacing * 1.5) {
						// A beam merged with a staff line: the line is at one of the stroke's edges.
						lines.push(runStart + lineThickness / 2)
						lines.push(y - lineThickness / 2)
					}
					runStart = -1
				}
			}
			for (let i = 0; i < lines.length; i++) {
				// Pick the fifth line so that the inner lines fit the averaged spacing best.
				const a = lines[i]
				let bestEnd = -1, bestInner = 2, bestError = Infinity
				for (let e = i + 1; e < lines.length && lines[e] - a <= spacing * 4 * 1.3; e++) {
					const d = (lines[e] - a) / 4
					if (d < spacing * 0.75) continue
					const tolerance = Math.max(1.5, d * 0.2)
					let inner = 0
					for (let line = 1; line <= 3; line++) if (nearest(lines, a + line * d, tolerance) >= 0) inner++
					const error = Math.abs(d - spacing)
					if (inner > bestInner || (inner === bestInner && error < bestError)) { bestEnd = e; bestInner = inner; bestError = error }
				}
				if (bestEnd >= 0) {
					detections.push([k, a, lines[bestEnd]])
					i = bestEnd
				}
			}
		}

		// Chain detections of neighbouring strips into staves.
		const chains = []
		for (const detection of detections) {
			let best = null, bestDistance = Infinity
			for (const chain of chains) {
				const last = chain[chain.length - 1]
				const gap = detection[0] - last[0]
				if (gap < 1) continue
				// Staves are far apart, so a staff may be continued after dense passages; allow ~1° of skew.
				const distance = Math.abs(detection[1] - last[1])
				if (distance <= spacing * 0.8 + gap * stripWidth * 0.02 && distance < bestDistance) { best = chain; bestDistance = distance }
			}
			if (best === null) { best = []; chains.push(best) }
			best.push(detection)
		}

		const minStrips = Math.max(3, Math.round(strips * 0.15))
		let staffs = []
		for (const chain of chains) {
			if (chain.length < minStrips) continue
			const n = chain.length
			const xs = [], tops = [], heights = []
			for (let i = 0; i < n; i++) {
				xs.push((chain[i][0] + 0.5) * stripWidth)
				heights.push(chain[i][2] - chain[i][1])
			}
			// A median of three neighbours suppresses single strips matched one line off.
			for (let i = 0; i < n; i++) {
				const a = chain[Math.max(0, i - 1)][1], b = chain[i][1], c = chain[Math.min(n - 1, i + 1)][1]
				tops.push(Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)))
			}
			heights.sort((p, q) => p - q)
			const staff = new Staff(xs, tops, heights[idiv(n, 2)])
			const start = this.traceLineEnd(staff, Math.round(chain[0][0] * stripWidth), -1)
			const end = this.traceLineEnd(staff, Math.round((chain[n - 1][0] + 1) * stripWidth) - 1, 1)
			staff.extend(start[0], start[1], end[0], end[1])
			staffs.push(staff)
		}
		staffs.sort((a, b) => a.topAt(width / 2) - b.topAt(width / 2))
		// Ledger lines or beams next to a staff can yield a shifted phantom staff; keep the better supported one.
		for (let i = 1; i < staffs.length; i++) {
			const upper = staffs[i - 1], lower = staffs[i]
			const x = (Math.max(upper.left, lower.left) + Math.min(upper.right, lower.right)) / 2
			if (lower.topAt(x) < upper.bottomAt(x) + spacing * 0.5) {
				staffs.splice(upper.strips >= lower.strips ? i : i - 1, 1)
				i--
			}
		}
		return staffs
	}

	/**
	 * Follows the staff lines from x in the given direction until fewer than three of the five lines continue,
	 * adjusting to lines that drift up or down. Returns the last x and the vertical drift there.
	 */
	traceLineEnd(staff, x, direction) {
		let last = x, lastDrift = 0, drift = 0, misses = 0
		const maxMisses = Math.max(2, Math.round(staff.spacing() * 0.3))
		for (let cx = x; cx >= 0 && cx < this.width; cx += direction) {
			let bestCount = -1, bestDrift = drift
			const top = staff.topAt(cx), sp = staff.spacing()
			for (const candidate of [drift, drift - 1, drift + 1]) {
				let count = 0
				for (let line = 0; line < 5; line++) {
					const y = Math.round(top + line * sp) + candidate
					if (this.isDark(cx, y) || this.isDark(cx, y + 1)) count++
				}
				if (count > bestCount) { bestCount = count; bestDrift = candidate }
			}
			if (bestCount >= 3) { last = cx; drift = lastDrift = bestDrift; misses = 0 } else if (++misses > maxMisses) break
		}
		return [last, lastDrift]
	}

	/**
	 * Barlines cross the whole staff and stop at its outer lines unless they continue to a neighbouring staff.
	 * The end check keeps stems of beamed notes, which also cross the staff, out of the list.
	 */
	findBarlines(staff, above, below) {
		const bars = []
		let runStart = -1
		const spacing = staff.spacing(), maxBarWidth = Math.max(3, spacing * 0.8)
		for (let x = staff.left; x <= staff.right + 1; x++) {
			const full = x <= staff.right && this.columnFilled(x, Math.round(staff.topAt(x) + spacing * 0.2),
				Math.round(staff.bottomAt(x) - spacing * 0.2), 0.92)
			if (full && runStart < 0) runStart = x
			else if (!full && runStart >= 0) {
				const bar = idiv(runStart + x - 1, 2), limit = Math.round(maxBarWidth) + 2
				// Beams lying on an outer line make stems look like barlines; they are wide near the edge.
				const thin = x - runStart <= maxBarWidth
					&& this.narrowAt(bar, Math.round(staff.topAt(bar) + spacing * 0.35), limit)
					&& this.narrowAt(bar, Math.round(staff.topAt(bar) - spacing * 0.45), limit)
					&& this.narrowAt(bar, Math.round(staff.bottomAt(bar) - spacing * 0.35), limit)
					&& this.narrowAt(bar, Math.round(staff.bottomAt(bar) + spacing * 0.45), limit)
				if (thin && this.barEndOk(staff, above, bar, true) && this.barEndOk(staff, below, bar, false)) bars.push(bar)
				runStart = -1
			}
		}
		staff.bars = bars
	}

	barEndOk(staff, neighbour, x, upwards) {
		const spacing = staff.spacing()
		const edge = Math.round(upwards ? staff.topAt(x) : staff.bottomAt(x))
		const near = Math.round(spacing * 0.25), far = Math.round(spacing * 0.8)
		const from = upwards ? edge - far : edge + near, to = upwards ? edge - near : edge + far
		if (!this.lineFilled(x, from, to, 0.5)) return true
		if (neighbour === null) return false
		const neighbourEdge = Math.round(upwards ? neighbour.bottomAt(x) : neighbour.topAt(x))
		return this.lineFilled(x, Math.min(edge, neighbourEdge), Math.max(edge, neighbourEdge), 0.9)
	}

	/** True when row y has no ink at x or only a horizontal run of at most maxWidth pixels through x. */
	narrowAt(x, y, maxWidth) {
		let start = -1
		for (let cx = x - 1; cx <= x + 1; cx++) if (this.isDark(cx, y)) { start = cx; break }
		if (start < 0) return true
		let left = start, right = start
		while (left - 1 >= 0 && this.isDark(left - 1, y) && right - left < maxWidth) left--
		while (right + 1 < this.width && this.isDark(right + 1, y) && right - left < maxWidth) right++
		return right - left < maxWidth
	}

	/** Like columnFilled, but tolerant to the exact position of a thin vertical line centred at x. */
	lineFilled(x, fromY, toY, minFraction) {
		if (toY < fromY) return false
		let filled = 0
		for (let y = fromY; y <= toY; y++) if (this.isDark(x - 1, y) || this.isDark(x, y) || this.isDark(x + 1, y)) filled++
		return filled >= (toY - fromY + 1) * minFraction
	}

	columnFilled(x, fromY, toY, minFraction) {
		if (toY < fromY) return false
		let filled = 0
		for (let y = fromY; y <= toY; y++) if (this.isDark(x, y) || this.isDark(x + 1, y)) filled++
		return filled >= (toY - fromY + 1) * minFraction
	}

	/** Staves of one system are joined by a barline through the gap or by the system barline/bracket at the left. */
	sameSystem(upper, lower) {
		const spacing = Math.max(upper.spacing(), lower.spacing())
		const tolerance = Math.max(3, spacing * 0.5)
		for (const a of upper.bars) {
			for (const b of lower.bars) {
				if (Math.abs(a - b) > tolerance) continue
				const x = idiv(a + b, 2)
				if (this.lineFilled(x, Math.round(upper.bottomAt(x)), Math.round(lower.topAt(x)), 0.95)) return true
			}
		}
		return this.connectedAtStart(upper, lower, spacing)
	}

	/** True when every row between the staves has ink close to their left edge (system barline, bracket or brace). */
	connectedAtStart(upper, lower, spacing) {
		const edge = Math.min(upper.left, lower.left)
		const from = Math.max(0, Math.round(edge - spacing * 3))
		const to = Math.min(this.width - 1, Math.round(Math.max(upper.left, lower.left) + spacing))
		const top = Math.round(upper.bottomAt(edge)), bottom = Math.round(lower.topAt(edge))
		if (bottom <= top) return true
		let filled = 0
		for (let y = top; y <= bottom; y++) {
			for (let x = from; x <= to; x++) if (this.isDark(x, y)) { filled++; break }
		}
		return filled >= (bottom - top + 1) * 0.95
	}

	systemExtents(staffs, groups, spacing) {
		const { width, height, dark } = this
		let contentLeft = width, contentRight = 0
		for (const staff of staffs) { contentLeft = Math.min(contentLeft, staff.left); contentRight = Math.max(contentRight, staff.right) }
		contentLeft = Math.max(0, Math.round(contentLeft - spacing * 3))
		contentRight = Math.min(width - 1, Math.round(contentRight + spacing))
		const ink = new Int32Array(height)
		for (let y = 0; y < height; y++) {
			let count = 0
			const row = y * width
			for (let x = contentLeft; x <= contentRight; x++) if (dark[row + x]) count++
			ink[y] = count
		}
		const noise = Math.max(1, idiv(width, 600))
		const systems = groups.length
		const staffTop = [], staffBottom = [], staffCount = []
		for (const [first, last] of groups) {
			staffTop.push(staffs[first].minTop())
			staffBottom.push(staffs[last].maxBottom())
			staffCount.push(last - first + 1)
		}
		// Between two systems the dividing row lies in the longest blank run.
		const dividers = new Array(systems + 1)
		const pageMargin = Math.round(spacing * 7)
		dividers[0] = Math.max(0, staffTop[0] - pageMargin)
		dividers[systems] = Math.min(height - 1, staffBottom[systems - 1] + pageMargin)
		for (let i = 1; i < systems; i++) dividers[i] = blankDivider(ink, staffBottom[i - 1], staffTop[i], noise)

		const minBlank = Math.round(spacing * 2), margin = Math.max(2, Math.round(spacing * 0.4))
		const top = [], bottom = []
		for (let i = 0; i < systems; i++) {
			let lastInk = staffTop[i]
			for (let y = staffTop[i] - 1; y > dividers[i]; y--) {
				if (ink[y] > noise) lastInk = y
				else if (lastInk - y >= minBlank) break
			}
			top.push(Math.max(dividers[i], lastInk - margin))
			lastInk = staffBottom[i]
			for (let y = staffBottom[i] + 1; y < dividers[i + 1]; y++) {
				if (ink[y] > noise) lastInk = y
				else if (y - lastInk >= minBlank) break
			}
			bottom.push(Math.min(dividers[i + 1], lastInk + margin))
		}
		return {
			top, bottom, staffCount,
			staffTop: staffs.map(s => s.minTop()),
			staffBottom: staffs.map(s => s.maxBottom()),
		}
	}
}

function empty() { return { top: [], bottom: [], staffCount: [], staffTop: [], staffBottom: [] } }

function nearest(lines, target, tolerance) {
	let best = -1, bestDistance = tolerance
	for (let i = 0; i < lines.length; i++) {
		const distance = Math.abs(lines[i] - target)
		if (distance <= bestDistance) { bestDistance = distance; best = i }
	}
	return best
}

function blankDivider(ink, from, to, noise) {
	let bestStart = -1, bestLength = 0, runStart = -1, minRow = idiv(from + to, 2)
	for (let y = from + 1; y <= to; y++) {
		const blank = y < to && ink[y] <= noise
		if (blank && runStart < 0) runStart = y
		else if (!blank && runStart >= 0) {
			if (y - runStart > bestLength) { bestLength = y - runStart; bestStart = runStart }
			runStart = -1
		}
		if (y < to && ink[y] < ink[minRow]) minRow = y
	}
	return bestStart >= 0 ? bestStart + idiv(bestLength, 2) : minRow
}

/**
 * Detects the systems on a page given as RGBA pixels (e.g. ImageData.data).
 * Returns pixel rows {top[], bottom[], staffCount[], staffTop[], staffBottom[]}.
 */
export function detectSystems(rgba, width, height) {
	return new Detector(rgba, width, height).run()
}
