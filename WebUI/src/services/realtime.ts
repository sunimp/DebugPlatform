import type { RealtimeMessage, HTTPEventSummary, LogEvent } from '@/types'

type MessageHandler = (message: RealtimeMessage) => void
type ConnectionHandler = (connected: boolean) => void

class RealtimeService {
  private ws: WebSocket | null = null
  private messageHandlers: Set<MessageHandler> = new Set()
  private connectionHandlers: Set<ConnectionHandler> = new Set()
  private reconnectTimer: number | null = null
  private currentDeviceId: string | null = null
  private shouldReconnect = false

  connect(deviceId: string, type: 'network' | 'log' | 'both' | 'all' = 'all') {
    this.disconnect()
    this.currentDeviceId = deviceId
    this.shouldReconnect = true

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/live?deviceId=${deviceId}&type=${type}`

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      console.log('[Realtime] Connected')
      this.notifyConnectionHandlers(true)
    }

    this.ws.onclose = () => {
      console.log('[Realtime] Disconnected')
      this.notifyConnectionHandlers(false)
      this.scheduleReconnect()
    }

    this.ws.onerror = (error) => {
      console.error('[Realtime] Error:', error)
    }

    this.ws.onmessage = (event) => {
      try {
        const message: RealtimeMessage = JSON.parse(event.data)
        this.notifyMessageHandlers(message)
      } catch (error) {
        console.error('[Realtime] Failed to parse message:', error)
      }
    }
  }

  disconnect() {
    this.shouldReconnect = false
    this.currentDeviceId = null

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * 暂停重连（用于清空设备数据等场景）
   * 与 disconnect 不同，这个方法不会清除 currentDeviceId
   * 调用后需要手动调用 resumeReconnect 或 connect 来恢复连接
   */
  pauseReconnect() {
    this.shouldReconnect = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * 恢复重连
   * 如果之前有连接的设备，会尝试重新连接
   */
  resumeReconnect() {
    if (this.currentDeviceId) {
      this.shouldReconnect = true
      this.connect(this.currentDeviceId)
    }
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || !this.currentDeviceId) return

    this.reconnectTimer = window.setTimeout(() => {
      if (this.currentDeviceId) {
        console.log('[Realtime] Reconnecting...')
        this.connect(this.currentDeviceId)
      }
    }, 3000)
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onConnection(handler: ConnectionHandler) {
    this.connectionHandlers.add(handler)
    return () => this.connectionHandlers.delete(handler)
  }

  private notifyMessageHandlers(message: RealtimeMessage) {
    this.messageHandlers.forEach((handler) => handler(message))
  }

  private notifyConnectionHandlers(connected: boolean) {
    this.connectionHandlers.forEach((handler) => handler(connected))
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

export const realtimeService = new RealtimeService()

// 解析实时消息
export function parseHTTPEvent(payload: string): HTTPEventSummary {
  const data = JSON.parse(payload)
  return {
    id: data.request.id,
    method: data.request.method,
    url: data.request.url,
    statusCode: data.response?.statusCode ?? null,
    startTime: data.request.startTime,
    duration: data.response?.duration ?? null,
    isMocked: data.isMocked,
    mockRuleId: data.mockRuleId ?? null,
    errorDescription: data.response?.errorDescription ?? null,
    traceId: data.request.traceId ?? null,
    isFavorite: data.isFavorite ?? false,
    isReplay: data.isReplay ?? false,
    seqNum: data.seqNum ?? 0,
  }
}

export function parseLogEvent(payload: string): LogEvent {
  const data = JSON.parse(payload)
  return {
    ...data,
    seqNum: data.seqNum ?? 0,
  }
}

export function parseWSEvent(payload: string): { type: string; data: unknown } {
  const data = JSON.parse(payload)

  // 辅助函数：提取关联值（Swift Codable 默认将未命名的关联值编码为 _0）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractValue = (obj: any) => {
    if (obj && typeof obj === 'object' && '_0' in obj) {
      return obj._0
    }
    return obj
  }

  if (data.kind.sessionCreated) {
    return { type: 'sessionCreated', data: extractValue(data.kind.sessionCreated) }
  }
  if (data.kind.sessionClosed) {
    return { type: 'sessionClosed', data: extractValue(data.kind.sessionClosed) }
  }
  if (data.kind.frame) {
    return { type: 'frame', data: extractValue(data.kind.frame) }
  }
  return { type: 'unknown', data }
}

