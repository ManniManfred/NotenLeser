import { getRequestToken } from '@nextcloud/auth'
import { loadState } from '@nextcloud/initial-state'
import { generateUrl } from '@nextcloud/router'

export const DEFAULT_SETTINGS = {
	voice: 0,
	twoSystemsMinimum: false,
	autoFullscreen: true,
	cameraGestures: false,
	cameraSensitivity: 0,
	cameraDebug: false,
	playbackSpeed: 100,
	lastFile: '',
	lastFolder: '',
}

/** Reader settings stored as Nextcloud user preferences, so they follow the user to every device. */
export class NextcloudSettingsStore {
	load() {
		return { ...DEFAULT_SETTINGS, ...loadState('notenleser', 'settings', {}) }
	}

	async save(values) {
		const response = await fetch(generateUrl('/apps/notenleser/settings'), {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', requesttoken: getRequestToken() || '' },
			body: JSON.stringify({ settings: values }),
		})
		if (!response.ok) throw new Error(`Einstellungen konnten nicht gespeichert werden (HTTP ${response.status})`)
	}
}
