import fs from 'node:fs'
import path from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const root = process.cwd()
const resources = path.join(root, 'resources')

function render(svgName, width, outName) {
  const svg = fs.readFileSync(path.join(resources, svgName), 'utf8')
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)'
  })
  const png = resvg.render().asPng()
  const target = path.join(resources, outName)
  fs.writeFileSync(target, png)
  console.log(`rendered ${outName} (${width}px, ${Math.round(png.length / 1024)} KB)`)
  return target
}

const sizes = [512, 256, 128, 64, 32, 16]
const pngs = sizes.map((size) => render('icon.svg', size, `icon-${size}.png`))
render('logo-wordmark.svg', 1200, 'logo-wordmark.png')
render('splash.svg', 1920, 'splash.png')

// NSIS rejects an ICO holding anything above 256px or duplicate entries, so
// the 512px render (used by the mac/linux targets) stays out of the Windows icon.
const ico = await pngToIco(pngs.filter((_, index) => sizes[index] <= 256))
fs.writeFileSync(path.join(resources, 'icon.ico'), ico)
console.log(`wrote icon.ico (${Math.round(ico.length / 1024)} KB)`)
