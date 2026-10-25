import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Trash2 } from 'lucide-react'
import { mcpApi } from '@/api/mcp'
import { toast } from '@/store/useToastStore'
import styles from './McpCard.module.css'

type ClientKey = 'claude-code' | 'json' | 'vscode' | 'stdio'

const CLIENTS: { key: ClientKey; label: string; hint: string }[] = [
  { key: 'claude-code', label: 'Claude Code', hint: 'Save as .mcp.json in the folder you open Claude Code in (or run: claude mcp add --transport http sotp <url>).' },
  { key: 'json', label: 'Cursor / Windsurf / Cline', hint: 'Add to the client’s mcp.json (mcpServers).' },
  { key: 'vscode', label: 'VS Code (Copilot)', hint: 'Add to .vscode/mcp.json or the user mcp.json.' },
  { key: 'stdio', label: 'Claude Desktop / stdio-only', hint: 'For clients that only launch local commands: bridges stdio to this URL (needs Node.js).' },
]

function snippet(key: ClientKey, url: string): string {
  switch (key) {
    case 'claude-code': return JSON.stringify({ mcpServers: { sotp: { type: 'http', url } } }, null, 2)
    case 'json': return JSON.stringify({ mcpServers: { sotp: { url } } }, null, 2)
    case 'vscode': return JSON.stringify({ servers: { sotp: { type: 'http', url } } }, null, 2)
    case 'stdio': return JSON.stringify({ mcpServers: { sotp: { command: 'npx', args: ['-y', 'mcp-remote', url] } } }, null, 2)
  }
}

const ago = (t: number) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t * 1000).toLocaleTimeString()
}

/** "AI assistants (MCP)" block in Project settings: on/off, connection snippets per client, tools and recent calls. */
export function McpCard() {
  const qc = useQueryClient()
  const [client, setClient] = useState<ClientKey>('claude-code')
  const status = useQuery({
    queryKey: ['mcp'], queryFn: mcpApi.status, retry: false,
    refetchInterval: (q) => (q.state.data?.enabled ? 5000 : false),
  })
  const toggle = useMutation({
    mutationFn: mcpApi.update,
    onSuccess: (d) => qc.setQueryData(['mcp'], d),
    onError: (e: Error) => toast.error(e.message),
  })
  const clear = useMutation({ mutationFn: mcpApi.clearLog, onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp'] }) })

  const s = status.data
  const text = s ? snippet(client, s.url) : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.info('Copied') } catch { toast.error('Clipboard not available - select the text and copy it') }
  }
  const hint = CLIENTS.find((c) => c.key === client)?.hint

  return (
    <section className={styles.card}>
      <h3 className={styles.title}>AI assistants (MCP)</h3>
      <p className={styles.lead}>
        Lets any MCP client (Claude, Cursor, VS Code Copilot, Windsurf, ...) read the active project: entities,
        references, diagnostics, metric tables and balance outliers. Read-only, and only reachable from this computer.
      </p>
      <label className={styles.check}>
        <input type="checkbox" checked={!!s?.enabled} disabled={!s || toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} />
        Enable MCP endpoint
      </label>

      {s?.enabled && (
        <>
          <dl className={styles.facts}>
            <dt>Endpoint</dt><dd>{s.url}</dd>
            <dt>Access</dt><dd>read-only <span className={styles.note}>(edits, exports and ingest are not exposed)</span></dd>
            <dt>Last client</dt>
            <dd>{s.lastSeenAt ? <>{s.lastClient ?? 'unknown client'} <span className={styles.note}>{ago(s.lastSeenAt)}</span></> : <span className={styles.note}>no client has connected yet</span>}</dd>
          </dl>

          <div className={styles.connect}>
            <div className={styles.row}>
              <select className={styles.select} value={client} onChange={(e) => setClient(e.target.value as ClientKey)} aria-label="MCP client">
                {CLIENTS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <button className="btn sm" onClick={copy}><Copy size={12} /> Copy</button>
              <span className={styles.note}>{hint}</span>
            </div>
            <pre className={styles.code}>{text}</pre>
            <p className={styles.note}>The desktop app keeps this port while it is free; if it changes, update the client.</p>
          </div>

          <details className={styles.section}>
            <summary>Tools ({s.tools.length})</summary>
            <ul className={styles.tools}>{s.tools.map((t) => <li key={t.name}><code>{t.name}</code><span className={styles.note}>{t.description}</span></li>)}</ul>
          </details>

          <details className={styles.section} open={s.calls.length > 0}>
            <summary>Recent calls ({s.calls.length})</summary>
            {s.calls.length === 0 ? <p className={styles.note}>Calls from connected clients appear here.</p> : (
              <>
                <ul className={styles.calls}>
                  {s.calls.map((c, i) => (
                    <li key={`${c.at}-${i}`} data-error={!c.ok || undefined} title={c.error ?? undefined}>
                      <span className={styles.time}>{new Date(c.at * 1000).toLocaleTimeString()}</span>
                      <code>{c.tool}</code>
                      <span className={styles.args}>{Object.entries(c.args).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}</span>
                      <span className={styles.note}>{c.ok ? `${c.ms} ms` : c.error}</span>
                    </li>
                  ))}
                </ul>
                <button className="btn sm" onClick={() => clear.mutate()}><Trash2 size={12} /> Clear</button>
              </>
            )}
          </details>
        </>
      )}
    </section>
  )
}
