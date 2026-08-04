/**
 * Renders og/og.html to public/og.png (1200×630) with headless Chrome.
 *
 * Run from the repo root or anywhere:  node apps/checkmath/og/render.mjs
 *
 * Kept as a one-off script rather than a build step: the card is static, so
 * it only needs regenerating when og.html itself changes, and wiring headless
 * Chrome into `vite build` would make Vercel deploys depend on a browser
 * binary being present.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, 'og.html')
const outDir = resolve(here, '..', 'public')
const outFile = join(outDir, 'og.png')

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

const chrome = CHROME_CANDIDATES.find(existsSync)
if (!chrome) {
  console.error('No Chrome/Chromium binary found. Tried:\n  ' + CHROME_CANDIDATES.join('\n  '))
  process.exit(1)
}

// Chrome writes the screenshot relative to cwd, so render into a scratch dir
// and move the result rather than polluting whatever directory this ran from.
const scratch = join(tmpdir(), `checkmath-og-${process.pid}`)
mkdirSync(scratch, { recursive: true })

try {
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1200,630',
      '--screenshot=og.png',
      `file://${source}`,
    ],
    { cwd: scratch, stdio: 'ignore' },
  )

  mkdirSync(outDir, { recursive: true })
  renameSync(join(scratch, 'og.png'), outFile)
  console.log(`Wrote ${outFile}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
