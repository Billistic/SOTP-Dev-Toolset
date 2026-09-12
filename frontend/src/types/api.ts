/** Shapes returned by the backend. Kept in one place so components share them. */

export interface Project {
  id: number
  name: string
  modRoot: string
  vanillaRoot: string | null
  outputRoot: string | null
  isActive: boolean
  lastIngestAt: string | null
}

export interface EntitySummary {
  id: number
  name: string
  entityType: string
  category: string
  race: string | null
  faction: string | null
  role: string | null
  displayName: string | null
  sourcePath: string
  isDirty: boolean
  sourceMissing: boolean
  errorCount: number
  warningCount: number
  updatedAt: string | null
}

/** Lossless ordered tree node: key, raw value token, children, source line. */
export interface TreeNode {
  k: string
  v?: string
  c?: TreeNode[]
  l?: number
}

export interface FieldSpec {
  path: string
  label: string
  group: string
  kind: 'float' | 'int' | 'bool' | 'string' | 'enum' | 'ref' | 'color' | 'array' | 'stat'
  ref: string | null
  enum: string | null
  unit: string | null
  balance: boolean
  help: string | null
  when?: string | null            // variant this field applies to (weapon editor: weaponType)
}

export interface WeaponSchema {
  fields: FieldSpec[]
  soundLists: { key: string; label: string; when: string | null }[]
  templates: Record<string, string>
}

export interface EntitySchema {
  entityType: string
  category: string
  fields: FieldSpec[]
  required: string[]
  nameKey: string
  descKey: string
}

export interface Diagnostic {
  id: number
  entityId: number | null
  entityName: string | null
  scope: string
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  path: string | null
  line: number | null
  target: string | null
}

export interface WeaponRow {
  weapon_index: number
  weapon_type: string | null
  attack_type: string | null
  damage_type: string | null
  weapon_class: string | null
  damage_front: number
  damage_back: number
  damage_left: number
  damage_right: number
  range: number | null
  cooldown: number | null
  burst_count: number
  can_fire_at_fighter: boolean
  dps_best_bank: number
  dps_all_banks: number
  muzzle_effect: string | null
  hit_effect: string | null
}

export interface EntityDetail extends EntitySummary {
  fmt: string | null
  archiveVersion: number | null
  lineCount: number
  tree: { header: { fmt: string | null; archiveVersion: number | null }; root: TreeNode[]; diagnostics: unknown[] }
  typed: Record<string, unknown>
  weapons: WeaponRow[]
  prerequisites: { subject: string; level: number }[]
  modifiers: { type: string | null; base: number | null; perLevel: number | null; isBool: boolean }[]
  schema: EntitySchema
  refKinds: Record<string, string>   // tree path -> reference kind (entity, string, mesh, brush, sound, ...)
  diagnostics: Diagnostic[]
  createdStrings?: GameString[]   // placeholder strings the backend created for unknown string IDs
}

export interface Reference {
  path: string
  key: string
  kind: string
  target: string
  resolved: boolean
  resolvedSource: string | null
  targetEntityId: number | null
}

export interface IncomingReference {
  source: EntitySummary
  path: string
  key: string
}

export interface TypeCount { entityType: string; category: string; count: number; errors: number }

export interface DiagnosticsSummary {
  bySeverity: Record<string, number>
  byCode: { code: string; severity: string; count: number }[]
}

export interface Stats {
  count: number
  mean?: number
  std?: number
  min?: number
  q1?: number
  median?: number
  q3?: number
  max?: number
  mad?: number
}

export interface PeerProfile {
  peerGroup: string
  peers: number
  peerNames: string[]
  metrics: { metric: string; value: unknown; stats: Stats; z: number | null; percentile: number | null }[]
}

export interface Distribution {
  path: string
  entityType: string
  overall: Stats
  groups: Record<string, Stats>
  points: { name: string; faction: string | null; role: string | null; value: number }[]
}

export interface FieldCatalogEntry {
  path: string
  key: string
  count: number
  numericCount: number
  min: number | null
  max: number | null
  mean: number | null
}

export interface MetricTable {
  metrics: string[]
  rows: Record<string, unknown>[]
  byFaction: Record<string, Record<string, Stats>>
}

export interface Lever { lever: string; current: number; target: number; changePct: number | null; hint: string }

export interface Recommendation {
  entity: string
  displayName: string | null
  entityType: string
  faction: string | null
  group: string
  metric: string
  label: string
  value: number
  median: number
  z: number
  direction: 'over-tuned' | 'under-tuned'
  severity: 'high' | 'medium' | 'low'
  summary: string
  levers: Lever[]
}

export interface BalanceReport {
  category: string
  zThreshold: number
  groups: { group: string; size: number; factions: string[]; stats: Record<string, Partial<Stats>> }[]
  recommendations: Recommendation[]
}

export interface GameString {
  id: number
  stringId: string
  value: string
  originalValue: string
  isModified: boolean
  isNew: boolean
  isDeleted: boolean
  sourceFile: string
  line: number | null
  duplicateCount: number
}

export interface StringChanges { new: GameString[]; modified: GameString[]; deleted: GameString[] }

export interface Asset {
  id: number
  kind: string
  name: string
  path: string | null
  source: string
  sizeBytes: number | null
  meta: Record<string, unknown>
}

export interface GraphNode {
  id: string
  label: string
  exists: boolean
  field?: string | null
  tier?: number | null
  block?: number | null
  x?: number | null
  y?: number | null
  cost?: number | null
  time?: number | null
  levels?: number | null
  errors?: number
  unit?: boolean
  entityType?: string | null
  faction?: string | null
}

export interface GraphEdge {
  source: string
  target: string
  kind?: string
  key?: string
  path?: string
  level?: number
  dangling?: boolean
  resolved?: boolean
}

export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; player?: string; root?: string }

/** Relationship builder payloads (GET /graph/relationships). */
export interface RelPort { path: string; key: string; target: string | null }
export interface RelNode {
  id: string
  label: string
  exists: boolean
  entityType?: string | null
  category?: string | null
  race?: string | null
  faction?: string | null
  errors?: number
  dirty?: boolean
  proxy: boolean            // outside the current filter / focus; shown as a reference stub
  asset?: boolean           // non-entity target (mesh, particle, ...)
  kind?: string
  ports: RelPort[]
}
export interface RelEdge { source: string; target: string; path: string; key: string; kind: string; resolved: boolean }
export interface RelGraph { focus: string | null; nodes: RelNode[]; edges: RelEdge[]; truncated: boolean }
export interface GraphLayout { viewKey: string; positions: Record<string, { x: number; y: number }>; updatedAt: string | null }

export interface IngestStats {
  added: number
  updated: number
  skipped: number
  removed: number
  errors: number
  strings: number
  assets: number
  seconds: number
  diagnostics: DiagnosticsSummary
}

export interface EditChange {
  op: 'set' | 'setRaw' | 'add' | 'remove' | 'clone' | 'move' | 'insertText'
  path?: string
  value?: unknown
  raw?: string
  parent?: string
  key?: string
  offset?: -1 | 1                 // move
  text?: string                   // insertText
  afterLast?: string[]            // insertText: place after the last child with the first of these keys
  after?: string | null
}
