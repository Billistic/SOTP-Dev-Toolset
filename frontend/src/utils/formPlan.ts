import { humanKey } from '@/utils/format'
import type { EntityLayout, FieldSpec, LayoutSection, LayoutSlot, LayoutUnknown } from '@/types/api'

/**
 * Turns a grammar layout plus the curated field specs into the tiles the Form view renders:
 * one tile per curated group (Identity, Economy, ...), root fields the curation does not name
 * classified into those groups by key, small single blocks inlined into their group, repeated
 * blocks (instantAction[i], researchModifier[i]...) folded into one tile each, and the big
 * single blocks (Prerequisites, gameEventData...) as their own tiles - nested blocks stay inside.
 */

export const GROUP_ORDER = ['Identity', 'Economy', 'Durability', 'Mobility', 'Combat', 'Fleet', 'Research', 'Planet', 'Module',
  'Squad', 'Ability', 'Visual', 'Audio', 'Text', 'AI', 'Other']

export interface SlotItem {
  type: 'slot'
  slot: LayoutSlot
  spec?: FieldSpec
  label: string
  add?: { parent: string; after: string | null }              // unset field: where its template goes
  addItem?: { parent: string; afterLast: string[] }           // count: where another item goes
}
export interface UnknownItem { type: 'unknown'; u: LayoutUnknown; label: string }
export interface BlockItem { type: 'block'; section: LayoutSection; label: string; index?: number; items: Item[] }
export type Item = SlotItem | UnknownItem | BlockItem

export interface Tile {
  key: string
  kind: 'group' | 'block' | 'repeat' | 'weapons'
  group: string
  title: string
  subtitle?: string
  items: Item[]
}

interface Resolved { spec: FieldSpec; path: string; raw: string | undefined }

// key -> group, first match wins; curated specs override this for the fields they name
const CLASSES: [RegExp, string][] = [
  [/^entityType$|StringID$|^name$|^description|^counterDescription|RoleType$|^roleType$|^role$|^typeCount$|^statCountType$|^armorType$|^dlcId$|^isSelectable|^canColonize/i, 'Identity'],
  [/^ai|autoCast|AutoAttack|focusFire|autoJoin|^prefers|^usesFighterAttack|^onlyAutoCast|^ignoreNonCombat|^pickRandom/i, 'AI'],
  [/^weapon(Damage|Cooldown|Range)|^NumWeapons$|^Weapon$/i, 'Combat'],
  [/ability|^buff|instantAction|periodicAction|overTimeAction|finishCondition|entityModifier|entityBoolModifier|cooldown|useCost|levelSource|maxNumLevels|isUltimate|needsToFace|canCollide|moveThru|isChannelling|isInterruptable|stack|onReapply|exclusivity|targetFilter|effectInfo|antiMatterCost|toggleState/i, 'Ability'],
  [/sound|music|ambience|announcement|theme/i, 'Audio'],
  [/mesh|effect|icon|picture|brush|texture|shadow|zoom|render|debris|explosion|particle|colou?r|overlay|backdrop|skin|hud|exhaust|glow|trail/i, 'Visual'],
  [/research|prerequisite|^tier$|^ResearchField$|^field$|artifact|labs?exist|^priority$|unlock|modifier/i, 'Research'],
  [/weapon|damage|^Range$|^TargetCount|firing|bomb|canOnlyTarget|attack|beam|projectile|missile|burst|ammo|^m_weaponIndex/i, 'Combat'],
  [/squad|fighter|hangar|command|cargo|fleet|formation|refinery|trade|convoy/i, 'Fleet'],
  [/planet|orbit|population|colon|allegiance|relationship|diplom|pact|culture|resource|extraction|asteroid|gravity|star$|wormhole|phase/i, 'Planet'],
  [/module|structure|upgrade slot|slotType/i, 'Module'],
  [/hull|shield|armor|mitigation|restore|regen|repair|antimatter|antiMatter|experience|level/i, 'Durability'],
  [/speed|accel|decel|roll|^mass$|hyperspace|thrust|turn|strafe|linear|angular|jump/i, 'Mobility'],
  [/price|cost|build|slot|credits|metal|crystal|supply|time$|income|tax|maintenance|scuttle/i, 'Economy'],
]
export function classifyKey(key: string): string {
  const base = key.split(':')[0]
  for (const [re, group] of CLASSES) if (re.test(base)) return group
  return 'Other'
}

export const labelFor = (key: string) => humanKey(key.split(':')[0]) + (key.includes(':') ? ` ${key.split(':').slice(1).join(':')}` : '')

const SMALL_BLOCK = 8   // a single block with at most this many rows and no sub-blocks is shown inside its group

export function planForm(layout: EntityLayout, resolved: Resolved[], carriesWeapons: boolean): Tile[] {
  const byPath = new Map(layout.sections.map((s) => [s.path, s]))
  const root = layout.sections[0]
  if (!root) return []

  // curated specs by the path they resolved to; compound blocks (basePrice, MaxHullPoints.StartValue) also by their parent
  const specByPath = new Map<string, FieldSpec>()
  for (const r of resolved) {
    if (r.raw === undefined) continue
    specByPath.set(r.path, r.spec)
    const parent = r.path.includes('.') ? r.path.slice(0, r.path.lastIndexOf('.')) : null
    if (parent && !specByPath.has(parent)) specByPath.set(parent, r.spec)
  }
  // a spec names the whole slot when it matched its path directly or is a 'stat' (StartValue block) spec;
  // one that matched a sub-value (basePrice.credits) lends its group and balance flag but not its label
  const specFor = (slot: LayoutSlot): { spec?: FieldSpec; whole: boolean } => {
    const direct = specByPath.get(slot.path)
    if (direct) return { spec: direct, whole: direct.kind === 'stat' || !(slot.values ?? []).length || (slot.values ?? []).some((v) => v.path === slot.path) }
    const sub = (slot.values ?? []).map((v) => specByPath.get(v.path)).find(Boolean)
    return { spec: sub, whole: sub?.kind === 'stat' }
  }

  const itemsFor = (section: LayoutSection): Item[] => {
    const out: Item[] = []
    let prevPresent: string | null = null
    section.slots.forEach((slot) => {
      if (slot.kind === 'section' && slot.present) {
        const child = byPath.get(slot.path)
        if (child) {
          out.push({ type: 'block', section: child, label: labelFor(child.title), items: itemsFor(child) })
          prevPresent = slot.path
          return
        }
      }
      const { spec, whole } = specFor(slot)
      const item: SlotItem = { type: 'slot', slot, spec, label: spec && whole ? spec.label : labelFor(slot.key) }
      if (!slot.present && slot.template) item.add = { parent: section.path, after: prevPresent }
      if (slot.kind === 'count' && slot.item && slot.itemTemplate) item.addItem = { parent: section.path, afterLast: [slot.item, slot.key] }
      out.push(item)
      if (slot.present) prevPresent = slot.path
    })
    for (const u of section.unknown) out.push({ type: 'unknown', u, label: u.key })
    return out
  }

  const rootItems = itemsFor(root)
  const groups = new Map<string, Item[]>()
  const push = (group: string, item: Item) => groups.set(group, [...(groups.get(group) ?? []), item])
  const blockTiles: Tile[] = []
  const repeatTiles = new Map<string, Tile>()
  const repeatOf = (key: string, group: string): Tile => {
    let t = repeatTiles.get(key)
    if (!t) { t = { key: `repeat:${key}`, kind: 'repeat', group, title: labelFor(key), items: [] }; repeatTiles.set(key, t) }
    return t
  }
  const blockCount = new Map<string, number>()
  for (const it of rootItems) if (it.type === 'block') blockCount.set(it.section.title, (blockCount.get(it.section.title) ?? 0) + 1)
  const isSmall = (b: BlockItem) => b.items.length <= SMALL_BLOCK && b.items.every((x) => x.type !== 'block')

  let iter: { item: string; group: string } | null = null
  let counters = new Map<string, number>()
  for (const it of rootItems) {
    if (it.type === 'block') {
      const key = it.section.title
      if (carriesWeapons && key === 'Weapon') continue
      const group = classifyKey(key)
      if ((blockCount.get(key) ?? 0) > 1 || iter?.item === key) {
        const n = counters.get(key) ?? 0; counters.set(key, n + 1)
        repeatOf(key, group).items.push({ ...it, index: n })
      } else if (isSmall(it)) {
        push(group, it)
      } else {
        blockTiles.push({ key: `block:${it.section.path}`, kind: 'block', group, title: it.label, subtitle: it.section.subtitle ?? undefined, items: it.items })
      }
      continue
    }
    if (it.type === 'unknown') { push(classifyKey(it.u.key), it); continue }
    const s = it.slot
    if (carriesWeapons && s.key === 'NumWeapons') continue
    if (s.kind === 'count') {
      const group = classifyKey(s.item ?? s.key)
      iter = s.item ? { item: s.item, group } : null
      const itemsAreBlocks = s.item ? (blockCount.get(s.item) ?? 0) > 0 : false
      if (itemsAreBlocks && s.item) repeatOf(s.item, group).items.push(it)   // the count row heads the repeat tile
      else push(group, it)
      continue
    }
    if (iter && s.key === iter.item) { push(iter.group, it); continue }   // repeated scalar items (SoundID...)
    iter = null
    push(it.spec?.group ?? classifyKey(s.key), it)
  }

  // tiles: each group's own tile first, then the block / repeat tiles that belong to it
  const tiles: Tile[] = []
  const extras = [...blockTiles, ...repeatTiles.values()]
  for (const g of GROUP_ORDER) {
    const items = groups.get(g)
    if (items?.length) tiles.push({ key: `group:${g}`, kind: 'group', group: g, title: g, items })
    if (g === 'Combat' && carriesWeapons) tiles.push({ key: 'weapons', kind: 'weapons', group: g, title: 'Weapons', items: [] })
    for (const t of extras) if (t.group === g) tiles.push(t)
  }
  for (const t of extras) if (!GROUP_ORDER.includes(t.group)) tiles.push(t)
  for (const t of tiles) if (t.kind === 'repeat') t.subtitle = `× ${t.items.filter((x) => x.type === 'block').length}`
  return tiles
}

/** Counts shown on a tile header: present rows, balance-flagged rows, problems (missing required / unknown / invalid). */
export function tileStats(items: Item[]): { present: number; balance: number; warn: number } {
  let present = 0, balance = 0, warn = 0
  const visit = (list: Item[]) => {
    for (const it of list) {
      if (it.type === 'block') { visit(it.items); continue }
      if (it.type === 'unknown') { warn++; continue }
      const s = it.slot
      if (s.present) present++
      if (it.spec?.balance) balance++
      if ((s.required && !s.present && s.kind !== 'count') || s.invalid || s.mismatch) warn++
    }
  }
  visit(items)
  return { present, balance, warn }
}
