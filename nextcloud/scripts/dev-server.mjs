// Serves the standalone reader and a small file API for a local folder of scores:
//   node scripts/dev-server.mjs <folder> [port]
import { createServer } from 'node:http'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const library = resolve(process.argv[2] || join(root, 'tests/fixtures'))
const port = Number(process.argv[3] || 8085)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf', '.map': 'application/json', '.svg': 'image/svg+xml' }

function inLibrary(path) {
	const full = resolve(library, '.' + normalize('/' + (path || '/')))
	if (full !== library && !full.startsWith(library + sep)) throw new Error('outside')
	return full
}

createServer(async (request, response) => {
	const url = new URL(request.url, 'http://localhost')
	try {
		if (url.pathname === '/api/list') {
			const folder = url.searchParams.get('path') || '/'
			const entries = await readdir(inLibrary(folder), { withFileTypes: true })
			const list = entries.filter(e => !e.name.startsWith('.')).map(e => ({
				name: e.name, path: (folder === '/' ? '' : folder.replace(/\/$/, '')) + '/' + e.name, isDir: e.isDirectory(),
			})).sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'de', { numeric: true }) : a.isDir ? -1 : 1))
			response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(list))
		} else if (url.pathname === '/api/file') {
			const file = inLibrary(url.searchParams.get('path'))
			if (request.method === 'PUT') {
				const chunks = []
				for await (const chunk of request) chunks.push(chunk)
				await writeFile(file, Buffer.concat(chunks))
				response.writeHead(204).end()
			} else {
				const data = await readFile(file)
				response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(data)
			}
		} else {
			const path = url.pathname === '/' ? '/dev/index.html' : url.pathname
			const candidates = [join(root, path), join(root, 'dev', path)]
			for (const candidate of candidates) {
				if (!candidate.startsWith(root)) continue
				const info = await stat(candidate).catch(() => null)
				if (info && info.isFile()) {
					const data = await readFile(candidate)
					response.writeHead(200, { 'Content-Type': types[extname(candidate)] || 'application/octet-stream' }).end(data)
					return
				}
			}
			response.writeHead(404).end('not found')
		}
	} catch (e) {
		if (!response.headersSent) response.writeHead(e.code === 'ENOENT' ? 404 : 400).end(String(e.message))
	}
}).listen(port, () => console.log(`NotenLeser: http://localhost:${port}/  (Noten aus ${library})`))
