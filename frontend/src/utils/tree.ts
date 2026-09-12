import type { TreeNode } from '@/types/api'

/**
 * Helpers over the lossless tree returned by the API.  Paths follow the
 * backend's ``Node.get_path`` rules: ``key`` or ``key[i]`` per segment, where
 * ``key`` may be a full indexed key such as ``Level:0``.
 */

const baseKey = (k: string) => k.split(':')[0]

export function findNode(root: TreeNode[], path: string): TreeNode | undefined {
  let level: TreeNode[] | undefined = root
  let node: TreeNode | undefined
  for (const seg of path.split('.')) {
    if (!level) return undefined
    const m = /^([^[\]]+)(?:\[(\d+)\])?$/.exec(seg)
    if (!m) return undefined
    const key: string = m[1]
    const idx = m[2] ? Number(m[2]) : 0
    const matches: TreeNode[] = level.filter((c: TreeNode) => c.k === key || baseKey(c.k) === key)
    node = matches[idx]
    if (!node) return undefined
    level = node.c
  }
  return node
}

/** Path for a child, unambiguous even when siblings share the key. */
export function childPath(parentPath: string, siblings: TreeNode[], child: TreeNode): string {
  const same = siblings.filter((s) => s.k === child.k)
  const seg = same.length > 1 ? `${child.k}[${same.indexOf(child)}]` : child.k
  return parentPath ? `${parentPath}.${seg}` : seg
}

export const isBlock = (n: TreeNode) => n.v === undefined

/** Convert a raw token to a display / edit value. */
export function tokenToValue(raw: string | undefined): string | number | boolean | null {
  if (raw === undefined) return null
  if (raw === 'TRUE') return true
  if (raw === 'FALSE') return false
  if (raw.startsWith('"')) return raw.slice(1, -1)
  if (/^-?\d+$/.test(raw)) return Number(raw)
  if (/^-?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(raw)) return Number(raw)
  return raw
}

export type TokenKind = 'string' | 'int' | 'float' | 'bool' | 'hex' | 'array' | 'bare'

export function tokenKind(raw: string): TokenKind {
  if (raw.startsWith('"')) return 'string'
  if (raw === 'TRUE' || raw === 'FALSE') return 'bool'
  if (/^-?\d+$/.test(raw)) return 'int'
  if (/^-?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(raw)) return 'float'
  if (/^[0-9a-fA-F]{8}$/.test(raw)) return 'hex'
  if (raw.startsWith('[')) return 'array'
  return 'bare'
}

/** Read a stat that is either a scalar or a StartValue block (mirrors backend ``stat``). */
export function statValue(root: TreeNode[], key: string): { path: string; node: TreeNode } | undefined {
  for (const k of [key, key[0].toLowerCase() + key.slice(1), key[0].toUpperCase() + key.slice(1)]) {
    const n = findNode(root, k)
    if (!n) continue
    if (isBlock(n)) {
      const sv = n.c?.find((c) => c.k === 'StartValue')
      if (sv) return { path: `${k}.StartValue`, node: sv }
    } else return { path: k, node: n }
  }
  return undefined
}
