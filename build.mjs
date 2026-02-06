import * as esbuild from 'esbuild'
import { cpSync, mkdirSync } from 'fs'

const watch = process.argv.includes('--watch')

const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: 'chrome120',
  format: 'esm',
}

const entryPoints = [
  {
    entryPoints: ['src/content/index.ts'],
    outfile: 'dist/content.js',
    // Content scripts must be IIFE — Chrome doesn't support ES modules for content scripts
    format: 'iife',
  },
  {
    entryPoints: ['src/background/service-worker.ts'],
    outfile: 'dist/service-worker.js',
  },
  {
    entryPoints: ['src/popup/popup.ts'],
    outfile: 'dist/popup.js',
  },
  {
    entryPoints: ['src/offscreen/offscreen.ts'],
    outfile: 'dist/offscreen.js',
  },
]

// Copy static assets
mkdirSync('dist', { recursive: true })
cpSync('manifest.json', 'dist/manifest.json')
cpSync('assets', 'dist/assets', { recursive: true })
cpSync('src/popup/popup.html', 'dist/popup.html')
cpSync('src/popup/popup.css', 'dist/popup.css')
cpSync('src/offscreen/offscreen.html', 'dist/offscreen.html')

if (watch) {
  const contexts = await Promise.all(
    entryPoints.map((ep) =>
      esbuild.context({ ...commonOptions, ...ep })
    )
  )
  await Promise.all(contexts.map((ctx) => ctx.watch()))
  console.log('Watching for changes...')
} else {
  await Promise.all(
    entryPoints.map((ep) =>
      esbuild.build({ ...commonOptions, ...ep })
    )
  )
  console.log('Build complete.')
}
