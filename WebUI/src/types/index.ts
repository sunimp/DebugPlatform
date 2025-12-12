// 设备信息
export interface DeviceInfo {
  deviceId: string
  deviceName: string
  deviceModel: string
  systemName: string
  systemVersion: string
  appName: string
  appVersion: string
  buildNumber: string
  platform: string
  isSimulator: boolean
  appIcon?: string
}

export interface DeviceListItem {
  deviceId: string
  deviceName: string
  deviceModel: string
  appName: string
  appVersion: string
  buildNumber: string
  platform: string
  systemVersion: string
  isSimulator: boolean
  isOnline: boolean
  lastSeenAt: string
  connectedAt?: string // 离线设备可能没有 connectedAt
  appIcon?: string
}

export interface DeviceDetail {
  deviceInfo: DeviceInfo
  isOnline: boolean
  connectedAt: string
  lastSeenAt: string
  stats: {
    httpEventCount: number
    logEventCount: number
    wsSessionCount: number
  }
}

// HTTP 事件
export interface HTTPEventSummary {
  id: string
  method: string
  url: string
  statusCode: number | null
  startTime: string
  duration: number | null
  isMocked: boolean
  mockRuleId: string | null
  errorDescription: string | null
  traceId: string | null
  isFavorite: boolean
  isReplay: boolean
  seqNum: number
}

export interface HTTPTiming {
  dnsLookup: number | null
  tcpConnection: number | null
  tlsHandshake: number | null
  timeToFirstByte: number | null
  contentDownload: number | null
  connectionReused: boolean | null
  protocolName: string | null
  localAddress: string | null
  remoteAddress: string | null
  requestBodyBytesSent: number | null
  responseBodyBytesReceived: number | null
}

export interface HTTPEventDetail {
  id: string
  method: string
  url: string
  queryItems: Record<string, string>
  requestHeaders: Record<string, string>
  requestBody: string | null // base64
  bodyParams: Record<string, string> | null
  statusCode: number | null
  responseHeaders: Record<string, string> | null
  responseBody: string | null // base64
  startTime: string
  endTime: string | null
  duration: number | null
  errorDescription: string | null
  isMocked: boolean
  mockRuleId: string | null
  traceId: string | null
  timing: HTTPTiming | null
  isFavorite: boolean
  isReplay: boolean
}

export interface HTTPEventListResponse {
  total: number
  page: number
  pageSize: number
  items: HTTPEventSummary[]
}

// 日志事件
export type LogLevel = 'verbose' | 'debug' | 'info' | 'warning' | 'error'

export interface LogEvent {
  id: string
  source: 'cocoaLumberjack' | 'osLog'
  timestamp: string
  level: LogLevel
  subsystem: string | null
  category: string | null
  loggerName: string | null
  thread: string | null
  file: string | null
  function: string | null
  line: number | null
  message: string
  tags: string[]
  traceId: string | null
  seqNum: number
}

export interface LogEventListResponse {
  total: number
  page: number
  pageSize: number
  items: LogEvent[]
}

// WebSocket 会话
export interface WSSessionSummary {
  id: string
  url: string
  connectTime: string
  disconnectTime: string | null
  closeCode: number | null
  closeReason: string | null
  isOpen: boolean
}

export interface WSSessionDetail {
  id: string
  url: string
  requestHeaders: Record<string, string>
  subprotocols: string[]
  connectTime: string
  disconnectTime: string | null
  closeCode: number | null
  closeReason: string | null
  frameCount: number
}

export interface WSFrame {
  id: string
  sessionId?: string
  direction: 'send' | 'receive'
  opcode: string
  payloadPreview: string | null
  payloadSize: number
  timestamp: string
  isMocked: boolean
  seqNum: number
}

export interface WSFrameDetail {
  id: string
  sessionId: string
  direction: 'send' | 'receive'
  opcode: string
  payloadText: string | null    // UTF-8 解码的文本（如果可解码）
  payloadBase64: string         // Base64 编码的完整 payload
  payloadSize: number
  timestamp: string
  isMocked: boolean
}

export interface WSSessionListResponse {
  total: number
  page: number
  pageSize: number
  items: WSSessionSummary[]
}

export interface WSFrameListResponse {
  total: number
  page: number
  pageSize: number
  items: WSFrame[]
}

// Mock 规则
export type MockTargetType = 'httpRequest' | 'httpResponse' | 'wsOutgoing' | 'wsIncoming'

export interface MockRuleCondition {
  urlPattern: string | null
  method: string | null
  statusCode: number | null
  headerContains: Record<string, string> | null
  bodyContains: string | null
  wsPayloadContains: string | null
  enabled: boolean
}

export interface MockRuleAction {
  modifyRequestHeaders: Record<string, string> | null
  modifyRequestBody: string | null // base64
  mockResponseStatusCode: number | null
  mockResponseHeaders: Record<string, string> | null
  mockResponseBody: string | null // base64
  mockWebSocketPayload: string | null // base64
  delayMilliseconds: number | null
}

export interface MockRule {
  id: string
  deviceId: string | null
  name: string
  targetType: MockTargetType
  condition: MockRuleCondition
  action: MockRuleAction
  priority: number
  enabled: boolean
  createdAt: string | null
  updatedAt: string | null
}

// 实时流消息
export type RealtimeMessageType =
  | 'httpEvent'
  | 'wsEvent'
  | 'logEvent'
  | 'stats'
  | 'performanceEvent'
  | 'deviceConnected'
  | 'deviceDisconnected'
  | 'breakpointHit'

export interface RealtimeMessage {
  type: RealtimeMessageType
  deviceId: string
  payload: string // JSON string
}

// 断点规则
export type BreakpointPhase = 'request' | 'response' | 'both'

export interface BreakpointRule {
  id: string
  name: string
  urlPattern: string | null
  method: string | null
  phase: BreakpointPhase
  enabled: boolean
  priority: number
  createdAt: string | null
}

export interface BreakpointRequestSnapshot {
  method: string
  url: string
  headers: Record<string, string>
  body: string | null // base64
}

export interface BreakpointResponseSnapshot {
  statusCode: number
  headers: Record<string, string>
  body: string | null // base64
}

export interface BreakpointHit {
  breakpointId: string
  requestId: string
  phase: BreakpointPhase
  timestamp: string
  request: BreakpointRequestSnapshot
  response: BreakpointResponseSnapshot | null
}

export interface BreakpointAction {
  type: 'resume' | 'modify' | 'abort' | 'mockResponse'
  modification?: {
    request?: BreakpointRequestSnapshot
    response?: BreakpointResponseSnapshot
  }
  mockResponse?: BreakpointResponseSnapshot
}

// 故障注入规则
export type ChaosType =
  | { type: 'latency'; minLatency: number; maxLatency: number }
  | { type: 'timeout' }
  | { type: 'connectionReset' }
  | { type: 'randomError'; errorCodes: number[] }
  | { type: 'corruptResponse' }
  | { type: 'slowNetwork'; bytesPerSecond: number }
  | { type: 'dropRequest' }

export interface ChaosRule {
  id: string
  name: string
  urlPattern: string | null
  method: string | null
  probability: number
  chaos: ChaosType
  enabled: boolean
  priority: number
  createdAt: string | null
}

// 域名策略
export type DomainPolicyStatus = 'whitelist' | 'blacklist'

export interface DomainPolicy {
  id: string
  deviceId: string | null
  domain: string
  status: DomainPolicyStatus
  note: string | null
  createdAt: string | null
  updatedAt: string | null
}

// 流量规则
export type TrafficRuleMatchType = 'domain' | 'urlRegex' | 'header'
export type TrafficRuleAction = 'highlight' | 'hide' | 'mark'

export interface TrafficRule {
  id: string
  deviceId: string | null
  name: string
  matchType: TrafficRuleMatchType
  matchValue: string
  action: TrafficRuleAction
  color?: string
  isEnabled: boolean
  priority: number
  createdAt: string | null
  updatedAt: string | null
}

// =========================================
// DB Inspector Types
// =========================================

export type DatabaseKind = 'main' | 'message' | 'log' | 'cache' | 'analytics' | 'backup' | 'other'

export interface DatabaseLocation {
  appSupport?: { relative: string }
  documents?: { relative: string }
  caches?: { relative: string }
  group?: { containerId: string; relative: string }
  custom?: { description: string }
}

export interface DatabaseDescriptor {
  id: string
  name: string
  kind: DatabaseKind
  location: DatabaseLocation
  isSensitive: boolean
  visibleInInspector: boolean
}

export interface DBInfo {
  descriptor: DatabaseDescriptor
  tableCount: number
  fileSizeBytes: number | null
}

export interface DBTableInfo {
  name: string
  rowCount: number | null
}

export interface DBColumnInfo {
  name: string
  type: string | null
  notNull: boolean
  primaryKey: boolean
  defaultValue: string | null
}

export interface DBRow {
  values: Record<string, string | null>
}

export interface DBTablePageResult {
  dbId: string
  table: string
  page: number
  pageSize: number
  totalRows: number | null
  columns: DBColumnInfo[]
  rows: DBRow[]
}

export interface DBListDatabasesResponse {
  databases: DBInfo[]
}

export interface DBListTablesResponse {
  dbId: string
  tables: DBTableInfo[]
}

export interface DBDescribeTableResponse {
  dbId: string
  table: string
  columns: DBColumnInfo[]
}

export interface DBQueryResponse {
  dbId: string
  query: string
  columns: DBColumnInfo[]
  rows: DBRow[]
  rowCount: number
  executionTimeMs: number
}

// ============================================================================
// 服务器统计
// ============================================================================

export interface ServerStats {
  httpEventCount: number
  logEventCount: number
  wsSessionCount: number
  wsFrameCount: number
  perfMetricsCount: number
  jankEventCount: number
  alertCount: number
  mockRuleCount: number
  breakpointRuleCount: number
  chaosRuleCount: number
  trafficRuleCount: number
  deviceSessionCount: number
  onlineDeviceCount: number
  databaseSizeBytes: number | null
  databaseMode: string
}

// ============================================================================
// 性能监控事件
// ============================================================================

export interface PerformanceEventData {
  id: string
  eventType: 'metrics' | 'jank' | 'alert' | 'alertResolved' | 'appLaunch'
  timestamp: string
  metrics?: PerformanceMetricsItem[]
  jank?: JankEventItem
  alert?: AlertEventItem
  appLaunch?: AppLaunchEventItem
}

export interface PerformanceMetricsItem {
  timestamp: string
  cpu?: {
    usage: number
    userTime: number
    systemTime: number
    threadCount: number
  }
  memory?: {
    usedMemory: number
    peakMemory: number
    freeMemory: number
    memoryPressure: string
    footprintRatio: number
  }
  fps?: {
    fps: number
    droppedFrames: number
    jankCount: number
    averageRenderTime: number
  }
  network?: {
    bytesReceived: number
    bytesSent: number
    downloadRate: number
    uploadRate: number
  }
  diskIO?: {
    readBytes: number
    writeBytes: number
    readRate: number
    writeRate: number
  }
}

export interface JankEventItem {
  id: string
  timestamp: string
  duration: number
  droppedFrames: number
  stackTrace?: string
}

export interface AlertEventItem {
  id: string
  ruleId: string
  metricType: string
  severity: string
  message: string
  currentValue: number
  threshold: number
  timestamp: string
  isResolved: boolean
  resolvedAt?: string
}

// SDK 发送的实际数据结构（分阶段记录）
export interface AppLaunchEventItem {
  totalTime: number             // 总启动时间（毫秒）
  preMainTime?: number          // PreMain 阶段耗时（毫秒）
  mainToLaunchTime?: number     // Main 到 Launch 阶段耗时（毫秒）
  launchToFirstFrameTime?: number // Launch 到首帧阶段耗时（毫秒）
  timestamp: string             // 记录时间
}
