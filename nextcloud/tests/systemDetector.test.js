import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectSystems } from '../src/core/systemDetector.js'

/** Draws a page with systems of staves; staves of one system are joined by a line at the left. */
function page(width, height, systems, { spacing = 10, left = 100, right = width - 80 } = {}) {
	const rgba = new Uint8ClampedArray(width * height * 4).fill(255)
	const ink = (x, y) => { if (x >= 0 && x < width && y >= 0 && y < height) { const p = (y * width + x) * 4; rgba[p] = rgba[p + 1] = rgba[p + 2] = 0 } }
	const staffTops = []
	for (const system of systems) {
		for (const top of system) {
			staffTops.push(top)
			for (let line = 0; line < 5; line++) for (let x = left; x <= right; x++) { ink(x, top + line * spacing); ink(x, top + line * spacing + 1) }
			// Barlines and some notes.
			for (const bx of [left + 300, left + 600, right]) for (let y = top; y <= top + 4 * spacing + 1; y++) { ink(bx, y); ink(bx + 1, y) }
			for (let n = 0; n < 12; n++) {
				const cx = left + 60 + n * 45, cy = top + (n % 5) * spacing / 2 + spacing
				for (let dy = -4; dy <= 4; dy++) for (let dx = -6; dx <= 6; dx++) if (dx * dx / 36 + dy * dy / 16 <= 1) ink(cx + dx, cy + dy)
			}
		}
		if (system.length > 1) {
			for (let y = system[0]; y <= system[system.length - 1] + 4 * spacing; y++) { ink(left, y); ink(left + 1, y) }
		}
	}
	return { rgba, staffTops }
}

test('finds staves and groups them into systems', () => {
	const width = 1200, height = 1600
	const { rgba } = page(width, height, [[150, 260], [500, 610], [850, 960]])
	const result = detectSystems(rgba, width, height)
	assert.equal(result.top.length, 3)
	assert.deepEqual(result.staffCount, [2, 2, 2])
	assert.equal(result.staffTop.length, 6)
	assert.ok(Math.abs(result.staffTop[0] - 150) <= 2)
	assert.ok(Math.abs(result.staffBottom[0] - 191) <= 2)
	for (let i = 0; i < 3; i++) assert.ok(result.top[i] < result.staffTop[i * 2] && result.bottom[i] > result.staffBottom[i * 2 + 1])
	for (let i = 1; i < 3; i++) assert.ok(result.top[i] >= result.bottom[i - 1])
})

test('pages single parts staff by staff', () => {
	const width = 1200, height = 1600
	const { rgba } = page(width, height, [[150], [300], [450], [600]])
	const result = detectSystems(rgba, width, height)
	assert.equal(result.top.length, 4)
	assert.deepEqual(result.staffCount, [1, 1, 1, 1])
})

test('reports nothing on pages without music', () => {
	const width = 800, height = 1100
	const rgba = new Uint8ClampedArray(width * height * 4).fill(255)
	assert.equal(detectSystems(rgba, width, height).top.length, 0)
})
