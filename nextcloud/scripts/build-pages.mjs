// Builds the server-less web version for GitHub Pages into dist-pages/.
import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist-pages')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'js'), { recursive: true })
await build({
	absWorkingDir: root,
	entryPoints: { 'notenleser-pages': 'src/pages/main.js' },
	outdir: join(out, 'js'),
	bundle: true,
	format: 'iife',
	target: ['es2022'],
	minify: true,
	legalComments: 'linked',
	define: { __VERSION__: JSON.stringify(version) },
	logLevel: 'info',
})
cpSync(join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), join(out, 'js/pdf.worker.js'))
cpSync(join(root, 'css/notenleser.css'), join(out, 'css/notenleser.css'))
cpSync(join(root, 'fonts'), join(out, 'fonts'), { recursive: true })
for (const icon of ['icon-180.png', 'icon-192.png', 'icon-512.png']) cpSync(join(root, 'img', icon), join(out, 'img', icon))
for (const file of ['index.html', 'manifest.webmanifest']) cpSync(join(root, 'pages', file), join(out, file))
cpSync(join(root, 'pages/demo'), join(out, 'demo'), { recursive: true })
writeFileSync(join(out, '.nojekyll'), '')
for (const file of ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'LICENSES']) cpSync(join(root, '..', file), join(out, file), { recursive: true })

// The service worker caches every app file except the examples, which are fetched on demand.
const files = []
const walk = dir => {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) walk(full)
		else files.push(relative(out, full).split('\\').join('/'))
	}
}
walk(out)
const cached = ['./', ...files.filter(f => !f.startsWith('demo/') && !f.startsWith('.') && !f.startsWith('LICENSE') && !f.startsWith('THIRD-PARTY') && f !== 'index.html')]
const worker = readFileSync(join(root, 'pages/sw.js'), 'utf8')
	.replace('__BUILD__', version + '-' + Date.now().toString(36))
	.replace('__FILES__', JSON.stringify(cached))
writeFileSync(join(out, 'sw.js'), worker)
console.log(`dist-pages/ fertig (${files.length + 1} Dateien)`)
