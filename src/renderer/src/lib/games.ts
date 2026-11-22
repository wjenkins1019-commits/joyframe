/** Shared game-list helpers: the hidden-games policy lives here so views stay consistent. */

/** Drop hidden games unless the "show hidden" setting is on. */
export function visibleGames<T extends { hidden: boolean }>(games: readonly T[], showHidden: boolean): T[] {
  return showHidden ? [...games] : games.filter((game) => !game.hidden)
}

/** Resolve stored game ids to game objects (dropping stale ids) and apply the hidden-games policy. */
export function gamesByIds<T extends { id: string; hidden: boolean }>(
  ids: readonly string[],
  games: readonly T[],
  showHidden: boolean
): T[] {
  const byId = new Map(games.map((game) => [game.id, game]))
  const list = ids.map((id) => byId.get(id)).filter((entry): entry is T => Boolean(entry))
  return showHidden ? list : list.filter((game) => !game.hidden)
}
