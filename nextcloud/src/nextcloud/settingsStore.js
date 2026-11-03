import { getRequestToken } from '@nextcloud/auth'
import { loadState } from '@nextcloud/initial-state'
import { generateUrl } from '@nextcloud/router'
import { DEFAULT_SETTINGS } from '../web/settings.js'

export { DEFAULT_SETTINGS }


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
