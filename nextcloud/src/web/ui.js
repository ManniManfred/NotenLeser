/** Small DOM helpers, the file browser and the settings dialog. */

export function el(tag, attributes = {}, children = []) {
	const element = document.createElement(tag)
	for (const [key, value] of Object.entries(attributes)) {
		if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.substring(2), value)
		else if (key === 'class') element.className = value
		else if (value === true) element.setAttribute(key, '')
		else if (value !== false && value !== null && value !== undefined) element.setAttribute(key, value)
	}
	for (const item of [].concat(children)) {
		if (item === null || item === undefined || item === false) continue
		element.append(item instanceof Node ? item : document.createTextNode(String(item)))
	}
	return element
}

export function button(label, action, title) {
	const b = el('button', { class: 'nl-button', type: 'button', title: title || null, 'aria-label': title || null }, label)
	b.addEventListener('click', e => { e.stopPropagation(); action() })
	return b
}

/** A modal dialog inside the reader (so it also works in fullscreen). Resolves with the value passed to close. */
function dialog(root, title, content, actions) {
	return new Promise(resolve => {
		const close = value => {
			document.removeEventListener('keydown', onKey, true)
			backdrop.remove()
			resolve(value)
		}
		const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null) } }
		const box = el('div', { class: 'nl-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
			el('h3', {}, title),
			el('div', { class: 'nl-dialog-content' }, content),
			el('div', { class: 'nl-dialog-actions' }, actions(close)),
		])
		const backdrop = el('div', { class: 'nl-backdrop' }, box)
		backdrop.addEventListener('pointerdown', e => { if (e.target === backdrop) close(null) })
		document.addEventListener('keydown', onKey, true)
		root.append(backdrop)
		const focus = box.querySelector('.nl-dialog-actions .nl-primary') || box.querySelector('button')
		if (focus) focus.focus()
	})
}

/** Browses the user's files; mode 'file' picks a score file, mode 'folder' picks a folder. */
export class FileBrowser {
	constructor(root, source, { mode, start, filter }) {
		this.root = root; this.source = source; this.mode = mode; this.filter = filter
		this.path = start || '/'
	}

	open() {
		this.list = el('ul', { class: 'nl-files' })
		this.crumbs = el('div', { class: 'nl-crumbs' })
		const title = this.mode === 'folder' ? 'Ordner mit Noten wählen' : 'Noten öffnen'
		return dialog(this.root, title, [this.crumbs, this.list], close => {
			this.close = close
			const actions = [el('button', { class: 'nl-button', type: 'button', onclick: () => close(null) }, 'Abbrechen')]
			if (this.mode === 'folder') {
				actions.push(el('button', { class: 'nl-button nl-primary', type: 'button', onclick: () => close(this.path) }, 'Diesen Ordner öffnen'))
			}
			this.show(this.path)
			return actions
		})
	}

	async show(path) {
		this.path = path
		this.crumbs.replaceChildren()
		const parts = path.split('/').filter(Boolean)
		const crumb = (label, target) => el('button', { class: 'nl-crumb', type: 'button', onclick: () => this.show(target) }, label)
		this.crumbs.append(crumb('Dateien', '/'))
		parts.forEach((part, i) => this.crumbs.append(' › ', crumb(part, '/' + parts.slice(0, i + 1).join('/'))))
		this.list.replaceChildren(el('li', { class: 'nl-files-note' }, 'Wird geladen …'))
		let entries
		try {
			entries = await this.source.list(path)
		} catch (e) {
			if (path !== '/') { this.show('/'); return }
			this.list.replaceChildren(el('li', { class: 'nl-files-note' }, e.message))
			return
		}
		if (this.path !== path) return
		const visible = entries.filter(entry => entry.isDir || this.filter(entry.name))
		this.list.replaceChildren(...visible.map(entry => {
			const item = el('button', { class: 'nl-file' + (entry.isDir ? ' nl-dir' : ''), type: 'button' }, [
				el('span', { class: 'nl-file-icon' }, entry.isDir ? '📁' : entry.name.toLowerCase().endsWith('.pdf') ? '📄' : '🎼'),
				el('span', { class: 'nl-file-name' }, entry.name),
			])
			item.addEventListener('click', () => (entry.isDir ? this.show(entry.path) : this.mode === 'file' && this.close(entry.path)))
			return el('li', {}, item)
		}))
		if (visible.length === 0) this.list.append(el('li', { class: 'nl-files-note' }, 'Keine Noten in diesem Ordner'))
	}
}

/** Shows the settings; resolves with the changed settings or null when cancelled. */
export function showSettingsDialog(root, settings, { maxVoice, speeds, version }) {
	const radios = (name, options, current) => el('div', { class: 'nl-options' }, options.map(([value, label]) => el('label', { class: 'nl-option' }, [
		el('input', { type: 'radio', name, value: String(value), checked: value === current }), label,
	])))
	const checkbox = (name, label, checked) => el('label', { class: 'nl-option' }, [el('input', { type: 'checkbox', name, checked }), label])
	const hint = text => el('p', { class: 'nl-hint-text' }, text)
	const voices = [[0, 'Keine hervorheben']]
	for (let i = 1; i <= maxVoice; i++) voices.push([i, `${i}. Stimme`])
	const form = el('form', { class: 'nl-settings' }, [
		el('h4', {}, 'Meine Stimme'),
		hint('Die gewählte Notenzeile wird in jedem System mit mehreren Stimmen farbig hinterlegt.'),
		radios('voice', voices, settings.voice),
		el('h4', {}, 'Anzeige'),
		checkbox('twoSystemsMinimum', 'Immer mindestens 2 Systeme anzeigen', settings.twoSystemsMinimum),
		hint('Das folgende System ist schon zu sehen, damit du vorauslesen kannst. Passen beide nicht auf den Bildschirm, werden sie verkleinert.'),
		el('h4', {}, 'Steuerung'),
		checkbox('cameraGestures', 'Mit Handbewegung vor der Frontkamera blättern', settings.cameraGestures),
		hint('Finger oder Hand vor der Kamera von rechts nach links bewegen: nächstes System; von links nach rechts: vorheriges System. '
			+ 'Die Kamerabilder werden nur im Browser ausgewertet und weder gespeichert noch übertragen.'),
		radios('cameraSensitivity', [[0, 'Fein – kleine Fingerbewegung'], [1, 'Mittel'], [2, 'Grob – ganze Hand']], settings.cameraSensitivity),
		checkbox('cameraDebug', 'Erkennung anzeigen (Debug)', settings.cameraDebug),
		hint('Zeigt unten rechts das Kamerabild als grobes Raster: rot sind bewegte Bereiche, der Punkt folgt der Bewegung. '
			+ 'Die gestrichelten Linien zeigen, wie weit sie für eine Geste reichen muss.'),
		hint('Bluetooth-Blätterpedale, die sich als Tastatur verbinden, funktionieren ohne Einstellung (Pfeiltasten, Bild↑/↓, Leertaste).'),
		el('h4', {}, 'Wiedergabe (MuseScore)'),
		radios('playbackSpeed', speeds.map(speed => [speed, speed === 100 ? 'Originaltempo' : `Tempo ${speed} %`]), settings.playbackSpeed),
		el('p', { class: 'nl-version' }, version),
	])
	form.addEventListener('submit', e => e.preventDefault())
	return dialog(root, 'Einstellungen', form, close => [
		el('button', { class: 'nl-button', type: 'button', onclick: () => close(null) }, 'Abbrechen'),
		el('button', {
			class: 'nl-button nl-primary',
			type: 'button',
			onclick: () => {
				const data = new FormData(form)
				close({
					voice: Number(data.get('voice') ?? 0),
					twoSystemsMinimum: data.has('twoSystemsMinimum'),
					cameraGestures: data.has('cameraGestures'),
					cameraSensitivity: Number(data.get('cameraSensitivity') ?? 0),
					cameraDebug: data.has('cameraDebug'),
					playbackSpeed: Number(data.get('playbackSpeed') ?? 100),
				})
			},
		}, 'Übernehmen'),
	])
}
