import type {
  DeviceListItem,
  DeviceDetail,
  HTTPEventListResponse,
  HTTPEventDetail,
  LogEventListResponse,
  WSSessionListResponse,
  WSSessionDetail,
  WSFrameListResponse,
  WSFrameDetail,
  MockRule,
} from '@/types'

const API_BASE = '/api'

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json', // 确保服务端返回 JSON 而非 HTML
      ...options?.headers,
    },
    ...options,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  // 处理空响应体（如 DELETE 返回 204 No Content）
  const text = await response.text()
  if (!text) {
    return undefined as T
  }
  return JSON.parse(text) as T
}

export const api = {
  get: <T>(url: string) => fetchJSON<T>(url),
  post: <T>(url: string, body?: any) =>
    fetchJSON<T>(url, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(url: string, body?: any) =>
    fetchJSON<T>(url, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(url: string) => fetchJSON<T>(url, { method: 'DELETE' }),
}

// ============================================================================
// 设备 API
// ============================================================================

export async function getDevices(): Promise<DeviceListItem[]> {
  return fetchJSON(`${API_BASE}/devices`)
}

export async function getDevice(deviceId: string): Promise<DeviceDetail> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}`)
}

export async function toggleCapture(
  deviceId: string,
  network: boolean,
  log: boolean,
  websocket: boolean,
  database: boolean
): Promise<void> {
  await fetch(`${API_BASE}/devices/${deviceId}/control/toggle-capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ network, log, websocket, database }),
  })
}

export async function clearDeviceData(deviceId: string): Promise<void> {
  await fetch(`${API_BASE}/devices/${deviceId}/data`, { method: 'DELETE' })
}

// 移除设备（仅限离线设备）
export async function removeDevice(deviceId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/devices/${deviceId}`, { method: 'DELETE' })
  if (!response.ok) {
    const error = await response.text()
    throw new Error(error || 'Failed to remove device')
  }
}

// 移除所有离线设备
export async function removeAllOfflineDevices(): Promise<void> {
  const response = await fetch(`${API_BASE}/devices/offline`, { method: 'DELETE' })
  if (!response.ok) {
    throw new Error('Failed to remove offline devices')
  }
}

// 设备会话历史
export interface DeviceSession {
  id: string
  deviceId: string
  deviceName: string
  sessionId: string
  connectedAt: string
  disconnectedAt: string | null
  isNormalClose: boolean
}

export async function getDeviceSessions(
  deviceId: string,
  limit: number = 50
): Promise<DeviceSession[]> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/sessions?limit=${limit}`)
}

// ============================================================================
// HTTP 事件 API
// ============================================================================

export interface HTTPEventFilters {
  page?: number
  pageSize?: number
  method?: string
  statusCode?: number
  urlContains?: string
  isMocked?: boolean
  timeFrom?: string
  timeTo?: string
}

export async function getHTTPEvents(
  deviceId: string,
  filters: HTTPEventFilters = {}
): Promise<HTTPEventListResponse> {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize))
  if (filters.method) params.set('method', filters.method)
  if (filters.statusCode) params.set('statusCode', String(filters.statusCode))
  if (filters.urlContains) params.set('urlContains', filters.urlContains)
  if (filters.isMocked !== undefined) params.set('isMocked', String(filters.isMocked))
  if (filters.timeFrom) params.set('timeFrom', filters.timeFrom)
  if (filters.timeTo) params.set('timeTo', filters.timeTo)

  const query = params.toString()
  return fetchJSON(`${API_BASE}/devices/${deviceId}/http${query ? `?${query}` : ''}`)
}

export async function getHTTPEventDetail(
  deviceId: string,
  eventId: string
): Promise<HTTPEventDetail> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/http/${eventId}`)
}

export async function getHTTPEventCurl(
  deviceId: string,
  eventId: string
): Promise<{ curl: string }> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/http/${eventId}/curl`)
}

export async function replayHTTPEvent(
  deviceId: string,
  eventId: string
): Promise<{ replayId: string; status: string }> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/http/${eventId}/replay`, {
    method: 'POST',
  })
}

export async function toggleFavorite(
  deviceId: string,
  eventId: string
): Promise<{ id: string; isFavorite: boolean }> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/http/${eventId}/favorite`, {
    method: 'POST',
  })
}

export async function batchDeleteHTTPEvents(
  deviceId: string,
  ids: string[]
): Promise<{ affected: number; success: boolean }> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/http/batch/delete`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

export async function batchFavoriteHTTPEvents(
  deviceId: string,
  ids: string[],
  isFavorite: boolean
): Promise<{ affected: number; success: boolean }> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/http/batch/favorite`, {
    method: 'POST',
    body: JSON.stringify({ ids, isFavorite }),
  })
}

// ============================================================================
// 数据清理配置 API
// ============================================================================

export interface CleanupConfig {
  retentionDays: number
  cleanupIntervalSeconds: number
}

export async function getCleanupConfig(): Promise<CleanupConfig> {
  return fetchJSON(`${API_BASE}/cleanup/config`)
}

export async function updateCleanupConfig(config: CleanupConfig): Promise<CleanupConfig> {
  return fetchJSON(`${API_BASE}/cleanup/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

export async function runCleanupNow(): Promise<void> {
  await fetch(`${API_BASE}/cleanup/run`, { method: 'POST' })
}

export async function truncateAllData(): Promise<void> {
  await fetch(`${API_BASE}/cleanup/truncate`, { method: 'POST' })
}

// Token 验证 API
export interface TokenVerifyResponse {
  valid: boolean
  message: string
}

export async function verifyToken(token: string): Promise<TokenVerifyResponse> {
  return fetchJSON(`${API_BASE}/auth/verify`, {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

// ============================================================================
// 日志事件 API
// ============================================================================

export interface LogEventFilters {
  page?: number
  pageSize?: number
  level?: string
  levels?: string[]
  subsystem?: string
  category?: string
  loggerName?: string
  text?: string
  traceId?: string
  timeFrom?: string
  timeTo?: string
}

export async function getLogEvents(
  deviceId: string,
  filters: LogEventFilters = {}
): Promise<LogEventListResponse> {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize))
  if (filters.level) params.set('level', filters.level)
  if (filters.levels?.length) params.set('levels', filters.levels.join(','))
  if (filters.subsystem) params.set('subsystem', filters.subsystem)
  if (filters.category) params.set('category', filters.category)
  if (filters.loggerName) params.set('loggerName', filters.loggerName)
  if (filters.text) params.set('text', filters.text)
  if (filters.traceId) params.set('traceId', filters.traceId)
  if (filters.timeFrom) params.set('timeFrom', filters.timeFrom)
  if (filters.timeTo) params.set('timeTo', filters.timeTo)

  const query = params.toString()
  return fetchJSON(`${API_BASE}/devices/${deviceId}/logs${query ? `?${query}` : ''}`)
}

export async function getLogSubsystems(deviceId: string): Promise<string[]> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/logs/subsystems`)
}

export async function getLogCategories(deviceId: string): Promise<string[]> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/logs/categories`)
}

export async function batchDeleteLogs(
  deviceId: string,
  ids: string[]
): Promise<void> {
  await fetch(`${API_BASE}/devices/${deviceId}/logs/batch-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
}

// ============================================================================
// WebSocket 会话 API
// ============================================================================

export interface WSSessionFilters {
  page?: number
  pageSize?: number
  urlContains?: string
  host?: string
  isOpen?: boolean
  timeFrom?: string
  timeTo?: string
}

export async function getWSSessions(
  deviceId: string,
  filters: WSSessionFilters = {}
): Promise<WSSessionListResponse> {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize))
  if (filters.urlContains) params.set('urlContains', filters.urlContains)
  if (filters.host) params.set('host', filters.host)
  if (filters.isOpen !== undefined) params.set('isOpen', String(filters.isOpen))
  if (filters.timeFrom) params.set('timeFrom', filters.timeFrom)
  if (filters.timeTo) params.set('timeTo', filters.timeTo)

  const query = params.toString()
  return fetchJSON(`${API_BASE}/devices/${deviceId}/ws-sessions${query ? `?${query}` : ''}`)
}

export async function getWSSessionDetail(
  deviceId: string,
  sessionId: string
): Promise<WSSessionDetail> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/ws-sessions/${sessionId}`)
}

export async function getWSFrames(
  deviceId: string,
  sessionId: string,
  filters: { page?: number; pageSize?: number; direction?: string } = {}
): Promise<WSFrameListResponse> {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize))
  if (filters.direction) params.set('direction', filters.direction)

  const query = params.toString()
  return fetchJSON(
    `${API_BASE}/devices/${deviceId}/ws-sessions/${sessionId}/frames${query ? `?${query}` : ''}`
  )
}

export async function getWSFrameDetail(
  deviceId: string,
  sessionId: string,
  frameId: string
): Promise<WSFrameDetail> {
  return fetchJSON(
    `${API_BASE}/devices/${deviceId}/ws-sessions/${sessionId}/frames/${frameId}`
  )
}

export async function batchDeleteWSSessions(
  deviceId: string,
  ids: string[]
): Promise<{ affected: number; success: boolean }> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/ws-sessions/batch/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
}

// ============================================================================
// Mock 规则 API
// ============================================================================

export async function getMockRules(deviceId: string): Promise<MockRule[]> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/mock-rules`)
}

export async function createMockRule(
  deviceId: string,
  rule: Omit<MockRule, 'id' | 'deviceId' | 'createdAt' | 'updatedAt'>
): Promise<MockRule> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/mock-rules`, {
    method: 'POST',
    body: JSON.stringify(rule),
  })
}

export async function updateMockRule(
  deviceId: string,
  ruleId: string,
  rule: Partial<Omit<MockRule, 'id' | 'deviceId' | 'createdAt' | 'updatedAt'>>
): Promise<MockRule> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/mock-rules/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify(rule),
  })
}

export async function deleteMockRule(deviceId: string, ruleId: string): Promise<void> {
  await fetch(`${API_BASE}/devices/${deviceId}/mock-rules/${ruleId}`, {
    method: 'DELETE',
  })
}

export async function deleteAllMockRules(deviceId: string): Promise<void> {
  const rules = await getMockRules(deviceId)
  await Promise.all(rules.map(rule => deleteMockRule(deviceId, rule.id)))
}

// ============================================================================
// 导出 API
// ============================================================================

export function getExportLogsUrl(
  deviceId: string,
  format: 'json' | 'ndjson' | 'csv' = 'json'
): string {
  return `${API_BASE}/devices/${deviceId}/export/logs?format=${format}`
}

export function getExportHTTPUrl(
  deviceId: string,
  format: 'json' | 'ndjson' | 'csv' = 'json'
): string {
  return `${API_BASE}/devices/${deviceId}/export/http?format=${format}`
}

export function getExportHARUrl(deviceId: string, ids?: string[]): string {
  const params = new URLSearchParams()
  if (ids && ids.length > 0) {
    params.set('ids', ids.join(','))
  }
  const query = params.toString()
  return `${API_BASE}/devices/${deviceId}/export/har${query ? `?${query}` : ''}`
}

// ============================================================================
// 断点 API
// ============================================================================

import type { BreakpointRule, BreakpointHit, BreakpointAction, ChaosRule } from '@/types'

export async function getBreakpointRules(deviceId: string): Promise<BreakpointRule[]> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/breakpoints`)
}

export async function createBreakpointRule(
  deviceId: string,
  rule: Omit<BreakpointRule, 'id'>
): Promise<BreakpointRule> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/breakpoints`, {
    method: 'POST',
    body: JSON.stringify(rule),
  })
}

export async function updateBreakpointRule(
  deviceId: string,
  ruleId: string,
  rule: Partial<Omit<BreakpointRule, 'id'>>
): Promise<BreakpointRule> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/breakpoints/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify(rule),
  })
}

export async function deleteBreakpointRule(deviceId: string, ruleId: string): Promise<void> {
  await fetch(`${API_BASE}/devices/${deviceId}/breakpoints/${ruleId}`, {
    method: 'DELETE',
  })
}

export async function deleteAllBreakpointRules(deviceId: string): Promise<void> {
  const rules = await getBreakpointRules(deviceId)
  await Promise.all(rules.map(rule => deleteBreakpointRule(deviceId, rule.id)))
}

export async function getPendingBreakpoints(deviceId: string): Promise<BreakpointHit[]> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/breakpoints/pending`)
}

export async function resumeBreakpoint(
  deviceId: string,
  requestId: string,
  action: BreakpointAction
): Promise<void> {
  await fetch(`${API_BASE}/devices/${deviceId}/breakpoints/resume/${requestId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  })
}

// ============================================================================
// 故障注入 API
// ============================================================================

export async function getChaosRules(deviceId: string): Promise<ChaosRule[]> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/chaos`)
}

export async function createChaosRule(
  deviceId: string,
  rule: Omit<ChaosRule, 'id'>
): Promise<ChaosRule> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/chaos`, {
    method: 'POST',
    body: JSON.stringify(rule),
  })
}

export async function updateChaosRule(
  deviceId: string,
  ruleId: string,
  rule: Partial<Omit<ChaosRule, 'id'>>
): Promise<ChaosRule> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/chaos/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify(rule),
  })
}

export async function deleteChaosRule(deviceId: string, ruleId: string): Promise<void> {
  await fetch(`${API_BASE}/devices/${deviceId}/chaos/${ruleId}`, {
    method: 'DELETE',
  })
}

export async function deleteAllChaosRules(deviceId: string): Promise<void> {
  const rules = await getChaosRules(deviceId)
  await Promise.all(rules.map(rule => deleteChaosRule(deviceId, rule.id)))
}

// ============================================================================
// DB Inspector API
// ============================================================================

import type {
  DBListDatabasesResponse,
  DBListTablesResponse,
  DBDescribeTableResponse,
  DBTablePageResult,
  DBQueryResponse,
} from '@/types'

export async function listDatabases(deviceId: string): Promise<DBListDatabasesResponse> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/databases`)
}

export async function listTables(deviceId: string, dbId: string): Promise<DBListTablesResponse> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/databases/${dbId}/tables`)
}

export async function describeTable(
  deviceId: string,
  dbId: string,
  table: string
): Promise<DBDescribeTableResponse> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/databases/${dbId}/tables/${table}/schema`)
}

export interface FetchTablePageParams {
  page?: number
  pageSize?: number
  orderBy?: string
  ascending?: boolean
}

export async function fetchTablePage(
  deviceId: string,
  dbId: string,
  table: string,
  params?: FetchTablePageParams
): Promise<DBTablePageResult> {
  const searchParams = new URLSearchParams()
  if (params?.page) searchParams.set('page', params.page.toString())
  if (params?.pageSize) searchParams.set('pageSize', params.pageSize.toString())
  if (params?.orderBy) searchParams.set('orderBy', params.orderBy)
  if (params?.ascending !== undefined) searchParams.set('ascending', params.ascending.toString())

  const queryString = searchParams.toString()
  const url = `${API_BASE}/devices/${deviceId}/databases/${dbId}/tables/${table}/rows${queryString ? '?' + queryString : ''}`
  return fetchJSON(url)
}

export async function executeQuery(
  deviceId: string,
  dbId: string,
  query: string
): Promise<DBQueryResponse> {
  return fetchJSON(`${API_BASE}/devices/${deviceId}/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
}

// ============================================================================
// 服务器统计 API
// ============================================================================

import type { ServerStats } from '@/types'

export async function getServerStats(): Promise<ServerStats> {
  return fetchJSON(`${API_BASE}/stats`)
}
