import fs from 'node:fs'
import path from 'node:path'

export const ART_SCHEME = 'jf-art'

export function artUrlFor(fileName: string): string {
  return `${ART_SCHEME}://local/${encodeURIComponent(fileName)}`
}

/** Map a jf-art:// URL back to an absolute file inside the artwork cache. */
export function resolveArtworkPath(artworkDir: string, url: string): string | null {
  if (!url.startsWith(`${ART_SCHEME}://`)) return null
  try {
    const parsed = new URL(url)
    const fileName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
    const resolved = path.resolve(artworkDir, fileName)
    if (!resolved.startsWith(path.resolve(artworkDir))) return null
    return resolved
  } catch {
    return null
  }
}

function safeBase(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)
}

function extensionFor(url: string, contentType: string): string {
  const fromType = contentType.split(';')[0]?.trim().toLowerCase()
  if (fromType === 'image/png') return 'png'
  if (fromType === 'image/webp') return 'webp'
  if (fromType === 'image/gif') return 'gif'
  const ext = path.extname(new URL(url, 'https://x/').pathname).replace('.', '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext
  return 'jpg'
}

/**
 * Download an image into the local artwork cache. Returns a jf-art:// URL, or
 * an empty string when the image cannot be fetched so callers can keep remote
 * URLs as an online-only fallback.
 */
export async function cacheImage(artworkDir: string, url: string, baseName: string): Promise<string> {
  if (!url) return ''
  if (url.startsWith(`${ART_SCHEME}://`)) return url
  if (!/^https?:\/\//i.test(url)) return ''
  fs.mkdirSync(artworkDir, { recursive: true })
  const safe = safeBase(baseName)

  const existing = fs
    .readdirSync(artworkDir)
    .find((file) => file.startsWith(`${safe}.`) && fs.statSync(path.join(artworkDir, file)).size > 500)
  if (existing) return artUrlFor(existing)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'JOYFRAME/1.0 (desktop game launcher)',
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*'
      }
    })
    clearTimeout(timer)
    if (!response.ok) return ''
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !contentType.startsWith('image/')) return ''
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 200) return ''
    const fileName = `${safe}.${extensionFor(url, contentType)}`
    fs.writeFileSync(path.join(artworkDir, fileName), buffer)
    return artUrlFor(fileName)
  } catch {
    return ''
  }
}

/** Copy a user-selected local image into the artwork cache. */
export function copyLocalArtwork(artworkDir: string, sourceFile: string, baseName: string): string {
  if (!fs.existsSync(sourceFile)) throw new Error('Artwork file not found')
  const stat = fs.statSync(sourceFile)
  if (!stat.isFile()) throw new Error('Artwork must be a file')
  if (stat.size > 25 * 1024 * 1024) throw new Error('Artwork is larger than 25 MB')
  const ext = path.extname(sourceFile).replace('.', '').toLowerCase() || 'jpg'
  if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) throw new Error('Unsupported image format')
  fs.mkdirSync(artworkDir, { recursive: true })
  const fileName = `${safeBase(baseName)}.${ext === 'jpeg' ? 'jpg' : ext}`
  fs.copyFileSync(sourceFile, path.join(artworkDir, fileName))
  return artUrlFor(fileName)
}

export function pruneArtwork(artworkDir: string, referenced: Set<string>): number {
  if (!fs.existsSync(artworkDir)) return 0
  let removed = 0
  for (const file of fs.readdirSync(artworkDir)) {
    const url = artUrlFor(file)
    if (!referenced.has(url)) {
      try {
        fs.unlinkSync(path.join(artworkDir, file))
        removed += 1
      } catch {
        /* ignore locked files */
      }
    }
  }
  return removed
}
