import fs from 'node:fs'
import path from 'node:path'
import type { CompletionStatus, DemoStatus } from '@shared/types'
import { artUrlFor } from './artwork.ts'
import type { Db } from './db.ts'
import { addEmulator, removeEmulator } from './emulators.ts'
import { createCollection, removeCollection } from './library.ts'
import { deleteGame, insertGame } from './repo.ts'

export type { DemoStatus }

const hoursAgo = (h: number): string => new Date(Date.now() - h * 3600_000).toISOString()
const daysAgo = (d: number): string => hoursAgo(d * 24)

const PALETTES: Array<[string, string, string]> = [
  ['#3b0f16', '#8f1d2c', '#D71935'],
  ['#0e1a2b', '#1d4e89', '#4aa3ff'],
  ['#1c1030', '#5b2b9e', '#9d6bff'],
  ['#0d2620', '#14705c', '#2dd4a7'],
  ['#2b1608', '#9a5b13', '#f5a524'],
  ['#250b26', '#7c1d6e', '#e14eca']
]

function coverSvg(title: string, index: number): string {
  const [dark, mid, accent] = PALETTES[index % PALETTES.length]
  const initials = title
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
<rect width="600" height="900" fill="url(#g)"/>
<circle cx="520" cy="120" r="220" fill="${accent}" opacity="0.28"/>
<circle cx="80" cy="800" r="180" fill="#ffffff" opacity="0.07"/>
<rect x="-120" y="560" width="420" height="90" rx="8" fill="${accent}" opacity="0.85" transform="rotate(-24 90 605)"/>
<rect x="-120" y="668" width="300" height="26" rx="6" fill="#ffffff" opacity="0.25" transform="rotate(-24 30 681)"/>
<circle cx="300" cy="330" r="120" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="10"/>
<circle cx="300" cy="330" r="120" fill="${accent}" opacity="0.25"/>
<text x="300" y="368" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="96" font-weight="900" fill="#ffffff" opacity="0.9">${initials}</text>
<text x="48" y="800" font-family="Arial,Helvetica,sans-serif" font-size="44" font-weight="900" fill="#ffffff">${title.replace(/&/g, '&amp;').slice(0, 22)}</text>
<text x="48" y="844" font-family="Arial,Helvetica,sans-serif" font-size="22" letter-spacing="6" fill="#ffffff" opacity="0.6">JOYFRAME</text>
</svg>`
}

function backdropSvg(index: number): string {
  const [dark, mid, accent] = PALETTES[index % PALETTES.length]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><radialGradient id="r" cx="0.75" cy="0.3" r="1">
<stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></radialGradient></defs>
<rect width="1280" height="720" fill="url(#r)"/>
<circle cx="1020" cy="180" r="300" fill="${accent}" opacity="0.35"/>
<circle cx="180" cy="640" r="220" fill="#ffffff" opacity="0.05"/>
<rect x="880" y="-80" width="140" height="900" fill="${accent}" opacity="0.5" transform="rotate(18 950 370)"/>
<rect x="1060" y="-80" width="40" height="900" fill="#ffffff" opacity="0.18" transform="rotate(18 1080 370)"/>
</svg>`
}

interface DemoGame {
  title: string
  platformId: string
  source: 'steam' | 'pc-scan' | 'rom-scan' | 'manual'
  genres: string[]
  year: number
  developer: string
  publisher: string
  description: string
  playtimeSeconds: number
  playCount: number
  lastPlayed: string
  addedDaysAgo: number
  favorite?: boolean
  completion?: CompletionStatus
  rating?: number
  hidden?: boolean
  installed?: boolean
  notes?: string
}

const GAMES: DemoGame[] = [
  {
    title: 'Hades', platformId: 'windows', source: 'pc-scan', genres: ['Action', 'Roguelike'],
    year: 2020, developer: 'Supergiant Games', publisher: 'Supergiant Games',
    description: 'Defy the god of the dead as Zagreus, Prince of the Underworld, in this rogue-like dungeon crawler where every escape attempt makes you stronger.',
    playtimeSeconds: 7260, playCount: 14, lastPlayed: hoursAgo(5), addedDaysAgo: 40,
    favorite: true, completion: 'in-progress', rating: 92, notes: 'Heat 8 run in progress — fists aspect of Demeter.'
  },
  {
    title: 'Hollow Knight', platformId: 'windows', source: 'pc-scan', genres: ['Action', 'Metroidvania'],
    year: 2017, developer: 'Team Cherry', publisher: 'Team Cherry',
    description: 'Explore the vast, ruined kingdom of Hallownest in a hand-drawn action adventure with tight combat and deep secrets.',
    playtimeSeconds: 54000, playCount: 22, lastPlayed: daysAgo(2), addedDaysAgo: 120,
    favorite: true, completion: 'completed', rating: 92
  },
  {
    title: 'Celeste', platformId: 'windows', source: 'pc-scan', genres: ['Platformer'],
    year: 2018, developer: 'Maddy Makes Games', publisher: 'Maddy Makes Games',
    description: 'Help Madeline survive her inner demons on her journey to the top of Celeste Mountain in this tight, heartfelt platformer.',
    playtimeSeconds: 21600, playCount: 9, lastPlayed: daysAgo(9), addedDaysAgo: 200,
    completion: 'completed', rating: 92
  },
  {
    title: 'The Witcher 3: Wild Hunt', platformId: 'windows', source: 'steam', genres: ['RPG', 'Adventure'],
    year: 2015, developer: 'CD PROJEKT RED', publisher: 'CD PROJEKT RED',
    description: 'You are Geralt of Rivia, mercenary monster slayer, searching for the child of prophecy across a war-torn open world.',
    playtimeSeconds: 452300, playCount: 61, lastPlayed: hoursAgo(30), addedDaysAgo: 300,
    favorite: true, completion: 'in-progress', rating: 92
  },
  {
    title: 'Stardew Valley', platformId: 'windows', source: 'steam', genres: ['Simulation', 'RPG'],
    year: 2016, developer: 'ConcernedApe', publisher: 'ConcernedApe',
    description: 'Inherit a farm, grow crops, raise animals, mine, fish and befriend the townsfolk in this cozy farming RPG.',
    playtimeSeconds: 173400, playCount: 45, lastPlayed: daysAgo(4), addedDaysAgo: 250,
    completion: 'in-progress', rating: 81
  },
  {
    title: 'Elden Ring', platformId: 'windows', source: 'manual', genres: ['RPG', 'Action'],
    year: 2022, developer: 'FromSoftware', publisher: 'Bandai Namco',
    description: 'Rise, Tarnished, and be guided by grace to brandish the power of the Elden Ring in the Lands Between.',
    playtimeSeconds: 0, playCount: 0, lastPlayed: '', addedDaysAgo: 1, installed: false
  },
  {
    title: 'Forza Horizon 5', platformId: 'windows', source: 'steam', genres: ['Racing'],
    year: 2021, developer: 'Playground Games', publisher: 'Xbox Game Studios',
    description: 'Explore the vibrant landscapes of Mexico in the ultimate Horizon adventure with hundreds of cars.',
    playtimeSeconds: 34200, playCount: 18, lastPlayed: daysAgo(6), addedDaysAgo: 90,
    completion: 'in-progress', rating: 81
  },
  {
    title: 'Street Fighter 6', platformId: 'windows', source: 'steam', genres: ['Fighting'],
    year: 2023, developer: 'Capcom', publisher: 'Capcom',
    description: 'The next evolution of fighting games with new modes, a fleshed-out roster and modern controls.',
    playtimeSeconds: 9800, playCount: 12, lastPlayed: daysAgo(12), addedDaysAgo: 60, rating: 81
  },
  {
    title: 'Team Fortress 2', platformId: 'windows', source: 'steam', genres: ['Shooter'],
    year: 2007, developer: 'Valve', publisher: 'Valve',
    description: 'Nine distinct classes in the most team-oriented free-to-play shooter on PC.',
    playtimeSeconds: 7200, playCount: 30, lastPlayed: daysAgo(60), addedDaysAgo: 400,
    completion: 'abandoned', rating: 68
  },
  {
    title: 'Chrono Trigger', platformId: 'snes', source: 'rom-scan', genres: ['RPG'],
    year: 1995, developer: 'Square', publisher: 'Square',
    description: 'A time-traveling RPG masterpiece from the dream team of Sakaguchi, Horii and Toriyama.',
    playtimeSeconds: 68400, playCount: 3, lastPlayed: daysAgo(20), addedDaysAgo: 150,
    favorite: true, completion: 'completed', rating: 92
  },
  {
    title: 'Super Mario Bros.', platformId: 'nes', source: 'rom-scan', genres: ['Platformer'],
    year: 1985, developer: 'Nintendo', publisher: 'Nintendo',
    description: 'The platformer that defined a generation. Rescue Princess Peach across 32 stages.',
    playtimeSeconds: 1800, playCount: 2, lastPlayed: daysAgo(45), addedDaysAgo: 150, rating: 81
  },
  {
    title: 'Pokemon Emerald', platformId: 'gba', source: 'rom-scan', genres: ['RPG'],
    year: 2004, developer: 'Game Freak', publisher: 'Nintendo',
    description: 'Explore Hoenn, battle Gym Leaders and stop Team Aqua and Team Magma in the definitive Gen III adventure.',
    playtimeSeconds: 126000, playCount: 5, lastPlayed: daysAgo(3), addedDaysAgo: 140,
    completion: 'in-progress', rating: 92
  },
  {
    title: 'Shadow of the Colossus', platformId: 'ps2', source: 'rom-scan', genres: ['Action', 'Adventure'],
    year: 2005, developer: 'Team Ico', publisher: 'Sony Computer Entertainment',
    description: 'Sixteen colossi roam a forbidden land. Fell them all to bring a soul back to life.',
    playtimeSeconds: 21600, playCount: 4, lastPlayed: daysAgo(15), addedDaysAgo: 130,
    completion: 'completed', rating: 92
  },
  {
    title: 'Final Fantasy VII', platformId: 'ps1', source: 'rom-scan', genres: ['RPG'],
    year: 1997, developer: 'Square', publisher: 'Square',
    description: 'Cloud Strife joins AVALANCHE to fight the Shinra corporation in the RPG that brought the genre west.',
    playtimeSeconds: 145800, playCount: 2, lastPlayed: daysAgo(33), addedDaysAgo: 160,
    favorite: true, completion: 'completed', rating: 92
  },
  {
    title: 'Big Rigs: Over the Road Racing', platformId: 'windows', source: 'manual', genres: ['Racing'],
    year: 2003, developer: 'Stellar Stone', publisher: 'GameMill',
    description: 'Kept around as a cautionary tale. Hidden from the library.',
    playtimeSeconds: 300, playCount: 1, lastPlayed: daysAgo(200), addedDaysAgo: 210, hidden: true, rating: 22
  }
]

const ROM_FILES: Record<string, string> = {
  'Chrono Trigger': 'snes/Chrono Trigger.sfc',
  'Super Mario Bros.': 'nes/Super Mario Bros.nes',
  'Pokemon Emerald': 'gba/Pokemon Emerald.gba',
  'Shadow of the Colossus': 'ps2/Shadow of the Colossus.iso',
  'Final Fantasy VII': 'ps1/Final Fantasy VII.cue'
}

function track(db: Db, kind: string, id: string): void {
  db.prepare('INSERT OR IGNORE INTO demo_seed (kind, id) VALUES (?, ?)').run(kind, id)
}

export function demoStatus(db: Db): DemoStatus {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'demo_seed'")
    .get() as { name?: string } | undefined
  if (!tables) return { installed: false, games: 0, collections: 0, emulators: 0 }
  const count = (kind: string): number =>
    (db.prepare('SELECT COUNT(*) AS c FROM demo_seed WHERE kind = ?').get(kind) as { c: number }).c
  const games = count('game')
  return {
    installed: games > 0,
    games,
    collections: count('collection'),
    emulators: count('emulator')
  }
}

/** Delete every row the demo seeder created (games, collections, emulator, artwork, placeholder files). */
export function removeDemoLibrary(db: Db, userDataDir: string, artworkDir: string): DemoStatus {
  db.prepare('CREATE TABLE IF NOT EXISTS demo_seed (kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (kind, id))').run()
  const rows = (() => {
    try {
      return db.prepare('SELECT kind, id FROM demo_seed').all() as Array<{ kind: string; id: string }>
    } catch {
      return []
    }
  })()
  for (const row of rows) {
    try {
      if (row.kind === 'game') deleteGame(db, row.id)
      else if (row.kind === 'collection') removeCollection(db, row.id)
      else if (row.kind === 'emulator') removeEmulator(db, row.id)
      else if (row.kind === 'artwork') fs.rmSync(path.join(artworkDir, row.id), { force: true })
    } catch {
      /* best-effort: keep removing the rest */
    }
  }
  db.prepare('DELETE FROM demo_seed').run()
  fs.rmSync(path.join(userDataDir, 'demo'), { recursive: true, force: true })
  return demoStatus(db)
}

/**
 * Seed a realistic multi-platform demo library (15 games, 1 emulator,
 * 2 collections, spread-out playtime). Idempotent: clears any previous demo
 * content first. Demo executables and ROMs are placeholders, clearly labelled.
 */
export function seedDemoLibrary(db: Db, userDataDir: string, artworkDir: string): DemoStatus {
  removeDemoLibrary(db, userDataDir, artworkDir)
  db.prepare('CREATE TABLE IF NOT EXISTS demo_seed (kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (kind, id))').run()
  fs.mkdirSync(artworkDir, { recursive: true })

  const art = (kind: 'cover' | 'bg', title: string, index: number): string => {
    const file = `demo-${kind}-${index}.svg`
    fs.writeFileSync(path.join(artworkDir, file), kind === 'cover' ? coverSvg(title, index) : backdropSvg(index))
    track(db, 'artwork', file)
    return artUrlFor(file)
  }

  // Placeholder emulator install + ROMs (clearly demo content, replaced on real setup).
  const demoDir = path.join(userDataDir, 'demo')
  const emuDir = path.join(demoDir, 'emulators', 'RetroArch')
  fs.mkdirSync(path.join(emuDir, 'cores'), { recursive: true })
  fs.writeFileSync(path.join(emuDir, 'retroarch.exe'), 'JOYFRAME demo placeholder — replace with a real emulator')
  fs.writeFileSync(path.join(emuDir, 'cores', 'snes9x_placeholder.txt'), 'demo placeholder')
  const romsDir = path.join(demoDir, 'roms')
  const romPathFor = (title: string): string => {
    const rel = ROM_FILES[title]
    if (!rel) return ''
    const full = path.join(romsDir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    if (!fs.existsSync(full)) fs.writeFileSync(full, 'JOYFRAME demo placeholder ROM')
    return full
  }

  const retroarch = addEmulator(db, {
    name: 'RetroArch (demo)',
    path: path.join(emuDir, 'retroarch.exe'),
    platformIds: ['snes', 'nes', 'gba', 'ps1', 'ps2'],
    argsTemplate: '-L "{core}" "{rom}"',
    coreDir: path.join(emuDir, 'cores'),
    saveStateDir: path.join(emuDir, 'states')
  })
  track(db, 'emulator', retroarch.id)

  const inserted = GAMES.map((g, index) =>
    insertGame(db, {
      ...(g.source === 'rom-scan' ? { emulatorId: retroarch.id, romPath: romPathFor(g.title) } : {}),
      title: g.title,
      platformId: g.platformId,
      source: g.source,
      sourceId: g.source === 'steam' ? `demo-${index}` : '',
      genres: g.genres,
      releaseYear: g.year,
      releaseDate: `${g.year}-01-01`,
      developer: g.developer,
      publisher: g.publisher,
      description: g.description,
      playtimeSeconds: g.playtimeSeconds,
      playCount: g.playCount,
      lastPlayed: g.lastPlayed,
      addedAt: daysAgo(g.addedDaysAgo),
      favorite: g.favorite,
      completion: g.completion ?? (g.playCount > 0 ? 'in-progress' : 'unplayed'),
      hidden: g.hidden,
      installed: g.installed,
      rating: g.rating,
      coverPath: art('cover', g.title, index),
      backgroundPath: art('bg', g.title, index),
      metadataProvider: 'demo-seed',
      metadataConfidence: 0.9,
      notes: g.notes ?? '',
      extra: {
        demoSeed: true,
        ...(index === 0 ? { controllerProfile: 'Xbox 360 Controller', resolution: '2560x1440' } : {}),
        // Hades was enriched long ago so the stale-metadata reminder shows; the rest are fresh.
        metadataUpdatedAt: index === 0 ? daysAgo(45) : hoursAgo(10)
      }
    })
  )
  for (const game of inserted) track(db, 'game', game.id)

  const byTitle = (title: string): string => inserted.find((g) => g.title === title)!.id
  const childhood = createCollection(db, {
    name: 'Childhood Favorites (demo)',
    description: 'The games that raised us.',
    gameIds: [byTitle('Chrono Trigger'), byTitle('Super Mario Bros.'), byTitle('Pokemon Emerald'), byTitle('Final Fantasy VII')]
  })
  track(db, 'collection', childhood.id)
  const rpgs = createCollection(db, {
    name: 'RPG Shelf (demo)',
    description: 'Every role-playing epic, auto-collected.',
    kind: 'smart',
    rule: { field: 'genre', op: 'contains', value: 'RPG' }
  })
  track(db, 'collection', rpgs.id)

  return demoStatus(db)
}
