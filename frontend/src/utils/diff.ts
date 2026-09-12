/** Minimal word-level diff (LCS) for showing how a string changed. */
export type DiffPart = { text: string; op: 'same' | 'add' | 'del' }

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/), b = after.split(/(\s+)/)
  const n = a.length, m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffPart[] = []
  const push = (text: string, op: DiffPart['op']) => {
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += text
    else out.push({ text, op })
  }
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { push(a[i], 'same'); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push(a[i], 'del'); i++ }
    else { push(b[j], 'add'); j++ }
  }
  while (i < n) push(a[i++], 'del')
  while (j < m) push(b[j++], 'add')
  return out
}
