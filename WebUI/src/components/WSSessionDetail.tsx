import { useState, useCallback, useRef, useEffect, memo } from 'react'
import type { WSSessionDetail as WSSessionDetailType, WSFrame, WSFrameDetail } from '@/types'
import { formatSmartTime, formatBytes } from '@/utils/format'
import { JSONTree } from './JSONTree'
import { getWSFrameDetail } from '@/services/api'
import clsx from 'clsx'

type PayloadFormat = 'auto' | 'text' | 'json' | 'hex' | 'base64'

interface WSSessionDetailProps {
  deviceId: string
  session: WSSessionDetailType | null
  frames: WSFrame[]
  loading?: boolean
  onLoadMore?: () => void
  hasMore?: boolean
  frameDirection: string
  onFrameDirectionChange: (direction: string) => void
}

export function WSSessionDetail({
  deviceId,
  session,
  frames,
  loading,
  onLoadMore,
  hasMore,
  frameDirection,
  onFrameDirectionChange,
}: WSSessionDetailProps) {
  const [activeTab, setActiveTab] = useState<'frames' | 'info'>('frames')
  const [expandedFrameId, setExpandedFrameId] = useState<string | null>(null)

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted">
        <span className="text-4xl mb-3 opacity-50">👈</span>
        <p className="text-sm">选择一个 WebSocket 会话查看详情</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 会话头部 */}
      <div className="px-4 py-3 border-b border-border bg-bg-dark/50">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">🔌</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-mono text-sm text-text-primary truncate">{session.url}</h3>
            <p className="text-xs text-text-muted">
              {session.frameCount} 帧 • 连接于 {formatSmartTime(session.connectTime)}
            </p>
          </div>
          <SessionStatusBadge
            isOpen={!session.disconnectTime}
            closeCode={session.closeCode}
          />
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="px-4 py-2 border-b border-border bg-bg-dark flex gap-2">
        <button
          onClick={() => setActiveTab('frames')}
          className={clsx(
            'px-3 py-1.5 text-xs font-medium rounded-lg transition-all',
            activeTab === 'frames'
              ? 'bg-primary/20 text-primary'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-light'
          )}
        >
          📨 消息帧 ({session.frameCount})
        </button>
        <button
          onClick={() => setActiveTab('info')}
          className={clsx(
            'px-3 py-1.5 text-xs font-medium rounded-lg transition-all',
            activeTab === 'info'
              ? 'bg-primary/20 text-primary'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-light'
          )}
        >
          ℹ️ 连接信息
        </button>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'frames' && (
          <FramesTab
            deviceId={deviceId}
            sessionId={session.id}
            frames={frames}
            loading={loading}
            onLoadMore={onLoadMore}
            hasMore={hasMore}
            expandedFrameId={expandedFrameId}
            onToggleExpand={setExpandedFrameId}
            direction={frameDirection}
            onDirectionChange={onFrameDirectionChange}
          />
        )}
        {activeTab === 'info' && <InfoTab session={session} />}
      </div>
    </div>
  )
}

function SessionStatusBadge({ isOpen, closeCode }: { isOpen: boolean; closeCode?: number | null }) {
  if (isOpen) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        连接中
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-full bg-text-muted/10 text-text-muted border border-border">
      已关闭{closeCode ? ` (${closeCode})` : ''}
    </span>
  )
}

function FramesTab({
  deviceId,
  sessionId,
  frames,
  loading,
  onLoadMore,
  hasMore,
  expandedFrameId,
  onToggleExpand,
  direction,
  onDirectionChange,
}: {
  deviceId: string
  sessionId: string
  frames: WSFrame[]
  loading?: boolean
  onLoadMore?: () => void
  hasMore?: boolean
  expandedFrameId: string | null
  onToggleExpand: (id: string | null) => void
  direction: string
  onDirectionChange: (direction: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const prevFrameCountRef = useRef(frames.length)

  // 自动滚动到底部（新帧到达时）
  useEffect(() => {
    if (!autoScroll || !listRef.current) return

    // 只在新帧到达时滚动
    if (frames.length > prevFrameCountRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
    prevFrameCountRef.current = frames.length
  }, [frames.length, autoScroll])

  // 统计发送/接收帧数
  const sendCount = frames.filter(f => f.direction === 'send').length
  const receiveCount = frames.filter(f => f.direction === 'receive').length
  const totalSize = frames.reduce((sum, f) => sum + (f.payloadSize || 0), 0)

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between gap-3 bg-bg-dark/30">
        <div className="flex items-center gap-3">
          {/* 方向筛选 */}
          <div className="flex items-center gap-1 bg-bg-light/50 rounded-lg p-1">
            <button
              onClick={() => onDirectionChange('')}
              className={clsx(
                'px-2 py-1 text-xs rounded transition-colors',
                !direction ? 'bg-bg-dark text-text-primary' : 'text-text-muted hover:text-text-primary'
              )}
            >
              全部
            </button>
            <button
              onClick={() => onDirectionChange('send')}
              className={clsx(
                'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                direction === 'send' ? 'bg-blue-500/20 text-blue-400' : 'text-text-muted hover:text-blue-400'
              )}
            >
              <span>↑</span> 发送
            </button>
            <button
              onClick={() => onDirectionChange('receive')}
              className={clsx(
                'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                direction === 'receive' ? 'bg-green-500/20 text-green-400' : 'text-text-muted hover:text-green-400'
              )}
            >
              <span>↓</span> 接收
            </button>
          </div>

          {/* 统计信息 */}
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="text-blue-400">↑{sendCount}</span>
            <span className="text-green-400">↓{receiveCount}</span>
            <span>• {formatBytes(totalSize)}</span>
          </div>
        </div>

        {/* 自动滚动开关 */}
        <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer hover:text-text-primary transition-colors">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-primary w-3 h-3"
          />
          自动滚动
        </label>
      </div>

      {/* 帧列表 */}
      <div ref={listRef} className="flex-1 overflow-auto">
        {frames.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted py-8">
            <span className="text-3xl mb-2 opacity-50">📭</span>
            <p className="text-sm">暂无消息帧</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {frames.map((frame) => (
              <FrameItem
                key={frame.id}
                deviceId={deviceId}
                sessionId={sessionId}
                frame={frame}
                isExpanded={expandedFrameId === frame.id}
                onToggle={() => onToggleExpand(expandedFrameId === frame.id ? null : frame.id)}
              />
            ))}
          </div>
        )}

        {/* 加载更多 */}
        {hasMore && (
          <div className="px-4 py-3 text-center">
            <button
              onClick={onLoadMore}
              disabled={loading}
              className="btn btn-secondary text-xs"
            >
              {loading ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// 使用 memo 优化帧项渲染
const FrameItem = memo(function FrameItem({
  deviceId,
  sessionId,
  frame,
  isExpanded,
  onToggle,
}: {
  deviceId: string
  sessionId: string
  frame: WSFrame
  isExpanded: boolean
  onToggle: () => void
}) {
  const isSend = frame.direction === 'send'
  const isText = frame.opcode === 'text'

  // 完整 payload 状态
  const [frameDetail, setFrameDetail] = useState<WSFrameDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [format, setFormat] = useState<PayloadFormat>('auto')

  // 加载完整 payload
  const loadFullPayload = useCallback(async () => {
    if (frameDetail || detailLoading) return
    setDetailLoading(true)
    setDetailError(null)
    try {
      const detail = await getWSFrameDetail(deviceId, sessionId, frame.id)
      setFrameDetail(detail)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setDetailLoading(false)
    }
  }, [deviceId, sessionId, frame.id, frameDetail, detailLoading])

  // 展开时加载完整 payload
  const handleToggle = () => {
    if (!isExpanded) {
      loadFullPayload()
    }
    onToggle()
  }

  // 格式化 payload 显示
  const renderPayload = () => {
    if (detailLoading) {
      return (
        <div className="bg-bg-dark rounded-lg p-4 text-center text-text-muted text-sm">
          <span className="animate-pulse">加载中...</span>
        </div>
      )
    }

    if (detailError) {
      return (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center text-red-400 text-sm">
          {detailError}
        </div>
      )
    }

    if (!frameDetail) {
      return (
        <div className="bg-bg-dark rounded-lg p-3 text-xs font-mono text-text-secondary">
          {frame.payloadPreview || '(无法预览)'}
        </div>
      )
    }

    const { payloadText, payloadBase64 } = frameDetail
    const currentFormat = format === 'auto' ? detectBestFormat(payloadText) : format

    switch (currentFormat) {
      case 'json': {
        try {
          const parsed = JSON.parse(payloadText || '')
          return (
            <div className="bg-bg-dark rounded-lg p-3 max-h-80 overflow-auto">
              <JSONTree data={parsed} />
            </div>
          )
        } catch {
          // 回退到文本
          return (
            <pre className="bg-bg-dark rounded-lg p-3 text-xs font-mono text-text-secondary overflow-auto max-h-60 whitespace-pre-wrap break-all">
              {payloadText || payloadBase64}
            </pre>
          )
        }
      }
      case 'text':
        return (
          <pre className="bg-bg-dark rounded-lg p-3 text-xs font-mono text-text-secondary overflow-auto max-h-60 whitespace-pre-wrap break-all">
            {payloadText || '(binary - cannot display as text)'}
          </pre>
        )
      case 'hex':
        return (
          <pre className="bg-bg-dark rounded-lg p-3 text-xs font-mono text-text-secondary overflow-auto max-h-60 whitespace-pre-wrap break-all">
            {base64ToHex(payloadBase64)}
          </pre>
        )
      case 'base64':
        return (
          <pre className="bg-bg-dark rounded-lg p-3 text-xs font-mono text-text-secondary overflow-auto max-h-60 whitespace-pre-wrap break-all">
            {payloadBase64}
          </pre>
        )
      default:
        return (
          <pre className="bg-bg-dark rounded-lg p-3 text-xs font-mono text-text-secondary overflow-auto max-h-60 whitespace-pre-wrap break-all">
            {payloadText || base64ToHex(payloadBase64)}
          </pre>
        )
    }
  }

  return (
    <div
      className={clsx(
        'px-4 py-2 cursor-pointer transition-all',
        'hover:bg-bg-light/30',
        isExpanded && 'bg-bg-light/50',
        // 添加方向指示的边框颜色
        isSend ? 'border-l-2 border-l-blue-500/50' : 'border-l-2 border-l-green-500/50'
      )}
      onClick={handleToggle}
    >
      {/* 帧头部 */}
      <div className="flex items-center gap-3">
        {/* 方向图标 */}
        <span
          className={clsx(
            'w-7 h-7 rounded-lg flex items-center justify-center text-sm font-medium',
            isSend ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'
          )}
        >
          {isSend ? '↑' : '↓'}
        </span>

        {/* 预览 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'text-xs font-mono uppercase px-1.5 py-0.5 rounded',
                frame.opcode === 'text' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
              )}
            >
              {frame.opcode}
            </span>
            <span className="text-xs text-text-muted">{formatBytes(frame.payloadSize)}</span>
            {frame.isMocked && (
              <span className="text-2xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">
                MOCK
              </span>
            )}
          </div>
          {!isExpanded && (
            <p className="text-xs text-text-secondary truncate font-mono mt-0.5">
              {frame.payloadPreview || (isText ? '(empty)' : '(binary data)')}
            </p>
          )}
        </div>

        {/* 时间 */}
        <span className="text-xs text-text-muted whitespace-nowrap">{formatSmartTime(frame.timestamp)}</span>

        {/* 展开指示 */}
        <span className={clsx('text-xs text-text-muted transition-transform', isExpanded && 'rotate-90')}>
          ▶
        </span>
      </div>

      {/* 展开内容 */}
      {isExpanded && (
        <div className="mt-3 ml-10" onClick={(e) => e.stopPropagation()}>
          {/* 格式切换 */}
          {frameDetail && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-text-muted">格式:</span>
              {(['auto', 'text', 'json', 'hex', 'base64'] as PayloadFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={clsx(
                    'px-2 py-0.5 text-xs rounded transition-colors',
                    format === f
                      ? 'bg-primary/20 text-primary'
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-light'
                  )}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {renderPayload()}
        </div>
      )}
    </div>
  )
})

// 检测最佳显示格式
function detectBestFormat(payloadText: string | null): PayloadFormat {
  if (!payloadText) return 'hex'
  try {
    JSON.parse(payloadText)
    return 'json'
  } catch {
    return 'text'
  }
}

// Base64 转 Hex 显示
function base64ToHex(base64: string): string {
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    // 格式化为 hex dump 格式
    const lines: string[] = []
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16)
      const hex = Array.from(chunk)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')
      const ascii = Array.from(chunk)
        .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
        .join('')
      const offset = i.toString(16).padStart(8, '0')
      lines.push(`${offset}  ${hex.padEnd(48)}  ${ascii}`)
    }
    return lines.join('\n')
  } catch {
    return base64
  }
}

function InfoTab({ session }: { session: WSSessionDetailType }) {
  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      {/* 基本信息 */}
      <div className="glass-card p-4">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
          连接信息
        </h4>
        <dl className="space-y-2 text-sm">
          <InfoRow label="URL" value={session.url} mono />
          <InfoRow label="连接时间" value={formatSmartTime(session.connectTime)} />
          {session.disconnectTime && (
            <InfoRow label="断开时间" value={formatSmartTime(session.disconnectTime)} />
          )}
          {session.closeCode && <InfoRow label="关闭码" value={String(session.closeCode)} />}
          {session.closeReason && <InfoRow label="关闭原因" value={session.closeReason} />}
          {session.subprotocols.length > 0 && (
            <InfoRow label="子协议" value={session.subprotocols.join(', ')} />
          )}
        </dl>
      </div>

      {/* 请求头 */}
      {Object.keys(session.requestHeaders).length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
            请求头
          </h4>
          <dl className="space-y-1.5">
            {Object.entries(session.requestHeaders).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-xs">
                <span className="text-primary font-medium">{key}:</span>
                <span className="text-text-secondary font-mono break-all">{value}</span>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="text-text-muted w-20 flex-shrink-0">{label}</dt>
      <dd className={clsx('text-text-primary break-all', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  )
}
