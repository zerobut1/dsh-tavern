import { build } from 'esbuild'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output = new URL('../../lib/mobile-assets/', import.meta.url)
await mkdir(output, { recursive: true })
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: [fileURLToPath(new URL('./main.tsx', import.meta.url))],
  outfile: fileURLToPath(new URL('mobile.js', output)),
  bundle: true, minify: true, format: 'esm', jsx: 'automatic', target: ['safari16'],
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked',
})
const legalFile = new URL('mobile.js.LEGAL.txt', output)
await writeFile(legalFile, (await readFile(legalFile, 'utf8')).replace(/^[\t ]+/gm, '').trimEnd() + '\n')
await copyFile(new URL('./LICENSE.assistant-ui', import.meta.url), new URL('LICENSE.assistant-ui', output))
await writeFile(new URL('index.html', output), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark"><meta name="apple-mobile-web-app-capable" content="yes">
<title>DSH Tavern</title><link rel="stylesheet" href="/mobile/mobile.css">
</head><body><div id="root"></div><script type="module" src="/mobile/mobile.js"></script></body></html>`)
