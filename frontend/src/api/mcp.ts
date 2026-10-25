import { api } from './client'

export interface McpCall {
  at: number
  tool: string
  args: Record<string, unknown>
  ok: boolean
  ms: number
  error: string | null
}

export interface McpStatus {
  enabled: boolean
  readOnly: boolean
  url: string
  tools: { name: string; description: string }[]
  lastSeenAt: number | null
  lastClient: string | null
  calls: McpCall[]
}

export const mcpApi = {
  status: () => api.get<McpStatus>('/mcp'),
  update: (enabled: boolean) => api.put<McpStatus>('/mcp', { enabled }),
  clearLog: () => api.del<void>('/mcp/log'),
}
