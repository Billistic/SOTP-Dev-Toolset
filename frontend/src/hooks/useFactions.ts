import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { insightsApi } from '@/api/insights'

/** The active project's factions (one per Player entity) - never assume SOTP's Cole / Regret / ... set. */
export function useFactions() {
  const { data: factions = [] } = useQuery({ queryKey: ['factions'], queryFn: insightsApi.factions, staleTime: 5 * 60_000 })
  return useMemo(() => {
    const raceOf = new Map(factions.map((f) => [f.faction, f.race]))
    const races = [...new Set(factions.map((f) => f.race).filter((r): r is string => !!r))]
    // filter options: each race followed by its factions, then factions with no race
    const options = [
      ...races.flatMap((r) => [r, ...factions.filter((f) => f.race === r && f.faction !== r).map((f) => f.faction)]),
      ...factions.filter((f) => !f.race).map((f) => f.faction),
    ]
    return { factions, raceOf: (faction: unknown) => raceOf.get(String(faction)) ?? null, options: [...new Set(options)] }
  }, [factions])
}
