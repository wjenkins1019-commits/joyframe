import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

/**
 * Render the brand PNG/ICO assets from the tracked SVGs.
 *
 *   npm run icons            # write resources/*.png and resources/icon.ico
 *   npm run verify:icons     # prove what is committed still matches the SVGs
 *
 * The renders are committed rather than ignored: `resources/icon-512.png` is the
 * window icon at runtime (`app.getAppPath()`), electron-builder reads
 * `icon.ico`/`icon-512.png` to package, and `npm run dev` needs them on a fresh
 * clone — none of which can wait for someone to run a generator. Committing
 * generated files only stays honest if drift is impossible to miss, so `--check`
 * renders into a throwaway directory and compares byte for byte, naming every
 * file that no longer matches its source. `npm run dist` runs it first, so a
 * missing or stale icon fails with the remedy instead of packaging the default
 * Electron one.
 */
const CHECK = process.argv.includes('--check')
const resources = path.join(process.cwd(), 'resources')
const outDir = CHECK ? fs.mkdtempSync(path.join(os.tmpdir(), 'jf-icons-')) : resources

/** Which SVG each output comes from, for the message when one has drifted. */
const SOURCE = { 'icon.ico': 'icon.svg', 'logo-wordmark.png': 'logo-wordmark.svg', 'splash.png': 'splash.svg' }
const sourceOf = (name) => SOURCE[name] ?? 'icon.svg'

const SIZES = [512, 256, 128, 64, 32, 16]
const produced = new Map()

function render(svgName, width, outName) {
  const svg = fs.readFileSync(path.join(resources, svgName), 'utf8')
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)'
  })
  const png = resvg.render().asPng()
  fs.writeFileSync(path.join(outDir, outName), png)
  produced.set(outName, png)
  if (!CHECK) console.log(`rendered ${outName} (${width}px, ${Math.round(png.length / 1024)} KB)`)
  return path.join(outDir, outName)
}

const pngs = SIZES.map((size) => render('icon.svg', size, `icon-${size}.png`))
render('logo-wordmark.svg', 1200, 'logo-wordmark.png')
render('splash.svg', 1920, 'splash.png')

// NSIS rejects an ICO holding anything above 256px or duplicate entries, so
// the 512px render (used by the mac/linux targets) stays out of the Windows icon.
const ico = await pngToIco(pngs.filter((_, index) => SIZES[index] <= 256))
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)
produced.set('icon.ico', ico)
if (!CHECK) console.log(`wrote icon.ico (${Math.round(ico.length / 1024)} KB)`)

if (CHECK) {
  const problems = []
  for (const [name, expected] of produced) {
    const file = path.join(resources, name)
    let current = null
    try {
      current = fs.readFileSync(file)
    } catch {
      problems.push(`resources/${name} is missing — it is committed, so this checkout is incomplete`)
      continue
    }
    if (!current.equals(expected)) {
      problems.push(`resources/${name} does not match resources/${sourceOf(name)}`)
    }
  }
  fs.rmSync(outDir, { recursive: true, force: true })

  if (problems.length) {
    console.log(`FAIL  ${problems.length} of ${produced.size} brand assets are not what the SVGs produce:`)
    for (const problem of problems) console.log(`  ${problem}`)
    console.log('\nRun `npm run icons` and commit the result, then retry.')
    process.exit(1)
  }
  console.log(`PASS  all ${produced.size} brand assets match the SVGs they are rendered from`)
}
