import { detectSystems } from '../core/systemDetector.js'
import { looksLikeMuseScore } from '../core/museScoreReader.js'
import { MUSIC_FONT, MuseScoreDocument } from '../core/museScoreDocument.js'
import { PdfDocument } from '../core/pdfDocument.js'
import { ScoreNavigator } from '../core/navigator.js'
import { scoreParts } from '../core/performance.js'
import { AudioPlayer } from './audioPlayer.js'
import { SoundBank } from './soundBank.js'
import { CameraGestures, drawGestureDebug } from './cameraGestures.js'
import { button, el, FileBrowser, showPartsDialog, showSettingsDialog } from './ui.js'

const ACCENT = '#c49848'
const MAX_VOICE = 6
const PLAYBACK_SPEEDS = [50, 75, 100, 125]
const DETECT_WIDTH = 1400
const PAGE_CACHE = 8

export const isScoreFileName = name => /\.(pdf|mscz|mscx)$/i.test(name)
const parentOf = path => path.substring(0, path.lastIndexOf('/')) || '/'
const baseName = path => path.substring(path.lastIndexOf('/') + 1)
const joinPath = (folder, name) => (folder === '/' ? '' : folder) + '/' + name

/** Name of the file with manually marked systems; only PDFs drop their extension (as files from older versions do). */
export function sidecarName(fileName) {
	return fileName.replace(/\.pdf$/i, '') + '.systems.json'
}

/**
 * Full-screen score reader. Platform services are injected:
 *   source:   file access (list, read, readText, write)
 *   settings: settings store (load, save)
 *   pdfjs:    the pdf.js module
 *   fontUrl:  URL of the Leland music font
 *   soundUrl: address of a sampled instrument by name (optional; without it playback is synthesized)
 *   version:  app version shown on the start page and in the settings
 */
export class Reader {
	constructor(root, {
		source, settings, pdfjs, fontUrl, soundUrl = null, version, onFileChange, bare = false, bareUrl = null, homeUrl = null,
		pickFile = null, pickFolder = null, folderLabel = 'Ordner öffnen', onContinue = null, intro = null, startActions = [],
	}) {
		this.root = root
		this.source = source
		this.settingsStore = settings
		this.settings = settings.load()
		this.pdfjs = pdfjs
		this.fontUrl = fontUrl
		this.soundBank = soundUrl ? new SoundBank(soundUrl) : null
		this.version = version
		this.onFileChange = onFileChange || (() => {})
		// Header-less mode (bare) and how to get there or back, for browsers without a fullscreen mode.
		this.bare = bare
		this.bareUrl = bareUrl
		this.homeUrl = homeUrl
		// Optional replacements for the built-in file browser, e.g. the device's own file picker.
		this.pickFile = pickFile
		this.pickFolder = pickFolder
		this.folderLabel = folderLabel
		this.onContinue = onContinue
		this.intro = intro || 'Öffne eine Noten-PDF oder MuseScore-Datei aus deiner Nextcloud oder wähle einen Ordner mit Noten.'
		this.startActions = startActions
		this.doc = null
		this.nav = null
		this.path = null
		this.displayName = 'Keine Noten geöffnet'
		this.folder = null
		this.folderFiles = []
		this.folderIndex = -1
		this.openToken = 0
		this.renderToken = 0
		this.pageCache = new Map()
		this.cacheWidth = 0
		this.editMode = false
		this.selected = null // {page, index}
		this.undoHistory = []
		this.zoom = 1; this.panX = 0; this.panY = 0
		this.shownParts = []
		this.player = null
		this.range = null // {first, last} measure indices to play
		this.rangeFirst = null // first measure picked while marking a range, -1 before it is picked
		this.mix = null // {parts, others} when only some parts are played
		this.cursorPage = -1; this.cursorSystem = -1
		this.queue = Promise.resolve()
		this.pointers = new Map()
		this.wakeLock = null
		this.camera = null
		this.lastGesture = null
		this.wheelAccumulator = 0; this.wheelBlockedUntil = 0
		this.build()
		this.bindEvents()
		this.refreshInfo()
		this.updateCamera()
	}

	// ---- UI construction ----------------------------------------------------------------------------------

	build() {
		const r = this.root
		r.classList.add('nl-root')
		this.canvas = el('canvas', { class: 'nl-score' })
		this.cursorMeasure = el('div', { class: 'nl-cursor-measure' })
		this.cursorLine = el('div', { class: 'nl-cursor-line' })
		this.titleView = el('div', { class: 'nl-title' })
		this.info = el('div', { class: 'nl-info' })
		this.playButton = button('▶', () => this.togglePlayback(), 'Abspielen')
		this.rangeButton = button('Bereich', () => this.toggleRange(), 'Takte zum Abspielen markieren')
		this.partsButton = button('Stimmen', () => this.chooseParts(), 'Stimmen zum Abspielen wählen')
		this.detectionButton = button('System', () => this.toggleDetection())
		this.editButton = button('Bearbeiten', () => this.toggleEditMode())
		this.previousButton = button('‹', () => this.run(() => this.previous()), 'Vorherige Seite')
		this.nextButton = button('›', () => this.run(() => this.next()), 'Nächste Seite')
		this.undoEditButton = button('↶', () => this.undoManualEdit(), 'Letzte Bearbeitung rückgängig machen')
		this.removeButton = button('−', () => this.removeManualSystem(), 'Ausgewähltes System entfernen')
		this.clearButton = button('×', () => this.clearManualSystems(), 'Systeme dieser Seite löschen')
		this.fullscreenButton = button('⛶', () => this.toggleFullscreen(), 'Vollbild')
		const tools = el('div', { class: 'nl-tools' }, [
			this.playButton, this.rangeButton, this.partsButton,
			button('Öffnen', () => this.chooseFile()),
			this.detectionButton, this.editButton,
			button('⚙', () => this.showSettings(), 'Einstellungen'),
			this.bare && this.homeUrl ? button('⌂', () => this.goHome(), 'Zurück zu Nextcloud') : null,
			this.fullscreenButton,
			this.previousButton, this.nextButton, this.undoEditButton, this.removeButton, this.clearButton,
		])
		for (const b of [this.previousButton, this.nextButton, this.playButton]) b.classList.add('nl-big')
		this.overlay = el('div', { class: 'nl-panel nl-overlay' }, [this.titleView, this.info, tools])
		this.overlay.addEventListener('pointerdown', () => this.showControls())

		this.continueButton = el('button', { class: 'nl-start-action nl-secondary', type: 'button' })
		this.continueButton.addEventListener('click', async () => {
			const path = this.settings.lastFile
			if (this.onContinue && !(await this.onContinue(path))) return
			this.openFile(path)
		})
		this.startPage = el('div', { class: 'nl-start' }, [
			el('div', { class: 'nl-emblem' }, '♫'),
			el('h2', {}, 'NotenLeser'),
			el('p', { class: 'nl-intro' }, this.intro),
			startAction('Noten öffnen', true, () => this.chooseFile()),
			startAction(this.folderLabel, false, () => this.chooseFolder()),
			...this.startActions.map(([label, action]) => startAction(label, false, () => action(this))),
			this.continueButton,
			el('button', { class: 'nl-link', type: 'button', onclick: () => this.showSettings() }, 'Einstellungen'),
			el('button', { class: 'nl-link', type: 'button', onclick: () => this.toggleFullscreen() }, 'Vollbild'),
			this.bare && this.homeUrl ? el('button', { class: 'nl-link', type: 'button', onclick: () => this.goHome() }, 'Zurück zu Nextcloud') : null,
			el('p', { class: 'nl-hint' }, 'Wischen ← → oder Pfeiltasten blättert   ·   Wischen ↑ ↓ wechselt die Datei   ·   F: Vollbild'),
			el('p', { class: 'nl-version' }, this.versionLabel()),
		])
		this.banner = el('div', { class: 'nl-panel nl-banner' })
		this.toastView = el('div', { class: 'nl-toast' })
		this.debugCanvas = el('canvas', { class: 'nl-panel nl-debug' })
		r.replaceChildren(this.canvas, this.cursorMeasure, this.cursorLine, this.startPage, this.overlay, this.banner, this.debugCanvas, this.toastView)
		this.updateToolButtons()
	}

	versionLabel() { return this.version ? 'Version ' + this.version : 'Version unbekannt' }

	updateToolButtons() {
		const auto = this.nav ? this.nav.autoDetection : true
		this.detectionButton.textContent = auto ? 'System' : 'Seitenweise'
		this.detectionButton.classList.toggle('nl-accent', auto && !this.editMode)
		this.editButton.textContent = this.editMode ? 'Fertig' : 'Bearbeiten'
		this.editButton.classList.toggle('nl-accent', this.editMode)
		for (const b of [this.previousButton, this.nextButton, this.undoEditButton, this.removeButton, this.clearButton]) b.hidden = !this.editMode
		this.updatePlayButton()
		const continuable = this.settings.lastFile && !this.doc
		this.continueButton.hidden = !continuable
		if (continuable) this.continueButton.textContent = 'Weiterlesen: ' + baseName(this.settings.lastFile)
	}

	updatePlayButton() {
		this.playButton.hidden = !this.player || this.editMode
		const playing = !!(this.player && this.player.playing)
		this.playButton.textContent = playing ? '■' : '▶'
		this.playButton.title = playing ? 'Wiedergabe beenden' : 'Abspielen'
		this.playButton.classList.toggle('nl-accent', playing)
		this.rangeButton.hidden = this.playButton.hidden
		this.partsButton.hidden = this.playButton.hidden || !this.doc || scoreParts(this.doc.score).length < 2
		this.partsButton.classList.toggle('nl-accent', !!this.mix)
		this.rangeButton.classList.toggle('nl-accent', !!this.range || this.rangeFirst !== null)
		this.rangeButton.textContent = this.rangeFirst !== null ? 'Abbrechen' : this.range ? 'Takt ' + rangeLabel(this.range) : 'Bereich'
		this.rangeButton.title = this.rangeFirst !== null ? 'Markieren abbrechen' : this.range ? 'Bereich aufheben' : 'Takte zum Abspielen markieren'
	}

	refreshInfo() {
		this.startPage.hidden = !!this.doc
		this.titleView.textContent = this.displayName
		if (!this.doc) { this.overlay.hidden = true; this.info.textContent = ''; return }
		const nav = this.nav
		const separator = '  ·  '
		const filePosition = this.folderIndex >= 0 ? `${separator}Datei ${this.folderIndex + 1}/${this.folderFiles.length}` : ''
		const pagePosition = `Seite ${nav.page + 1}/${this.doc.pageCount}`
		if (!nav.autoDetection) {
			const marked = this.manualRanges(nav.page).length
			const mode = this.editMode ? `Bearbeiten: ${marked} Systeme` : 'Seitenmodus'
			this.info.textContent = pagePosition + filePosition + separator + mode
			return
		}
		const known = nav.knownSystemCount(nav.page)
		const count = known ? known : 4
		const visible = nav.visible.length > 1 ? `${separator}${nav.visible.length} im Bild` : ''
		const range = (this.range ? `${separator}Bereich: Takt ${rangeLabel(this.range)}` : '')
			+ (this.mix ? `${separator}${this.mixLabel()}` : '')
		this.info.textContent = `${pagePosition}${filePosition}${separator}System ${nav.system + 1}/${count}${visible}${known ? '' : ' (Fallback)'}${range}`
	}

	showControls() {
		clearTimeout(this.hideControlsTimer)
		if (!this.doc) { this.overlay.hidden = true; return }
		this.overlay.hidden = false
		this.overlay.classList.remove('nl-faded')
		this.hideControlsTimer = setTimeout(() => this.hideControls(), 3500)
	}

	hideControls() {
		clearTimeout(this.hideControlsTimer)
		if (this.root.querySelector('.nl-dialog')) return
		this.overlay.classList.add('nl-faded')
	}

	toggleControls() {
		if (!this.overlay.hidden && !this.overlay.classList.contains('nl-faded')) this.hideControls()
		else this.showControls()
	}

	showBanner(text, persistent = false) {
		clearTimeout(this.bannerTimer)
		this.banner.textContent = text
		this.banner.classList.add('nl-visible')
		if (!persistent) this.bannerTimer = setTimeout(() => this.hideBanner(), 1400)
	}

	hideBanner() { this.banner.classList.remove('nl-visible') }

	toast(text, long = false) {
		clearTimeout(this.toastTimer)
		this.toastView.textContent = text
		this.toastView.classList.add('nl-visible')
		this.toastTimer = setTimeout(() => this.toastView.classList.remove('nl-visible'), long ? 4000 : 2000)
	}

	// ---- events -------------------------------------------------------------------------------------------

	bindEvents() {
		const c = this.canvas
		c.addEventListener('pointerdown', e => this.onPointerDown(e))
		c.addEventListener('pointermove', e => this.onPointerMove(e))
		c.addEventListener('pointerup', e => this.onPointerUp(e))
		c.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); this.multiTouch = false })
		c.addEventListener('wheel', e => this.onWheel(e), { passive: false })
		c.addEventListener('contextmenu', e => e.preventDefault())
		this.keyHandler = e => this.onKey(e)
		document.addEventListener('keydown', this.keyHandler)
		this.resizeObserver = new ResizeObserver(() => { if (this.doc) this.render() })
		this.resizeObserver.observe(this.root)
		this.visibilityHandler = () => {
			if (document.hidden) this.stopPlayback()
			this.updateWakeLock()
			this.updateCamera()
		}
		document.addEventListener('visibilitychange', this.visibilityHandler)
		const fullscreenChanged = () => this.fullscreenButton.classList.toggle('nl-accent', this.isFullscreen())
		document.addEventListener('fullscreenchange', fullscreenChanged)
		document.addEventListener('webkitfullscreenchange', fullscreenChanged)
	}

	/** Serialises navigation so that fast pedal presses or swipes never overtake each other. */
	run(action) {
		this.queue = this.queue.then(action).catch(e => { console.error(e); this.toast('Fehler: ' + e.message, true) })
		return this.queue
	}

	pointerAverage() {
		let x = 0, y = 0
		for (const p of this.pointers.values()) { x += p.x; y += p.y }
		return { x: x / this.pointers.size, y: y / this.pointers.size }
	}

	pointerDistance() {
		const [a, b] = [...this.pointers.values()]
		return Math.hypot(a.x - b.x, a.y - b.y)
	}

	local(e) {
		const rect = this.canvas.getBoundingClientRect()
		return { x: e.clientX - rect.left, y: e.clientY - rect.top }
	}

	onPointerDown(e) {
		if (!this.doc) return
		this.canvas.setPointerCapture(e.pointerId)
		const point = this.local(e)
		this.pointers.set(e.pointerId, point)
		if (this.pointers.size === 1) {
			this.touchStart = point; this.lastTouch = point
			this.multiTouch = false
			this.startedOnManualSystem = this.editMode && this.manualSystemAt(point.y) >= 0
		} else {
			this.multiTouch = true
			if (this.pointers.size === 2) {
				this.twoFingerStart = this.pointerAverage(); this.twoFingerHandled = false
				this.pinchDistance = this.pointerDistance(); this.pinchZoom = this.zoom
			} else this.twoFingerHandled = true
		}
	}

	onPointerMove(e) {
		if (!this.pointers.has(e.pointerId)) return
		const point = this.local(e)
		this.pointers.set(e.pointerId, point)
		if (this.pointers.size > 1) {
			this.multiTouch = true
			if (this.editMode && this.pointers.size === 2 && this.pinchDistance > 0) {
				const center = this.pointerAverage()
				this.zoomAt(this.pinchZoom * this.pointerDistance() / this.pinchDistance, center.x, center.y)
			}
			return
		}
		if (this.editMode && this.zoom > 1.01 && !this.startedOnManualSystem) {
			this.panX += point.x - this.lastTouch.x
			this.panY += point.y - this.lastTouch.y
			this.clampPan()
			this.draw()
		}
		this.lastTouch = point
	}

	onPointerUp(e) {
		if (!this.pointers.has(e.pointerId)) return
		const point = this.local(e)
		this.pointers.set(e.pointerId, point)
		const width = this.canvas.clientWidth, height = this.canvas.clientHeight
		if (this.pointers.size === 2) {
			// A two-finger swipe pages by the whole screen; a pinch keeps its centroid in place.
			if (!this.editMode && !this.twoFingerHandled) {
				this.twoFingerHandled = true
				const average = this.pointerAverage()
				const dx = average.x - this.twoFingerStart.x, dy = average.y - this.twoFingerStart.y
				if (Math.abs(dx) > Math.max(48, width * 0.12) && Math.abs(dx) > Math.abs(dy)) {
					this.run(() => (dx < 0 ? this.next(true) : this.previous(true)))
				}
			}
			this.pointers.delete(e.pointerId)
			return
		}
		this.pointers.delete(e.pointerId)
		if (this.pointers.size > 0) return
		const dx = point.x - this.touchStart.x, dy = point.y - this.touchStart.y
		const tap = Math.abs(dx) < 16 && Math.abs(dy) < 16
		if (this.editMode) {
			if (this.multiTouch || (this.zoom > 1.01 && !this.startedOnManualSystem && Math.hypot(dx, dy) > 8)) return
			if (tap) {
				const selected = this.manualSystemAt(this.touchStart.y)
				if (selected >= 0) { this.selected = { page: this.nav.page, index: selected }; this.showControls(); this.draw() } else this.toggleControls()
			} else this.editOrAddManualSystem(this.touchStart.y, point.y)
			return
		}
		if (this.multiTouch) return
		if (Math.abs(dx) > Math.max(48, width * 0.12) && Math.abs(dx) > Math.abs(dy)) {
			this.run(() => (dx < 0 ? this.next() : this.previous()))
		} else if (Math.abs(dy) > Math.max(64, height * 0.15) && Math.abs(dy) > Math.abs(dx) * 1.3) {
			this.switchFile(dy < 0 ? 1 : -1)
		} else if (tap) {
			if (this.rangeFirst !== null) this.pickRangeMeasure(point)
			else this.toggleControls()
		}
	}

	onWheel(e) {
		if (!this.doc) return
		e.preventDefault()
		if (this.editMode) {
			const point = this.local(e)
			this.zoomAt(this.zoom * Math.exp(-e.deltaY * 0.002), point.x, point.y)
			return
		}
		// A mouse wheel or touchpad scroll turns one system per notch.
		const now = performance.now()
		if (now < this.wheelBlockedUntil) return
		this.wheelAccumulator += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY
		if (Math.abs(this.wheelAccumulator) < 60) return
		const direction = Math.sign(this.wheelAccumulator)
		this.wheelAccumulator = 0
		this.wheelBlockedUntil = now + 250
		this.run(() => (direction > 0 ? this.next() : this.previous()))
	}

	/**
	 * Bluetooth page turners pose as keyboards and send arrow, page or media keys.
	 * A held pedal repeats its key; it should still turn only once.
	 */
	onKey(e) {
		if (e.ctrlKey || e.metaKey || e.altKey) return
		if (this.root.querySelector('.nl-dialog')) return
		const target = e.target
		if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
		if (!this.root.isConnected) return
		if ((e.key === 'f' || e.key === 'F') && !e.repeat) { e.preventDefault(); this.toggleFullscreen(); return }
		if (!this.doc) return
		const direction = pedalDirection(e.key)
		if (direction === 0) return
		e.preventDefault()
		if (e.repeat) return
		this.run(() => (direction > 0 ? this.next() : this.previous()))
	}

	// ---- files --------------------------------------------------------------------------------------------

	async chooseFile() {
		let path
		try {
			path = this.pickFile ? await this.pickFile() : await this.browse('file', this.folder || this.settings.lastFolder || '/')
		} catch (e) {
			this.toast(e.message, true)
			return
		}
		if (path) this.openFile(path)
	}

	/** Shows the built-in file browser for the current source. */
	browse(mode, start = '/') {
		return new FileBrowser(this.root, this.source, { mode, start, filter: isScoreFileName }).open()
	}

	async chooseFolder() {
		let folder
		try {
			folder = this.pickFolder ? await this.pickFolder() : await this.browse('folder', this.folder || this.settings.lastFolder || '/')
		} catch (e) {
			this.toast(e.message, true)
			return
		}
		if (!folder) return
		try {
			const files = await this.loadFolder(folder)
			if (files.length === 0) {
				// The scores may sit in subfolders, so let the player pick one there.
				const entries = await this.source.list(folder)
				if (entries.some(entry => entry.isDir)) {
					const path = await this.browse('file', folder)
					if (path) this.openFile(path)
					return
				}
				this.toast('In diesem Ordner wurden keine PDF- oder MuseScore-Dateien gefunden', true)
				return
			}
			this.toast(`${files.length} Notendateien im Ordner gefunden`)
			this.openFile(files[0].path)
		} catch (e) {
			this.toast('Ordner konnte nicht gelesen werden: ' + e.message, true)
		}
	}

	async loadFolder(folder) {
		const entries = await this.source.list(folder)
		const files = entries.filter(entry => !entry.isDir && isScoreFileName(entry.name))
		this.folder = folder
		this.folderFiles = files
		this.folderIndex = files.findIndex(file => file.path === this.path)
		return files
	}

	/** Opens the next (1) or previous (-1) score of the folder. */
	switchFile(direction, startAtEnd = false) {
		if (this.folderIndex < 0 || this.folderFiles.length === 0) {
			this.showBanner('Der Ordner der Datei wird noch geladen')
			return false
		}
		const target = this.folderIndex + direction
		if (target < 0 || target >= this.folderFiles.length) {
			this.showBanner(direction > 0 ? 'Letzte Datei im Ordner' : 'Erste Datei im Ordner')
			return false
		}
		this.canvas.style.transition = 'transform 180ms, opacity 180ms'
		this.canvas.style.transform = `translateY(${-direction * 8}%)`
		this.canvas.style.opacity = '0'
		this.switchDirection = direction
		this.openFile(this.folderFiles[target].path, startAtEnd)
		return true
	}

	async openFile(path, startAtEnd = false) {
		if (!path) return
		const token = ++this.openToken
		// Must happen right away: browsers only allow fullscreen shortly after a click or key press.
		if (this.settings.autoFullscreen) this.enterFullscreen(true)
		const folder = parentOf(path)
		const name = baseName(path)
		const index = this.folder === folder ? this.folderFiles.findIndex(f => f.path === path) : -1
		this.showBanner(index >= 0 ? `Datei ${index + 1} / ${this.folderFiles.length} wird geladen …` : `${name} wird geladen …`, true)
		try {
			const data = await this.source.read(path)
			const doc = await this.createDocument(data, name)
			const manual = await this.readSidecar(folder, name)
			if (token !== this.openToken) { doc.close(); return }
			this.closeDocument()
			this.doc = doc
			this.path = path
			this.displayName = name
			this.editMode = false
			this.selected = null
			this.undoHistory = []
			this.zoom = 1; this.panX = 0; this.panY = 0
			this.nav = new ScoreNavigator(doc, page => this.detectPage(page), manual)
			this.nav.twoSystemsMinimum = this.settings.twoSystemsMinimum
			this.updateViewport()
			if (startAtEnd) await this.nav.goToEnd()
			this.player = doc.kind === 'musescore' ? new AudioPlayer(doc.score, this.soundBank) : null
			if (this.player) this.player.onLoading = () => this.showBanner('Instrumente werden geladen …', true)
			this.updateToolButtons()
			this.showControls()
			await this.render()
			this.revealScore()
			this.onFileChange(path)
			this.saveSettings({ lastFile: path, lastFolder: folder })
			this.updateWakeLock()
			if (this.folder !== folder) {
				this.folder = folder; this.folderFiles = []; this.folderIndex = -1
				this.loadFolder(folder).then(() => this.refreshInfo()).catch(() => {})
			} else this.folderIndex = this.folderFiles.findIndex(f => f.path === path)
			this.refreshInfo()
			this.showBanner(this.folderIndex >= 0 ? `${name}\nDatei ${this.folderIndex + 1} / ${this.folderFiles.length}` : name)
		} catch (e) {
			if (token !== this.openToken) return
			console.error(e)
			this.hideBanner()
			this.revealScore()
			this.toast('Lesefehler: ' + e.message, true)
		}
	}

	revealScore() {
		const c = this.canvas
		if (this.switchDirection) {
			c.style.transition = 'none'
			c.style.transform = `translateY(${this.switchDirection * 8}%)`
			void c.offsetWidth
		}
		this.switchDirection = 0
		c.style.transition = 'transform 220ms, opacity 220ms'
		c.style.transform = ''
		c.style.opacity = '1'
	}

	async createDocument(data, name) {
		const pdf = data.length >= 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46
		if (!pdf && looksLikeMuseScore(data.subarray(0, 512), name)) {
			await loadMusicFont(this.fontUrl)
			return new MuseScoreDocument(data, {
				parseXml: text => new DOMParser().parseFromString(text, 'application/xml'),
				createCanvas,
			})
		}
		return PdfDocument.open(this.pdfjs, data, createCanvas)
	}

	closeDocument() {
		this.stopPlayback()
		if (this.player) this.player.close()
		this.player = null
		try { if (this.doc) this.doc.close() } catch (e) { console.warn(e) }
		this.doc = null
		this.nav = null
		this.range = null
		this.rangeFirst = null
		this.mix = null
		this.pageCache.clear()
	}

	async readSidecar(folder, name) {
		const result = new Map()
		let text
		try { text = await this.source.readText(joinPath(folder, sidecarName(name))) } catch (e) { return result }
		if (!text) return result
		try {
			const pages = JSON.parse(text).pages || {}
			for (const [key, systems] of Object.entries(pages)) {
				const page = parseInt(key, 10)
				if (!(page >= 0) || !Array.isArray(systems)) continue
				const ratios = []
				for (const bounds of systems) {
					if (!Array.isArray(bounds) || bounds.length < 2) continue
					const top = Number(bounds[0]), bottom = Number(bounds[1])
					if (!(top >= 0) || !(bottom <= 1) || bottom - top < 0.005) continue
					ratios.push(top, bottom)
				}
				if (ratios.length > 0 || systems.length === 0) result.set(page, ratios)
			}
		} catch (e) { /* ignore broken files */ }
		return result
	}

	saveSidecar() {
		if (!this.path || !this.nav) return
		const folder = parentOf(this.path), name = sidecarName(this.displayName)
		const pages = {}
		for (const page of [...this.nav.manual.keys()].sort((a, b) => a - b)) {
			const ratios = this.nav.manual.get(page)
			const systems = []
			for (let i = 0; i + 1 < ratios.length; i += 2) systems.push([round(ratios[i]), round(ratios[i + 1])])
			pages[String(page)] = systems
		}
		const json = JSON.stringify({ version: 1, pdf: this.displayName, pages }, null, 2)
		this.sidecarQueue = (this.sidecarQueue || Promise.resolve())
			.then(() => this.source.write(joinPath(folder, name), json))
			.then(() => this.toast(`Systeme in ${name} gespeichert`))
			.catch(e => this.toast('JSON-Speichern fehlgeschlagen: ' + e.message, true))
	}

	// ---- rendering ----------------------------------------------------------------------------------------

	renderWidth() {
		const ratio = window.devicePixelRatio || 1
		return Math.max(1000, Math.min(2600, Math.round(this.canvas.clientWidth * ratio)))
	}

	async pageCanvas(page) {
		const width = this.renderWidth()
		if (width !== this.cacheWidth) { this.pageCache.clear(); this.cacheWidth = width }
		let entry = this.pageCache.get(page)
		if (!entry) {
			entry = this.doc.renderPage(page, width)
			this.pageCache.set(page, entry)
			entry.catch(() => this.pageCache.delete(page))
			while (this.pageCache.size > PAGE_CACHE) this.pageCache.delete(this.pageCache.keys().next().value)
		} else {
			// Keep recently used pages at the end of the cache.
			this.pageCache.delete(page); this.pageCache.set(page, entry)
		}
		return entry
	}

	/** Finds staves and systems on a rendered page; the result is kept as ratios of the page height. */
	async detectPage(page) {
		const source = await this.pageCanvas(page)
		let canvas = source
		if (source.width > DETECT_WIDTH * 1.15) {
			canvas = createCanvas(DETECT_WIDTH, Math.max(1, Math.round(DETECT_WIDTH * source.height / source.width)))
			canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
		}
		const context = canvas.getContext('2d', { willReadFrequently: true })
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
		const result = detectSystems(pixels, canvas.width, canvas.height)
		const h = canvas.height
		const systems = [], staves = []
		result.top.forEach((top, i) => systems.push(top / h, result.bottom[i] / h))
		result.staffTop.forEach((top, i) => staves.push(top / h, result.staffBottom[i] / h))
		return { systems, staves }
	}

	updateViewport() {
		if (this.nav) this.nav.setViewport(this.canvas.clientWidth, this.canvas.clientHeight, 7)
	}

	/** Lays out the current position and draws it. */
	async render() {
		if (!this.doc) return
		const token = ++this.renderToken
		this.updateViewport()
		const nav = this.nav
		if (nav.autoDetection) await nav.computeVisible()
		else if (this.editMode) await nav.analysis(nav.page)
		const pages = nav.autoDetection ? [...new Set(nav.visible.map(s => s.page))] : [nav.page]
		const canvases = new Map()
		for (const page of pages) canvases.set(page, await this.pageCanvas(page))
		const highlights = new Map()
		if (this.settings.voice > 0 && !this.editMode) {
			const systems = nav.autoDetection ? nav.visible : await this.pageSystemRefs(nav.page)
			for (const system of systems) {
				highlights.set(system, await nav.voiceStaff(system.page, system.top, system.bottom, this.settings.voice))
			}
		}
		if (token !== this.renderToken) return
		this.frame = { canvases, highlights }
		this.draw()
		this.refreshInfo()
		this.prefetch()
	}

	async pageSystemRefs(page) {
		const systems = await this.nav.systemsOf(page)
		const refs = []
		for (let i = 0; i + 1 < systems.length; i += 2) refs.push({ page, index: i / 2, top: systems[i], bottom: systems[i + 1] })
		return refs
	}

	/** Renders and analyses the following pages in the background so turning stays quick. */
	prefetch() {
		const nav = this.nav
		const last = nav.visible.length ? nav.visible[nav.visible.length - 1].page : nav.page
		const doc = this.doc
		setTimeout(() => {
			if (this.doc !== doc) return
			for (let page = last + 1; page <= last + 2 && page < doc.pageCount; page++) {
				if (nav.autoDetection) nav.analysis(page).catch(() => {})
				else this.pageCanvas(page).catch(() => {})
			}
		}, 300)
	}

	prepareCanvas() {
		const ratio = window.devicePixelRatio || 1
		const width = this.canvas.clientWidth, height = this.canvas.clientHeight
		const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio)
		if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
			this.canvas.width = pixelWidth; this.canvas.height = pixelHeight
		}
		const c = this.canvas.getContext('2d')
		c.setTransform(ratio, 0, 0, ratio, 0, 0)
		c.fillStyle = '#000'
		c.fillRect(0, 0, width, height)
		c.imageSmoothingQuality = 'high'
		return { c, width, height }
	}

	draw() {
		if (!this.doc || !this.frame) return
		if (this.nav.autoDetection) this.drawSystems()
		else this.drawPage()
		this.drawRange()
		this.updatePlaybackCursor(false)
	}

	drawSystems() {
		const { c, width, height } = this.prepareCanvas()
		const nav = this.nav
		const systems = nav.visible.filter(s => this.frame.canvases.has(s.page))
		if (systems.length === 0) return
		const gap = nav.gap
		const total = systems.reduce((sum, s) => sum + s.height, 0) + gap * (systems.length - 1)
		const scale = Math.min(1, height / total)
		const offsetX = (width - width * scale) / 2, offsetY = (height - total * scale) / 2
		c.fillStyle = '#fff'
		c.fillRect(offsetX, offsetY, width * scale, total * scale)
		this.shownParts = []
		let y = 0
		systems.forEach((system, i) => {
			const page = this.frame.canvases.get(system.page)
			const sy = system.top * page.height, sh = Math.max(1, (system.bottom - system.top) * page.height)
			const dy = offsetY + y * scale, dh = system.height * scale
			c.drawImage(page, 0, sy, page.width, sh, offsetX, dy, width * scale, dh)
			this.shownParts.push({ page: system.page, top: system.top, bottom: system.bottom, x: offsetX, y: dy, width: width * scale, height: dh })
			const staff = this.frame.highlights.get(system)
			if (staff) this.drawVoiceHighlight(c, staff, system, offsetX, dy, width * scale, dh)
			const label = `${system.page + 1}·${system.index + 1}`
			c.font = '500 10px system-ui, sans-serif'
			const badgeHeight = 17, badgeWidth = Math.max(27, c.measureText(label).width + 8)
			const bx = offsetX + 5, by = dy + 3
			const current = system.page === nav.page && system.index === nav.system
			c.fillStyle = current ? 'rgba(20,112,196,.92)' : 'rgba(35,43,52,.8)'
			roundRect(c, bx, by, badgeWidth, badgeHeight, badgeHeight / 2)
			c.fill()
			c.fillStyle = '#fff'
			c.textAlign = 'center'
			c.textBaseline = 'middle'
			c.fillText(label, bx + badgeWidth / 2, by + badgeHeight / 2 + 0.5)
			y += system.height
			if (i + 1 < systems.length) {
				c.strokeStyle = 'rgba(75,83,91,.57)'
				c.lineWidth = 1
				const lineY = offsetY + (y + gap / 2) * scale
				c.beginPath(); c.moveTo(offsetX, lineY); c.lineTo(offsetX + width * scale, lineY); c.stroke()
				y += gap
			}
		})
	}

	/** Page geometry in screen pixels for the page mode, including zoom and pan while editing. */
	pageGeometry() {
		const width = this.canvas.clientWidth, height = this.canvas.clientHeight
		const naturalHeight = width * this.doc.pageAspect(this.nav.page)
		const scale = Math.min(1, height / naturalHeight) * (this.editMode ? this.zoom : 1)
		const w = width * scale, h = naturalHeight * scale
		return {
			x: (width - w) / 2 + (this.editMode ? this.panX : 0),
			y: (height - h) / 2 + (this.editMode ? this.panY : 0),
			width: w, height: h, scale,
		}
	}

	drawPage() {
		const { c } = this.prepareCanvas()
		const page = this.frame.canvases.get(this.nav.page)
		if (!page) return
		const g = this.pageGeometry()
		c.drawImage(page, g.x, g.y, g.width, g.height)
		this.shownParts = [{ page: this.nav.page, top: 0, bottom: 1, x: g.x, y: g.y, width: g.width, height: g.height }]
		if (this.editMode) { this.drawManualOverlay(c, g); return }
		for (const [system, staff] of this.frame.highlights) {
			if (!staff) continue
			this.drawVoiceHighlight(c, staff, system, g.x, g.y + system.top * g.height, g.width, (system.bottom - system.top) * g.height)
		}
	}

	/** Tints the player's staff; multiplying keeps the notes black while the paper turns amber. */
	drawVoiceHighlight(c, staff, system, x, y, width, height) {
		const ratioHeight = system.bottom - system.top
		const toY = ratio => y + (ratio - system.top) / ratioHeight * height
		const pad = (staff.bottom - staff.top) * 0.55
		const top = Math.max(y, toY(staff.top - pad)), bottom = Math.min(y + height, toY(staff.bottom + pad))
		if (bottom <= top) return
		c.save()
		c.globalCompositeOperation = 'multiply'
		c.fillStyle = '#ffe8aa'
		c.fillRect(x, top, width, bottom - top)
		c.restore()
		c.fillStyle = ACCENT
		c.fillRect(x, top, Math.max(4, width / 160), bottom - top)
	}

	drawManualOverlay(c, g) {
		const ranges = this.manualRanges(this.nav.page)
		const marked = this.nav.manual.has(this.nav.page)
		ranges.forEach(([topRatio, bottomRatio], i) => {
			const top = g.y + topRatio * g.height, bottom = g.y + bottomRatio * g.height
			const selected = this.selected && this.selected.page === this.nav.page && this.selected.index === i
			const color = selected ? [230, 146, 24] : marked ? [20, 112, 196] : [110, 120, 132]
			c.fillStyle = `rgba(${color},${selected ? 0.3 : 0.22})`
			c.fillRect(g.x, top, g.width, bottom - top)
			c.strokeStyle = `rgba(${color},.9)`
			c.lineWidth = 2
			c.strokeRect(g.x, top, g.width, bottom - top)
			const label = 'System ' + (i + 1)
			c.font = '500 13px system-ui, sans-serif'
			const badgeWidth = c.measureText(label).width + 16
			c.fillStyle = `rgba(${color},.85)`
			roundRect(c, g.x + 6, top + 4, badgeWidth, 20, 6)
			c.fill()
			c.fillStyle = '#fff'
			c.textAlign = 'left'
			c.textBaseline = 'middle'
			c.fillText(label, g.x + 14, top + 14.5)
		})
		if (!marked && ranges.length > 0) {
			c.font = '500 13px system-ui, sans-serif'
			c.fillStyle = 'rgba(24,28,34,.85)'
			const text = 'Automatisch erkannt – Ziehen ändert die Systeme dieser Seite'
			const w = c.measureText(text).width + 20
			roundRect(c, (this.canvas.clientWidth - w) / 2, this.canvas.clientHeight - 84, w, 28, 14)
			c.fill()
			c.fillStyle = '#fff'
			c.textAlign = 'center'
			c.fillText(text, this.canvas.clientWidth / 2, this.canvas.clientHeight - 69.5)
		}
	}

	// ---- navigation ---------------------------------------------------------------------------------------

	async next(wholeScreen = false) {
		if (!this.doc) return
		const result = await this.nav.next(wholeScreen)
		if (result === 'end') {
			if (this.folderIndex >= 0 && this.folderIndex + 1 < this.folderFiles.length) { this.switchFile(1); return }
			this.showBanner('Ende der Noten')
		}
		await this.render()
	}

	async previous(wholeScreen = false) {
		if (!this.doc) return
		const result = await this.nav.previous(wholeScreen)
		if (result === 'start') {
			if (this.folderIndex > 0) { this.switchFile(-1, true); return }
			this.showBanner('Anfang der Noten')
		}
		await this.render()
	}

	toggleDetection() {
		if (!this.doc) return
		if (this.editMode) { this.toast('Zum Beenden erst „Fertig“ antippen'); return }
		this.nav.autoDetection = !this.nav.autoDetection
		this.nav.system = 0
		this.updateToolButtons()
		this.toast(this.nav.autoDetection ? 'Systemweise blättern' : 'Seitenweise blättern')
		this.run(() => this.render())
	}

	static fullscreenSupported() {
		return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled)
	}

	isFullscreen() {
		return (document.fullscreenElement || document.webkitFullscreenElement) === this.root
	}

	/** Enters the browser's fullscreen mode; quiet attempts fail silently when the browser refuses. */
	enterFullscreen(quiet = false) {
		if (this.isFullscreen() || !Reader.fullscreenSupported()) return false
		const request = this.root.requestFullscreen || this.root.webkitRequestFullscreen
		try {
			const result = request.call(this.root, { navigationUI: 'hide' })
			if (result && result.catch) result.catch(() => { if (!quiet) this.toast('Der Browser hat den Vollbildmodus abgelehnt') })
			return true
		} catch (e) {
			if (!quiet) this.toast('Der Browser hat den Vollbildmodus abgelehnt')
			return false
		}
	}

	exitFullscreen() {
		const exit = document.exitFullscreen || document.webkitExitFullscreen
		if (exit) { const result = exit.call(document); if (result && result.catch) result.catch(() => {}) }
	}

	/**
	 * Toggles fullscreen. Browsers without a fullscreen mode for pages (Safari on the iPhone) switch to the
	 * header-less reader instead, which can also be added to the home screen.
	 */
	toggleFullscreen() {
		if (this.isFullscreen()) { this.exitFullscreen(); return }
		if (Reader.fullscreenSupported()) { this.enterFullscreen(false); return }
		if (!this.bare && this.bareUrl) { window.location.href = this.bareUrl(this.path); return }
		this.toast('Für Vollbild in Safari „Teilen → Zum Home-Bildschirm“ wählen und NotenLeser von dort starten', true)
	}

	goHome() {
		if (!this.homeUrl) return
		this.exitFullscreen()
		window.location.href = this.homeUrl(this.path)
	}

	async updateWakeLock() {
		const wanted = !!this.doc && !document.hidden
		if (!('wakeLock' in navigator)) return
		try {
			if (wanted && !this.wakeLock) {
				this.wakeLock = await navigator.wakeLock.request('screen')
				this.wakeLock.addEventListener('release', () => { this.wakeLock = null })
			} else if (!wanted && this.wakeLock) {
				await this.wakeLock.release()
				this.wakeLock = null
			}
		} catch (e) { /* not allowed, e.g. without user interaction */ }
	}

	// ---- edit mode ----------------------------------------------------------------------------------------

	async toggleEditMode() {
		if (!this.doc) { this.toast('Bitte zuerst Noten öffnen'); return }
		this.editMode = !this.editMode
		this.nav.autoDetection = !this.editMode
		if (this.editMode) { this.stopPlayback(); this.rangeFirst = null; this.hideBanner() }
		this.zoom = 1; this.panX = 0; this.panY = 0
		this.selected = null
		this.nav.system = 0
		this.updateToolButtons()
		if (this.editMode) {
			// The detected systems are the starting point for corrections.
			await this.nav.analysis(this.nav.page)
			this.toast('Ziehen markiert, verschiebt oder ändert ein System', true)
		}
		this.run(() => this.render())
	}

	/** Systems of a page as [[top, bottom], ...]: the manual ones or, until edited, the detected ones. */
	manualRanges(page) {
		const nav = this.nav
		const stored = nav.manual.has(page) ? nav.manual.get(page) : nav.detected.get(page)?.systems || []
		const ranges = []
		for (let i = 0; i + 1 < stored.length; i += 2) ranges.push([stored[i], stored[i + 1]])
		return ranges
	}

	setManualRanges(page, ranges) {
		ranges.sort((a, b) => a[0] - b[0])
		this.nav.manual.set(page, ranges.flat())
	}

	pushUndo(page) {
		this.undoHistory.push({ page, manual: this.nav.manual.has(page), ratios: this.manualRanges(page).flat() })
		if (this.undoHistory.length > 50) this.undoHistory.shift()
	}

	ratioFromScreenY(y) {
		const g = this.pageGeometry()
		return Math.max(0, Math.min(1, (y - g.y) / g.height))
	}

	manualSystemAt(y) {
		if (!this.editMode || !this.nav) return -1
		const ratio = this.ratioFromScreenY(y)
		return this.manualRanges(this.nav.page).findIndex(([top, bottom]) => ratio >= top && ratio <= bottom)
	}

	editOrAddManualSystem(startY, endY) {
		const page = this.nav.page
		const g = this.pageGeometry()
		const startRatio = this.ratioFromScreenY(startY), endRatio = this.ratioFromScreenY(endY)
		const ranges = this.manualRanges(page)
		const existing = ranges.findIndex(([top, bottom]) => startRatio >= top && startRatio <= bottom)
		if (existing >= 0) {
			this.pushUndo(page)
			const range = ranges[existing]
			const edgeTolerance = 30 / g.height
			if (Math.abs(startRatio - range[0]) <= edgeTolerance) range[0] = Math.min(endRatio, range[1] - 0.005)
			else if (Math.abs(startRatio - range[1]) <= edgeTolerance) range[1] = Math.min(1, Math.max(endRatio, range[0] + 0.005))
			else {
				const height = range[1] - range[0]
				range[0] = Math.max(0, Math.min(1 - height, range[0] + endRatio - startRatio))
				range[1] = range[0] + height
			}
			this.setManualRanges(page, ranges)
			this.selected = { page, index: ranges.indexOf(range) }
		} else {
			const top = Math.min(startRatio, endRatio), bottom = Math.max(startRatio, endRatio)
			if ((bottom - top) * g.height < 18 || bottom - top < 0.01) {
				this.toast('System durch Ziehen von oben nach unten markieren')
				return
			}
			this.pushUndo(page)
			const added = [top, bottom]
			ranges.push(added)
			this.setManualRanges(page, ranges)
			this.selected = { page, index: ranges.indexOf(added) }
		}
		this.saveSidecar()
		this.draw()
		this.refreshInfo()
	}

	removeManualSystem() {
		const page = this.nav.page
		const ranges = this.manualRanges(page)
		if (ranges.length === 0) return
		const remove = this.selected && this.selected.page === page && this.selected.index < ranges.length ? this.selected.index : ranges.length - 1
		this.pushUndo(page)
		ranges.splice(remove, 1)
		this.setManualRanges(page, ranges)
		this.selected = null
		this.saveSidecar()
		this.draw(); this.refreshInfo()
	}

	clearManualSystems() {
		const page = this.nav.page
		if (this.manualRanges(page).length > 0) this.pushUndo(page)
		this.setManualRanges(page, [])
		this.selected = null
		this.saveSidecar()
		this.draw(); this.refreshInfo()
	}

	undoManualEdit() {
		const snapshot = this.undoHistory.pop()
		if (!snapshot) { this.toast('Keine Bearbeitung zum Rückgängigmachen'); return }
		if (snapshot.manual) this.nav.manual.set(snapshot.page, snapshot.ratios)
		else this.nav.manual.delete(snapshot.page)
		if (snapshot.page === this.nav.page) this.selected = null
		this.saveSidecar()
		this.draw(); this.refreshInfo()
	}

	zoomAt(newZoom, focusX, focusY) {
		if (!this.editMode || !this.doc) return
		newZoom = Math.max(1, Math.min(5, newZoom))
		const before = this.pageGeometry()
		const imageX = (focusX - before.x) / before.width, imageY = (focusY - before.y) / before.height
		this.zoom = newZoom
		this.panX = 0; this.panY = 0
		const centered = this.pageGeometry()
		this.panX = focusX - (centered.x + imageX * centered.width)
		this.panY = focusY - (centered.y + imageY * centered.height)
		if (this.zoom === 1) { this.panX = 0; this.panY = 0 }
		this.clampPan()
		this.draw()
	}

	clampPan() {
		if (this.zoom <= 1) { this.panX = 0; this.panY = 0; return }
		const width = this.canvas.clientWidth, height = this.canvas.clientHeight
		const { panX, panY } = this
		this.panX = 0; this.panY = 0
		const g = this.pageGeometry()
		const overscroll = 64
		const clamp = (value, viewSize, start, size) => {
			const min = viewSize - size - start - overscroll, max = -start + overscroll
			return min > max ? 0 : Math.max(min, Math.min(max, value))
		}
		this.panX = clamp(panX, width, g.x, g.width)
		this.panY = clamp(panY, height, g.y, g.height)
	}

	// ---- playback -----------------------------------------------------------------------------------------

	async togglePlayback() {
		if (!this.player || this.doc.kind !== 'musescore') return
		if (this.player.playing) { this.stopPlayback(); return }
		if (this.rangeFirst !== null) this.cancelRangeSelection()
		const startTick = this.doc.systemStartTick(this.nav.page, this.nav.autoDetection ? this.nav.system : 0)
		try {
			await this.player.start(Math.max(0, startTick), this.settings.playbackSpeed / 100, () => this.stopPlayback(), this.range, this.mix)
		} catch (e) {
			this.hideBanner()
			this.toast('Wiedergabe nicht möglich: ' + e.message, true)
			return
		}
		// Loading the instruments may have taken a moment; the player could have been stopped meanwhile.
		if (this.banner.textContent.startsWith('Instrumente')) this.hideBanner()
		if (!this.player || !this.player.playing) return
		this.cursorPage = -1; this.cursorSystem = -1
		this.updatePlayButton()
		this.hideControls()
		const tick = () => {
			if (!this.player || !this.player.playing) return
			this.updatePlaybackCursor(true)
			this.cursorFrame = requestAnimationFrame(tick)
		}
		this.cursorFrame = requestAnimationFrame(tick)
	}

	// ---- parts to play -----------------------------------------------------------------------------------

	mixLabel() {
		const names = scoreParts(this.doc.score).filter(p => this.mix.parts.has(p.part)).map(p => p.name)
		return (names.length === 1 ? 'Stimme: ' : 'Stimmen: ') + names.join(', ') + (this.mix.others > 0 ? ' (andere leise)' : '')
	}

	/** Lets the player pick the parts to hear; a running playback continues with the new choice. */
	async chooseParts() {
		if (!this.player || !this.doc.score) return
		const score = this.doc.score
		const own = this.settings.voice > 0 && this.settings.voice <= score.staves.length ? score.staves[this.settings.voice - 1].part : -1
		const result = await showPartsDialog(this.root, scoreParts(score), this.mix, own)
		if (!result) return
		this.mix = result.mix
		this.updatePlayButton()
		this.refreshInfo()
		this.showBanner(this.mix ? this.mixLabel() : 'Alle Stimmen werden abgespielt')
		if (this.player.playing) { this.stopPlayback(); this.togglePlayback() }
	}

	// ---- playback range -----------------------------------------------------------------------------------

	/** Starts marking a range, cancels marking, or removes the marked range. */
	toggleRange() {
		if (!this.player || this.editMode) return
		if (this.rangeFirst !== null) { this.cancelRangeSelection(); return }
		if (this.range) {
			if (this.player.playing) this.stopPlayback()
			this.range = null
			this.toast('Bereich aufgehoben – ▶ spielt wieder ab dem obersten System')
			this.afterRangeChange()
			return
		}
		this.stopPlayback()
		this.rangeFirst = -1
		this.showBanner('Ersten Takt des Bereichs antippen', true)
		this.afterRangeChange()
	}

	cancelRangeSelection() {
		this.rangeFirst = null
		this.hideBanner()
		this.afterRangeChange()
	}

	afterRangeChange() {
		this.updatePlayButton()
		this.refreshInfo()
		this.draw()
	}

	/** Measure under a point of the canvas, or -1. */
	measureAtPoint(point) {
		const part = this.shownParts.find(p => point.x >= p.x && point.x <= p.x + p.width && point.y >= p.y && point.y <= p.y + p.height)
		if (!part || !this.doc.measureAt) return -1
		const yRatio = part.top + (point.y - part.y) / part.height * (part.bottom - part.top)
		return this.doc.measureAt(part.page, (point.x - part.x) / part.width, yRatio)
	}

	/** Takes a tapped measure as the first or last measure of the range; swiping in between turns pages. */
	pickRangeMeasure(point) {
		const measure = this.measureAtPoint(point)
		if (measure < 0) return
		if (this.rangeFirst < 0) {
			this.rangeFirst = measure
			this.showBanner(`Takt ${measure + 1} – jetzt letzten Takt antippen`, true)
			this.draw()
			return
		}
		this.range = { first: Math.min(this.rangeFirst, measure), last: Math.max(this.rangeFirst, measure) }
		this.rangeFirst = null
		this.showBanner(`Takt ${rangeLabel(this.range)}\n▶ spielt den Bereich in Schleife`)
		this.afterRangeChange()
		this.showControls()
	}

	/** Tints the marked measures, or the first measure while a range is being marked. */
	drawRange() {
		const range = this.rangeFirst !== null && this.rangeFirst >= 0 ? { first: this.rangeFirst, last: this.rangeFirst } : this.range
		if (!range || !this.doc.measureBoxes || this.editMode) return
		const c = this.canvas.getContext('2d')
		for (const part of this.shownParts) {
			for (const box of this.doc.measureBoxes(part.page, range.first, range.last)) {
				const middle = (box.top + box.bottom) / 2
				if (middle < part.top || middle > part.bottom) continue
				const scaleY = part.height / (part.bottom - part.top)
				const top = part.y + (Math.max(part.top, box.top) - part.top) * scaleY
				const bottom = part.y + (Math.min(part.bottom, box.bottom) - part.top) * scaleY
				const left = part.x + box.left * part.width, right = part.x + box.right * part.width
				c.save()
				c.globalCompositeOperation = 'multiply'
				c.fillStyle = '#c9f0cf'
				c.fillRect(left, top, right - left, bottom - top)
				c.restore()
				c.strokeStyle = 'rgba(38,150,72,.85)'
				c.lineWidth = 2
				c.strokeRect(left, top, right - left, bottom - top)
			}
		}
	}

	stopPlayback() {
		if (this.player) this.player.stop()
		cancelAnimationFrame(this.cursorFrame)
		this.cursorMeasure.hidden = true
		this.cursorLine.hidden = true
		this.updatePlayButton()
	}

	/** Moves the cursor to the sounding position and turns to its system once playback reaches it. */
	updatePlaybackCursor(follow) {
		const hide = () => { this.cursorMeasure.hidden = true; this.cursorLine.hidden = true }
		if (!this.player || !this.player.playing || this.editMode) { hide(); return }
		const tick = this.player.currentTick()
		const cursor = tick < 0 ? null : this.doc.cursorAt(tick)
		if (!cursor) { hide(); return }
		const nav = this.nav
		if (follow && (cursor.page !== this.cursorPage || cursor.system !== this.cursorSystem)) {
			this.cursorPage = cursor.page; this.cursorSystem = cursor.system
			// The sounding system goes to the top of the screen so the following ones can be read ahead.
			if (nav.autoDetection ? cursor.page !== nav.page || cursor.system !== nav.system : cursor.page !== nav.page) {
				nav.page = cursor.page; nav.system = nav.autoDetection ? cursor.system : 0
				this.run(() => this.render())
				hide()
				return
			}
		}
		const middle = (cursor.top + cursor.bottom) / 2
		const part = this.shownParts.find(p => p.page === cursor.page && middle >= p.top && middle <= p.bottom)
		if (!part) { hide(); return }
		const scaleY = part.height / (part.bottom - part.top)
		const top = part.y + (Math.max(part.top, cursor.top) - part.top) * scaleY
		const bottom = part.y + (Math.min(part.bottom, cursor.bottom) - part.top) * scaleY
		const x = v => part.x + v * part.width
		Object.assign(this.cursorMeasure.style, { left: x(cursor.left) + 'px', top: top + 'px', width: (x(cursor.right) - x(cursor.left)) + 'px', height: (bottom - top) + 'px' })
		Object.assign(this.cursorLine.style, { left: (x(cursor.x) - 1.5) + 'px', top: top + 'px', height: (bottom - top) + 'px' })
		this.cursorMeasure.hidden = false
		this.cursorLine.hidden = false
	}

	// ---- settings and camera ------------------------------------------------------------------------------

	async showSettings() {
		const result = await showSettingsDialog(this.root, this.settings, {
			maxVoice: MAX_VOICE, speeds: PLAYBACK_SPEEDS, version: this.versionLabel(),
		})
		if (!result) return
		const voiceChanged = result.voice !== this.settings.voice
		const cameraTurnedOn = result.cameraGestures && !this.settings.cameraGestures
		this.saveSettings(result)
		if (this.nav) this.nav.twoSystemsMinimum = this.settings.twoSystemsMinimum
		this.updateCamera()
		if (cameraTurnedOn) this.showBanner('Handbewegung vor der Frontkamera blättert')
		if (this.doc) {
			if (voiceChanged) this.showBanner(this.settings.voice === 0 ? 'Keine Stimme hervorgehoben' : `${this.settings.voice}. Stimme wird hervorgehoben`)
			this.run(() => this.render())
		}
	}

	saveSettings(values) {
		Object.assign(this.settings, values)
		this.updateToolButtons()
		this.settingsStore.save(values).catch(e => this.toast(e.message, true))
	}

	/** Runs the camera only while the option is on and the page is visible. */
	updateCamera() {
		const run = this.settings.cameraGestures && !document.hidden
		this.debugCanvas.hidden = !(run && this.settings.cameraDebug)
		if (!run) { if (this.camera) this.camera.stop(); return }
		if (!this.camera) {
			this.camera = new CameraGestures({
				onSwipe: direction => {
					if (!this.doc) return
					this.lastGesture = { text: direction > 0 ? '← nächstes System' : '→ vorheriges System', time: performance.now() }
					this.run(() => (direction > 0 ? this.next() : this.previous()))
				},
				onError: message => this.toast(message, true),
				onDebugFrame: frame => {
					const recent = this.lastGesture && performance.now() - this.lastGesture.time < 1500 ? this.lastGesture.text : null
					drawGestureDebug(this.debugCanvas, frame, recent)
				},
			})
		}
		this.camera.setSensitivity(this.settings.cameraSensitivity)
		this.camera.debug = this.settings.cameraDebug
		if (this.settings.cameraDebug) drawGestureDebug(this.debugCanvas, null, null)
		this.camera.start()
	}

	destroy() {
		this.closeDocument()
		if (this.camera) this.camera.stop()
		document.removeEventListener('keydown', this.keyHandler)
		document.removeEventListener('visibilitychange', this.visibilityHandler)
		this.resizeObserver.disconnect()
	}
}

function pedalDirection(key) {
	switch (key) {
	case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter': case 'MediaTrackNext':
		return 1
	case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'MediaTrackPrevious':
		return -1
	default:
		return 0
	}
}

function rangeLabel(range) {
	return range.first === range.last ? `${range.first + 1}` : `${range.first + 1}–${range.last + 1}`
}

function startAction(label, primary, action) {
	return el('button', { class: 'nl-start-action' + (primary ? ' nl-primary' : ' nl-secondary'), type: 'button', onclick: action }, label)
}

function roundRect(c, x, y, width, height, radius) {
	c.beginPath()
	if (c.roundRect) c.roundRect(x, y, width, height, radius)
	else c.rect(x, y, width, height)
}

function round(value) { return Math.round(value * 10000) / 10000 }

function createCanvas(width, height) {
	const canvas = document.createElement('canvas')
	canvas.width = width; canvas.height = height
	return canvas
}

let fontPromise = null

/** Loads the Leland music font once; engraving measures and draws with it. */
function loadMusicFont(url) {
	if (!fontPromise) {
		const face = new FontFace(MUSIC_FONT, `url(${url})`)
		fontPromise = face.load().then(loaded => { document.fonts.add(loaded) }).catch(e => {
			fontPromise = null
			throw new Error('Notenschrift konnte nicht geladen werden')
		})
	}
	return fontPromise
}
