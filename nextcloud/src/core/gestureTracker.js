/**
 * Recognises a hand swiped sideways in front of the front camera.
 * Each frame is reduced to a coarse brightness grid; while cells keep changing, the centroid of the
 * change is tracked, and a mostly horizontal travel across the picture counts as a swipe. With the
 * fine sensitivity a small finger movement close to the camera is enough.
 *
 * Frames are passed in as grids that already match the screen as the player sees it (mirrored).
 */
export const GRID_W = 32, GRID_H = 24
/** Brightness change of a grid cell (0–255) that counts as motion. */
export const CELL_THRESHOLD = 14
/** Above this share of changing cells the whole picture changed (light, shaking) rather than a hand. */
const MAX_MOVING = 0.75
const MAX_SWIPE_MS = 1200, COOLDOWN_MS = 900
const MIN_ACTIVE_FRAMES = 3, QUIET_FRAMES_TO_END = 3

export const SENSITIVITY_FINE = 0, SENSITIVITY_MEDIUM = 1, SENSITIVITY_COARSE = 2

export class GestureTracker {
	constructor() {
		this.previous = null
		this.tracking = false
		this.startX = 0; this.startY = 0; this.lastX = 0; this.lastY = 0
		this.startTime = 0; this.cooldownUntil = 0
		this.activeFrames = 0; this.quietFrames = 0
		this.setSensitivity(SENSITIVITY_FINE)
	}

	setSensitivity(sensitivity) {
		// Share of changing cells needed for motion and horizontal travel (share of the width) for a swipe.
		if (sensitivity === SENSITIVITY_COARSE) { this.minMoving = 0.03; this.minTravel = 0.35 } else if (sensitivity === SENSITIVITY_MEDIUM) { this.minMoving = 0.02; this.minTravel = 0.25 } else { this.minMoving = 0.01; this.minTravel = 0.15 }
	}

	reset() { this.previous = null; this.tracking = false }

	/**
	 * Analyses one luma grid (GRID_W * GRID_H values, 0–255). Returns a debug frame with `swipe`:
	 * 1 when the hand moved to the player's left (next system), -1 to the right, 0 otherwise.
	 */
	analyse(luma, now) {
		let frameSum = 0
		for (let i = 0; i < luma.length; i++) frameSum += luma[i]
		// Comparing cells against the frame mean ignores exposure changes that brighten everything at once.
		const mean = frameSum / luma.length
		const current = new Float32Array(luma.length)
		for (let i = 0; i < luma.length; i++) current[i] = luma[i] - mean
		const previous = this.previous
		this.previous = current
		const change = new Float32Array(luma.length)
		if (!previous) return this.frame(luma, change, 0, NaN, NaN, 0)
		let moving = 0, weight = 0, sumX = 0, sumY = 0
		for (let gy = 0; gy < GRID_H; gy++) {
			for (let gx = 0; gx < GRID_W; gx++) {
				const i = gy * GRID_W + gx
				const c = Math.abs(current[i] - previous[i])
				change[i] = c
				if (c < CELL_THRESHOLD) continue
				moving++; weight += c
				sumX += c * (gx + 0.5) / GRID_W; sumY += c * (gy + 0.5) / GRID_H
			}
		}
		const share = moving / (GRID_W * GRID_H)
		const x = moving === 0 ? NaN : sumX / weight, y = moving === 0 ? NaN : sumY / weight
		const swipe = this.track(share, x, y, now)
		return this.frame(luma, change, share, x, y, swipe)
	}

	track(share, x, y, now) {
		if (now < this.cooldownUntil) { this.tracking = false; return 0 }
		if (share < this.minMoving || share > MAX_MOVING) {
			if (this.tracking && ++this.quietFrames >= QUIET_FRAMES_TO_END) this.tracking = false
			return 0
		}
		if (!this.tracking || now - this.startTime > MAX_SWIPE_MS) {
			this.tracking = true; this.startX = x; this.startY = y; this.startTime = now; this.activeFrames = 0
		}
		this.lastX = x; this.lastY = y; this.activeFrames++; this.quietFrames = 0
		if (this.activeFrames < MIN_ACTIVE_FRAMES) return 0
		const dx = this.lastX - this.startX, dy = this.lastY - this.startY
		if (Math.abs(dx) < this.minTravel || Math.abs(dx) <= Math.abs(dy) * 1.5) return 0
		this.tracking = false
		this.cooldownUntil = now + COOLDOWN_MS
		this.lastSwipe = dx < 0 ? 1 : -1
		return this.lastSwipe
	}

	frame(luma, change, share, x, y, swipe) {
		const active = this.tracking || swipe !== 0
		return {
			width: GRID_W, height: GRID_H, luma, change, share, minMoving: this.minMoving, tracking: this.tracking,
			startX: active ? this.startX : NaN, startY: active ? this.startY : NaN, x, y,
			travel: active ? this.lastX - this.startX : 0, minTravel: this.minTravel, swipe,
		}
	}
}
