import { useEffect, useState } from 'react'
import { EyeOff, FolderOpen, Heart, Image as ImageIcon, Layers, Pencil, Play, RefreshCw, Square, X } from 'lucide-react'
import type { ArtworkCandidate, GameSave } from '@shared/types'
import type { MethodForm, ProfileState } from './GameDetailCards'
import { api, errorMessage } from '../lib/api'
import { starsFor } from '../lib/format'
import { useFocusReturn } from '../lib/navigation'
import { useStore } from '../state/store'
import { Backdrop, Cover, GameLogo } from './Art'
import { GameEditor } from './GameEditor'
import { DetailCards } from './GameDetailCards'
import { DetailModals } from './GameDetailModals'
import { StreamVideo, TrailerOverlay } from './VideoPlayer'
import { Badge, Button, GlassButton, IconButton, Spinner, cx } from './ui'

export function GameDetail(): React.JSX.Element | null {
  const detailId = useStore((state) => state.detailId)
  const games = useStore((state) => state.games)
  const emulators = useStore((state) => state.emulators)
  const collections = useStore((state) => state.collections)
  const platforms = useStore((state) => state.platforms)
  const settings = useStore((state) => state.settings)
  const playState = useStore((state) => state.playState)
  const lastPlayed = useStore((state) => state.lastPlayed)
  const closeDetail = useStore((state) => state.closeDetail)
  const play = useStore((state) => state.play)
  const stopGame = useStore((state) => state.stopGame)
  const toggleFavorite = useStore((state) => state.toggleFavorite)
  const addPlaytime = useStore((state) => state.addPlaytime)
  const setCompletion = useStore((state) => state.setCompletion)
  const removeGame = useStore((state) => state.removeGame)
  const refresh = useStore((state) => state.refresh)
  const notify = useStore((state) => state.notify)

  const [saves, setSaves] = useState<GameSave[]>([])
  const [trailer, setTrailer] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [artworkOpen, setArtworkOpen] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [methodForm, setMethodForm] = useState<MethodForm | null>(null)
  const [profile, setProfile] = useState<ProfileState | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)
  const [candidates, setCandidates] = useState<ArtworkCandidate[]>([])
  const detailRef = useFocusReturn()

  const game = games.find((entry) => entry.id === detailId) ?? null

  useEffect(() => {
    if (!game) return
    api.saves
      .list(game.id)
      .then(setSaves)
      .catch(() => setSaves([]))
  }, [game?.id])

  useEffect(() => {
    if (!game) return
    setProfile({
      emulatorId: game.emulatorId ?? '',
      emulatorCore: game.emulatorCore,
      launchArgs: game.launchArgs,
      controllerProfile: String(game.extra.controllerProfile ?? ''),
      resolution: String(game.extra.resolution ?? ''),
      displayMode: String(game.extra.displayMode ?? ''),
      saveStateMode: (game.extra.saveStateMode as ProfileState['saveStateMode']) ?? 'none',
      saveStateSlot: String(game.extra.saveStateSlot ?? '')
    })
    setProfileSaved(false)
  }, [game?.id, game?.updatedAt])

  useEffect(() => {
    if (!artworkOpen || !game) return
    api.metadata
      .searchCandidates(game.id)
      .then(setCandidates)
      .catch(() => setCandidates([]))
  }, [artworkOpen, game?.id])

  if (!game) return null

  const running = playState.gameId === game.id && playState.state !== 'idle'
  const isResume = lastPlayed?.id === game.id
  // The refresh interval in Settings is honoured as a staleness threshold:
  // metadata older than the interval gets a visible reminder with one-click refresh.
  const refreshAfterDays = settings.metadataRefreshDays > 0 ? settings.metadataRefreshDays : 30
  const metadataUpdatedAt = typeof game.extra.metadataUpdatedAt === 'string' ? game.extra.metadataUpdatedAt : ''
  const stars = starsFor(game.rating)
  const isMetadataStale =
    Boolean(game.metadataProvider) &&
    Boolean(metadataUpdatedAt) &&
    Date.now() - new Date(metadataUpdatedAt).getTime() > refreshAfterDays * 86_400_000
  const platform = platforms.find((entry) => entry.id === game.platformId)
  const emulator = emulators.find((entry) => entry.id === game.emulatorId)
  const memberOf = collections.filter((collection) => collection.gameIds.includes(game.id))

  const refreshSaves = async (scan = false): Promise<void> => {
    if (!game) return
    setBusy(scan ? 'scan-saves' : 'load-saves')
    try {
      if (scan) {
        const result = await api.saves.scan()
        notify(`Indexed ${result.found} save files across your ROM library.`, 'success')
      }
      setSaves(await api.saves.list(game.id))
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const refreshMetadata = async (): Promise<void> => {
    setBusy('metadata')
    try {
      const result = await api.metadata.refresh(game.id)
      notify(result.message, result.ok ? 'success' : 'error')
      if (result.ok) await refresh()
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const applyArtwork = async (kind: ArtworkCandidate['kind'], url: string): Promise<void> => {
    setBusy('artwork')
    try {
      await api.metadata.setArtwork(game.id, kind, url)
      await refresh()
      notify('Artwork updated and cached locally.', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const applyLocalArtwork = async (kind: ArtworkCandidate['kind']): Promise<void> => {
    try {
      const updated = await api.metadata.pickLocalArtwork(game.id, kind)
      if (!updated) return
      await refresh()
      notify('Artwork imported.', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const saveProfile = async (): Promise<void> => {
    if (!profile) return
    setBusy('profile')
    try {
      await api.library.update(game.id, {
        emulatorId: profile.emulatorId || null,
        emulatorCore: profile.emulatorCore,
        launchArgs: profile.launchArgs,
        extra: {
          ...game.extra,
          controllerProfile: profile.controllerProfile,
          resolution: profile.resolution,
          displayMode: profile.displayMode,
          saveStateMode: profile.saveStateMode,
          saveStateSlot: profile.saveStateSlot
        }
      })
      await refresh()
      setProfileSaved(true)
      window.setTimeout(() => setProfileSaved(false), 2200)
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const addMethod = async (): Promise<void> => {
    if (!methodForm) return
    try {
      await api.library.addMethod(game.id, {
        label: methodForm.label || 'Launch method',
        kind: methodForm.kind,
        target: methodForm.target,
        args: methodForm.args,
        emulatorId: methodForm.emulatorId || null,
        core: methodForm.core,
        isDefault: game.launchMethods.length === 0
      })
      setMethodForm(null)
      await refresh()
      notify('Launch method added.', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const setDefaultMethod = async (methodId: string): Promise<void> => {
    try {
      await api.library.setDefaultMethod(methodId)
      await refresh()
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const removeMethod = async (methodId: string): Promise<void> => {
    try {
      await api.library.removeMethod(methodId)
      await refresh()
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const toggleCollection = async (collectionId: string): Promise<void> => {
    try {
      if (memberOf.some((collection) => collection.id === collectionId)) {
        await api.collections.removeGame(collectionId, game.id)
      } else {
        await api.collections.addGame(collectionId, game.id)
      }
      await refresh()
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const hideGame = async (): Promise<void> => {
    try {
      await api.library.setHidden(game.id, true)
      closeDetail()
      await refresh()
      notify(`${game.title} hidden. Re-enable hidden games in Settings to see it again.`)
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const revealFiles = (): void => {
    const target = game.executable || game.romPath || game.installDir
    if (!target) {
      notify('This game has no files on disk.', 'error')
      return
    }
    void api.system.revealPath(target)
  }

  return (
    <div
      ref={detailRef}
      data-jf-detail="1"
      className="jf-detail-enter fixed inset-0 z-[60] overflow-y-auto bg-[#141619]/95 backdrop-blur-xl"
    >
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-[520px] overflow-hidden">
          <Backdrop game={game} className="h-full w-full object-cover opacity-80" />
          {game.videoUrl && !settings.reduceMotion && (
            <StreamVideo
              key={game.id}
              url={game.videoUrl}
              className="absolute inset-0 h-full w-full object-cover opacity-80"
              autoPlay
              loop
              muted
              playsInline
            />
          )}
          <div className="absolute inset-0 jf-grad-detail" />
        </div>

        <div className="jf-detail-body relative z-10">
          <div className="flex items-center justify-between px-8 pt-6">
            <button
              data-nav="1"
              data-jf-layer-skip="1"
              onClick={closeDetail}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-black/40 px-3 py-1.5 text-[11px] font-semibold text-white/70 backdrop-blur transition hover:text-white"
            >
              ← Back to library
            </button>
            <IconButton label="Close details" data-jf-layer-skip="1" onClick={closeDetail}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="mx-auto max-w-[1180px] px-8 pb-8 pt-10">
            <div className="flex flex-col gap-7 md:flex-row md:items-end">
              <div className="hidden w-[210px] shrink-0 overflow-hidden rounded-xl border border-white/12 shadow-2xl md:block">
                <div style={{ aspectRatio: '2 / 3' }}>
                  <Cover game={game} />
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  {running && <Badge tone="red">Running now</Badge>}
                  {isResume && <Badge tone="red">Continue playing</Badge>}
                  {game.installed ? <Badge tone="green">Installed</Badge> : <Badge>Not installed</Badge>}
                  <Badge>{game.source === 'steam' ? 'Steam' : game.source === 'rom-scan' ? 'ROM collection' : game.source === 'pc-scan' ? 'PC scan' : 'Manual entry'}</Badge>
                  {game.favorite && (
                    <Badge tone="amber">
                      <Heart className="h-2.5 w-2.5 fill-current" /> Favorite
                    </Badge>
                  )}
                </div>

                <GameLogo game={game} />

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-white/65">
                  {game.releaseYear && <span>{game.releaseYear}</span>}
                  <span className="h-1 w-1 rounded-full bg-white/25" />
                  <span>{platform?.name ?? game.platformName ?? game.platformId}</span>
                  {game.genres.slice(0, 3).map((genre) => (
                    <span key={genre} className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                      {genre}
                    </span>
                  ))}
                  {stars !== null && <span className="text-amber-300">★ {stars}</span>}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <GlassButton
                    tone="play"
                    size="lg"
                    icon={<Play className="h-4.5 w-4.5 fill-current" />}
                    onClick={() => void play(game.id)}
                    disabled={running}
                  >
                    {isResume ? 'Resume' : 'Play'}
                  </GlassButton>
                  <GlassButton
                    tone="stop"
                    size="lg"
                    icon={<Square className="h-3.5 w-3.5 fill-current" />}
                    onClick={() => void stopGame()}
                    disabled={!running}
                  >
                    Stop
                  </GlassButton>
                  <Button
                    size="lg"
                    variant={game.favorite ? 'secondary' : 'outline'}
                    icon={<Heart className={cx('h-4 w-4', game.favorite && 'fill-current text-jf-red')} />}
                    onClick={() => void toggleFavorite(game.id)}
                  >
                    {game.favorite ? 'Favorited' : 'Favorite'}
                  </Button>
                  <Button size="lg" variant="secondary" icon={<Layers className="h-4 w-4" />} onClick={() => setCollectionOpen(true)}>
                    Collections
                  </Button>
                  <Button size="lg" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditorOpen(true)}>
                    Edit
                  </Button>
                  <Button size="lg" variant="ghost" icon={<ImageIcon className="h-4 w-4" />} onClick={() => setArtworkOpen(true)}>
                    Artwork
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    icon={busy === 'metadata' ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
                    onClick={() => void refreshMetadata()}
                    disabled={busy === 'metadata'}
                  >
                    Metadata
                  </Button>
                  <Button size="lg" variant="ghost" icon={<FolderOpen className="h-4 w-4" />} onClick={revealFiles}>
                    Files
                  </Button>
                  <Button size="lg" variant="ghost" icon={<EyeOff className="h-4 w-4" />} onClick={() => void hideGame()}>
                    Hide
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <DetailCards
        game={game}
        platform={platform}
        emulator={emulator}
        emulators={emulators}
        memberOf={memberOf}
        isMetadataStale={isMetadataStale}
        metadataUpdatedAt={metadataUpdatedAt}
        busy={busy}
        saves={saves}
        profile={profile}
        profileSaved={profileSaved}
        methodForm={methodForm}
        confirmDelete={confirmDelete}
        refreshMetadata={refreshMetadata}
        setLightbox={setLightbox}
        setTrailer={setTrailer}
        setCompletion={setCompletion}
        addPlaytime={addPlaytime}
        setSaves={setSaves}
        setProfile={setProfile}
        saveProfile={saveProfile}
        setMethodForm={setMethodForm}
        addMethod={addMethod}
        setDefaultMethod={setDefaultMethod}
        removeMethod={removeMethod}
        refreshSaves={refreshSaves}
        revealFiles={revealFiles}
        hideGame={hideGame}
        setEditorOpen={setEditorOpen}
        setArtworkOpen={setArtworkOpen}
        setConfirmDelete={setConfirmDelete}
        removeGame={removeGame}
        refresh={refresh}
      />

      <GameEditor open={editorOpen} onClose={() => setEditorOpen(false)} game={game} />

      <DetailModals
        game={game}
        collections={collections}
        collectionOpen={collectionOpen}
        setCollectionOpen={setCollectionOpen}
        toggleCollection={toggleCollection}
        artworkOpen={artworkOpen}
        setArtworkOpen={setArtworkOpen}
        candidates={candidates}
        busy={busy}
        applyLocalArtwork={applyLocalArtwork}
        applyArtwork={applyArtwork}
        lightbox={lightbox}
        setLightbox={setLightbox}
      />
      {trailer && <TrailerOverlay url={trailer} title={game.title} onClose={() => setTrailer(null)} />}

    </div>
  )
}
