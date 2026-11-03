// Keeps the NotenLeser usable offline: app files are served from the cache and refreshed in the background.
const CACHE = 'notenleser-__BUILD__'
const FILES = __FILES__

self.addEventListener('install', event => {
	event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
	event.waitUntil(caches.keys()
		.then(keys => Promise.all(keys.filter(key => key.startsWith('notenleser-') && key !== CACHE).map(key => caches.delete(key))))
		.then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
	const request = event.request
	if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return
	event.respondWith(caches.open(CACHE).then(async cache => {
		const cached = await cache.match(request, { ignoreSearch: true })
		const network = fetch(request).then(response => {
			if (response.ok) cache.put(request, response.clone())
			return response
		}).catch(() => cached)
		return cached || network
	}))
})
