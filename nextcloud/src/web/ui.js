/** Small DOM helpers, the file browser and the settings dialog. */

/** Where users of every version find the source code (AGPL-3.0, section 13) and the licenses. */
export const SOURCE_URL = 'https://github.com/ManniManfred/NotenLeser'

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
		// Dialogs can be stacked (e.g. the file browser above the setlist editor); Escape closes the topmost one.
		const onKey = e => {
			if (e.key !== 'Escape' || [...root.querySelectorAll('.nl-backdrop')].pop() !== backdrop) return
			e.preventDefault(); e.stopPropagation(); close(null)
		}
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

/**
 * Browses the user's files. Modes: 'file' picks one file, 'files' picks several (also from different folders,
 * resolving with their paths in the order they were ticked), 'folder' picks a folder.
 */
export class FileBrowser {
	constructor(root, source, { mode, start, filter, title = null, confirmLabel = null }) {
		this.root = root; this.source = source; this.mode = mode; this.filter = filter
		this.path = start || '/'
		this.title = title || (mode === 'folder' ? 'Ordner mit Noten wählen' : mode === 'files' ? 'Noten hinzufügen' : 'Noten öffnen')
		this.confirmLabel = confirmLabel || (mode === 'folder' ? 'Diesen Ordner öffnen' : 'Hinzufügen')
		this.chosen = []
	}

	open() {
		this.list = el('ul', { class: 'nl-files' })
		this.crumbs = el('div', { class: 'nl-crumbs' })
		return dialog(this.root, this.title, [this.crumbs, this.list], close => {
			this.close = close
			const actions = [el('button', { class: 'nl-button', type: 'button', onclick: () => close(null) }, 'Abbrechen')]
			if (this.mode === 'folder') {
				actions.push(el('button', { class: 'nl-button nl-primary', type: 'button', onclick: () => close(this.path) }, this.confirmLabel))
			} else if (this.mode === 'files') {
				this.confirmButton = el('button', {
					class: 'nl-button nl-primary', type: 'button', onclick: () => this.chosen.length && close([...this.chosen]),
				}, this.confirmLabel)
				actions.push(this.confirmButton)
				this.updateConfirm()
			}
			this.show(this.path)
			return actions
		})
	}

	updateConfirm() {
		this.confirmButton.disabled = this.chosen.length === 0
		this.confirmButton.textContent = this.chosen.length > 1 ? `${this.chosen.length} ${this.confirmLabel.toLowerCase()}` : this.confirmLabel
	}

	toggle(path, box) {
		const index = this.chosen.indexOf(path)
		if (index >= 0) this.chosen.splice(index, 1)
		else this.chosen.push(path)
		box.checked = index < 0
		this.updateConfirm()
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
			const box = this.mode === 'files' && !entry.isDir
				? el('input', { type: 'checkbox', class: 'nl-file-check', tabindex: '-1', checked: this.chosen.includes(entry.path) })
				: null
			const item = el('button', { class: 'nl-file' + (entry.isDir ? ' nl-dir' : ''), type: 'button' }, [
				box,
				el('span', { class: 'nl-file-icon' }, fileIcon(entry)),
				el('span', { class: 'nl-file-name' }, entry.name),
			])
			item.addEventListener('click', () => {
				if (entry.isDir) this.show(entry.path)
				else if (this.mode === 'file') this.close(entry.path)
				else if (box) this.toggle(entry.path, box)
			})
			return el('li', {}, item)
		}))
		if (visible.length === 0) this.list.append(el('li', { class: 'nl-files-note' }, 'Keine Noten in diesem Ordner'))
	}
}

function fileIcon(entry) {
	if (entry.isDir) return '📁'
	const name = entry.name.toLowerCase()
	return name.endsWith('.setlist.json') ? '📋' : name.endsWith('.pdf') ? '📄' : '🎼'
}

const fileName = path => path.substring(path.lastIndexOf('/') + 1)
const folderName = path => path.substring(0, path.lastIndexOf('/')) || '/'

/**
 * Edits a setlist. setlist: {title, files: [paths]}; addFiles: async () => [paths] or null; current: path of
 * the open score or null. Resolves with {title, files} or null when cancelled.
 */
export function showSetlistEditor(root, setlist, { addFiles, current = null, isNew = false }) {
	const files = [...setlist.files]
	const titleInput = el('input', { type: 'text', class: 'nl-text', value: setlist.title, placeholder: 'z. B. Konzert im Mai', maxlength: '120' })
	const list = el('ol', { class: 'nl-setlist' })
	const count = el('p', { class: 'nl-hint-text' })
	const render = (focus = -1) => {
		count.textContent = files.length === 0
			? 'Noch keine Lieder. Füge Noten aus beliebigen Ordnern hinzu; sie werden in dieser Reihenfolge gespielt.'
			: `${files.length} ${files.length === 1 ? 'Lied' : 'Lieder'} – mit ↑ ↓ die Reihenfolge ändern.`
		list.replaceChildren(...files.map((path, i) => {
			const small = (label, title, action, disabled = false) => el('button', {
				class: 'nl-button nl-small', type: 'button', title, 'aria-label': title, disabled, onclick: () => { action(); render(i) },
			}, label)
			return el('li', { class: 'nl-setlist-item' }, [
				el('span', { class: 'nl-setlist-number' }, `${i + 1}.`),
				el('span', { class: 'nl-setlist-name', title: path }, [fileName(path), el('small', {}, folderName(path))]),
				small('↑', 'Nach oben', () => files.splice(i - 1, 0, ...files.splice(i, 1)), i === 0),
				small('↓', 'Nach unten', () => files.splice(i + 1, 0, ...files.splice(i, 1)), i === files.length - 1),
				small('✕', 'Entfernen', () => files.splice(i, 1)),
			])
		}))
		if (focus >= 0) list.children[Math.min(focus, files.length - 1)]?.scrollIntoView({ block: 'nearest' })
	}
	const add = async () => {
		const paths = await addFiles()
		if (!paths || paths.length === 0) return
		files.push(...paths)
		render(files.length - 1)
	}
	const content = el('form', { class: 'nl-settings' }, [
		el('label', { class: 'nl-field' }, ['Name', titleInput]),
		el('h4', {}, 'Lieder'),
		count,
		list,
		el('div', { class: 'nl-dialog-actions nl-inline-actions' }, [
			el('button', { class: 'nl-button', type: 'button', onclick: add }, '+ Noten hinzufügen'),
			current ? el('button', {
				class: 'nl-button', type: 'button', onclick: () => { files.push(current); render(files.length - 1) },
			}, '+ Aktuelle Noten') : null,
		]),
	])
	content.addEventListener('submit', e => e.preventDefault())
	render()
	return dialog(root, isNew ? 'Neue Zusammenstellung' : 'Zusammenstellung bearbeiten', content, close => [
		el('button', { class: 'nl-button', type: 'button', onclick: () => close(null) }, 'Abbrechen'),
		el('button', {
			class: 'nl-button nl-primary',
			type: 'button',
			onclick: () => {
				const title = titleInput.value.trim()
				if (!title) { titleInput.focus(); return }
				if (files.length === 0) { add(); return }
				close({ title, files })
			},
		}, 'Speichern'),
	])
}

/**
 * Overview of the open setlist, or the choice to open or create one. setlist: {title, files} or null;
 * index: position of the open score. Resolves with {play: index}, {action: 'edit'|'open'|'new'|'close'} or null.
 */
export function showSetlistMenu(root, setlist, index) {
	const action = (label, value, primary = false) => close => el('button', {
		class: 'nl-button' + (primary ? ' nl-primary' : ''), type: 'button', onclick: () => close({ action: value }),
	}, label)
	if (!setlist) {
		const content = el('p', { class: 'nl-hint-text' },
			'Eine Zusammenstellung ist eine Liste von Liedern aus beliebigen Ordnern, z. B. für ein Konzert. '
			+ 'Sie wird als Datei „Name.setlist.json“ in deinen Dateien gespeichert; Wischen ↑ ↓ und Blätterpedale gehen dann der Reihe nach durch die Lieder.')
		return dialog(root, 'Zusammenstellung', content, close => [
			el('button', { class: 'nl-button', type: 'button', onclick: () => close(null) }, 'Abbrechen'),
			action('Öffnen …', 'open')(close),
			action('Neu …', 'new', true)(close),
		])
	}
	let chosen = null
	const list = el('ol', { class: 'nl-setlist' }, setlist.files.map((path, i) => el('li', {}, el('button', {
		class: 'nl-setlist-item nl-setlist-play' + (i === index ? ' nl-current' : ''),
		type: 'button',
		onclick: () => chosen && chosen({ play: i }),
	}, [
		el('span', { class: 'nl-setlist-number' }, `${i + 1}.`),
		el('span', { class: 'nl-setlist-name', title: path }, [fileName(path), el('small', {}, folderName(path))]),
	]))))
	const promise = dialog(root, setlist.title, list, close => {
		chosen = close
		return [
			action('Beenden', 'close')(close),
			action('Andere öffnen …', 'open')(close),
			action('Neu …', 'new')(close),
			action('Bearbeiten', 'edit', true)(close),
		]
	})
	list.querySelector('.nl-current')?.scrollIntoView({ block: 'center' })
	return promise
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
		checkbox('autoFullscreen', 'Beim Öffnen von Noten in den Vollbildmodus wechseln', settings.autoFullscreen),
		hint('Ein- und Ausschalten jederzeit mit ⛶ oder der Taste F. Auf dem iPhone öffnet ⛶ die Ansicht ohne Nextcloud-Kopfzeile; '
			+ 'über „Teilen → Zum Home-Bildschirm“ startet der NotenLeser dann wie eine eigene App im Vollbild.'),
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
		el('p', { class: 'nl-version' }, [version, ' · ', el('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener' }, 'Quellcode und Lizenzen (AGPL-3.0)')]),
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
					autoFullscreen: data.has('autoFullscreen'),
					cameraGestures: data.has('cameraGestures'),
					cameraSensitivity: Number(data.get('cameraSensitivity') ?? 0),
					cameraDebug: data.has('cameraDebug'),
					playbackSpeed: Number(data.get('playbackSpeed') ?? 100),
				})
			},
		}, 'Übernehmen'),
	])
}

/**
 * Chooses the parts to play. parts: [{part, name}]; current: {parts: Set, others} or null for all parts;
 * ownPart: the part of the highlighted own voice or -1. Resolves with {mix} (mix null for all parts),
 * or null when cancelled.
 */
export function showPartsDialog(root, parts, current, ownPart) {
	const selected = current ? current.parts : new Set(parts.map(p => p.part))
	const boxes = parts.map(p => el('input', { type: 'checkbox', value: String(p.part), checked: selected.has(p.part) }))
	const others = current && current.others > 0 ? 'quiet' : 'mute'
	const form = el('form', { class: 'nl-settings' }, [
		el('p', { class: 'nl-hint-text' }, 'Nur die angehakten Stimmen werden abgespielt.'),
		el('div', { class: 'nl-options' }, parts.map((p, i) => el('label', { class: 'nl-option' }, [boxes[i], p.name]))),
		el('div', { class: 'nl-dialog-actions nl-inline-actions' }, [
			el('button', { class: 'nl-button', type: 'button', onclick: () => boxes.forEach(b => { b.checked = true }) }, 'Alle'),
			ownPart >= 0 ? el('button', {
				class: 'nl-button', type: 'button', onclick: () => boxes.forEach(b => { b.checked = Number(b.value) === ownPart }),
			}, 'Nur meine Stimme') : null,
		]),
		el('h4', {}, 'Andere Stimmen'),
		el('div', { class: 'nl-options' }, [['mute', 'Stumm'], ['quiet', 'Leise mitspielen']].map(([value, label]) => el('label', { class: 'nl-option' }, [
			el('input', { type: 'radio', name: 'others', value, checked: value === others }), label,
		]))),
	])
	form.addEventListener('submit', e => e.preventDefault())
	return dialog(root, 'Stimmen abspielen', form, close => [
		el('button', { class: 'nl-button', type: 'button', onclick: () => close(null) }, 'Abbrechen'),
		el('button', {
			class: 'nl-button nl-primary',
			type: 'button',
			onclick: () => {
				const chosen = new Set(boxes.filter(b => b.checked).map(b => Number(b.value)))
				if (chosen.size === 0) return
				if (chosen.size === parts.length) { close({ mix: null }); return }
				close({ mix: { parts: chosen, others: new FormData(form).get('others') === 'quiet' ? 0.35 : 0 } })
			},
		}, 'Übernehmen'),
	])
}
