import { CELL_THRESHOLD, GRID_H, GRID_W, GestureTracker } from '../core/gestureTracker.js'

/**
 * Watches the front camera and reports sideways hand movements. The picture is reduced to a coarse
 * brightness grid in memory and never stored or sent anywhere.
 */
export class CameraGestures {
	constructor({ onSwipe, onError, onDebugFrame }) {
		this.onSwipe = onSwipe; this.onError = onError; this.onDebugFrame = onDebugFrame
		this.tracker = new GestureTracker()
		this.stream = null
		this.video = null
		this.running = false
		this.canvas = document.createElement('canvas')
		this.canvas.width = GRID_W * 4; this.canvas.height = GRID_H * 4
		this.context = this.canvas.getContext('2d', { willReadFrequently: true })
		this.debug = false
	}

	setSensitivity(sensitivity) { this.tracker.setSensitivity(sensitivity) }

	async start() {
		if (this.running) return
		this.running = true
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			this.running = false
			this.onError('Der Browser erlaubt hier keinen Kamerazugriff (nur über HTTPS möglich)')
			return
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 20 } },
				audio: false,
			})
			if (!this.running) { stream.getTracks().forEach(t => t.stop()); return }
			this.stream = stream
			this.video = document.createElement('video')
			this.video.muted = true
			this.video.playsInline = true
			this.video.srcObject = stream
			await this.video.play()
			this.tracker.reset()
			this.loop()
		} catch (e) {
			this.running = false
			this.onError(e && e.name === 'NotAllowedError'
				? 'Ohne Kamerazugriff ist das Blättern per Handbewegung nicht möglich'
				: 'Frontkamera nicht verfügbar')
		}
	}

	stop() {
		this.running = false
		if (this.stream) this.stream.getTracks().forEach(t => t.stop())
		this.stream = null
		if (this.video) this.video.srcObject = null
		this.video = null
	}

	loop() {
		if (!this.running || !this.video) return
		const next = () => {
			if (!this.running || !this.video) return
			if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(() => this.loop())
			else setTimeout(() => this.loop(), 50)
		}
		if (this.video.readyState < 2) { next(); return }
		const { canvas, context } = this
		// Mirror the picture so that movements match what the player sees, like in a mirror.
		context.save()
		context.translate(canvas.width, 0)
		context.scale(-1, 1)
		context.drawImage(this.video, 0, 0, canvas.width, canvas.height)
		context.restore()
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
		const luma = new Float32Array(GRID_W * GRID_H)
		const cell = 4
		for (let gy = 0; gy < GRID_H; gy++) {
			for (let gx = 0; gx < GRID_W; gx++) {
				let sum = 0
				for (let y = gy * cell; y < (gy + 1) * cell; y++) {
					for (let x = gx * cell; x < (gx + 1) * cell; x++) {
						const p = (y * canvas.width + x) * 4
						sum += pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114
					}
				}
				luma[gy * GRID_W + gx] = sum / (cell * cell)
			}
		}
		const frame = this.tracker.analyse(luma, performance.now())
		if (frame.swipe !== 0) this.onSwipe(frame.swipe)
		if (this.debug) this.onDebugFrame(frame)
		next()
	}
}

/** Draws what the detector sees: grid, changing cells in red, motion centroid and needed travel. */
export function drawGestureDebug(canvas, frame, lastGesture) {
	const ratio = window.devicePixelRatio || 1
	const cssWidth = canvas.clientWidth, cssHeight = canvas.clientHeight
	if (canvas.width !== Math.round(cssWidth * ratio)) { canvas.width = Math.round(cssWidth * ratio); canvas.height = Math.round(cssHeight * ratio) }
	const c = canvas.getContext('2d')
	c.setTransform(ratio, 0, 0, ratio, 0, 0)
	c.clearRect(0, 0, cssWidth, cssHeight)
	const pad = 8, lineHeight = 15
	c.font = '500 11px system-ui, sans-serif'
	c.fillStyle = '#fff'
	if (!frame) { c.fillText('Kamera-Erkennung startet …', pad, pad + lineHeight); return }
	const areaWidth = cssWidth - 2 * pad, areaHeight = cssHeight - 2 * pad - 3 * lineHeight
	const cell = Math.min(areaWidth / frame.width, areaHeight / frame.height)
	const left = pad + (areaWidth - cell * frame.width) / 2, top = pad
	const gridWidth = cell * frame.width, gridHeight = cell * frame.height
	for (let y = 0; y < frame.height; y++) {
		for (let x = 0; x < frame.width; x++) {
			const i = y * frame.width + x
			const l = Math.max(0, Math.min(255, Math.round(frame.luma[i])))
			c.fillStyle = `rgb(${l},${l},${l})`
			c.fillRect(left + x * cell, top + y * cell, cell + 0.5, cell + 0.5)
			if (frame.change[i] >= CELL_THRESHOLD) {
				c.fillStyle = `rgba(230,40,40,${Math.min(220, 90 + Math.round(frame.change[i] * 2)) / 255})`
				c.fillRect(left + x * cell, top + y * cell, cell + 0.5, cell + 0.5)
			}
		}
	}
	c.lineWidth = 1.5
	if (!isNaN(frame.startX)) {
		const sx = left + frame.startX * gridWidth, sy = top + frame.startY * gridHeight
		c.strokeStyle = 'rgba(255,255,255,.63)'
		c.setLineDash([4, 3])
		for (const side of [-1, 1]) {
			const limit = sx + side * frame.minTravel * gridWidth
			if (limit >= left && limit <= left + gridWidth) { c.beginPath(); c.moveTo(limit, top); c.lineTo(limit, top + gridHeight); c.stroke() }
		}
		c.setLineDash([])
		if (!isNaN(frame.x)) {
			c.strokeStyle = '#c49848'
			c.beginPath(); c.moveTo(sx, sy); c.lineTo(left + frame.x * gridWidth, top + frame.y * gridHeight); c.stroke()
		}
		c.strokeStyle = '#fff'
		c.beginPath(); c.arc(sx, sy, 4, 0, Math.PI * 2); c.stroke()
	}
	if (!isNaN(frame.x)) {
		c.fillStyle = '#c49848'
		c.beginPath(); c.arc(left + frame.x * gridWidth, top + frame.y * gridHeight, 5, 0, Math.PI * 2); c.fill()
	}
	c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1
	c.strokeRect(left, top, gridWidth, gridHeight)
	const textY = top + gridHeight + lineHeight
	const format = v => v.toLocaleString('de-DE', { maximumFractionDigits: 1 })
	c.fillStyle = frame.share >= frame.minMoving ? '#fff' : '#969ea8'
	c.fillText(`Bewegung ${format(frame.share * 100)} % (ab ${Math.round(frame.minMoving * 100)} %)`, pad, textY)
	c.fillStyle = frame.tracking ? '#fff' : '#969ea8'
	const direction = frame.travel < 0 ? '←' : frame.travel > 0 ? '→' : ''
	c.fillText(`Weg ${direction} ${Math.round(Math.abs(frame.travel) * 100)} % von ${Math.round(frame.minTravel * 100)} %`, pad, textY + lineHeight)
	c.fillStyle = lastGesture ? '#c49848' : '#969ea8'
	c.fillText(lastGesture || (frame.tracking ? 'Bewegung wird verfolgt' : 'Keine Geste'), pad, textY + 2 * lineHeight)
}
