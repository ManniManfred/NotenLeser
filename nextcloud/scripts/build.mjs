// Bundles the Nextcloud app scripts into js/ and copies the pdf.js worker next to them.
import { build, context } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const watch = process.argv.includes('--watch')

const options = {
	absWorkingDir: root,
	entryPoints: {
		'notenleser-main': 'src/nextcloud/main.js',
		'notenleser-files': 'src/nextcloud/files.js',
		'notenleser-standalone': 'src/standalone/main.js',
	},
	outdir: 'js',
	bundle: true,
	format: 'iife',
	target: ['es2022'],
	minify: !watch,
	sourcemap: true,
	legalComments: 'linked',
	logLevel: 'info',
}

mkdirSync(join(root, 'js'), { recursive: true })
// Served with a .js extension because not every web server knows the .mjs MIME type.
copyFileSync(join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), join(root, 'js/pdf.worker.js'))

if (watch) {
	const ctx = await context(options)
	await ctx.watch()
} else {
	await build(options)
}
