import type { HTTPTiming } from '@/types'
import { formatBytes } from '@/utils/format'

interface TimingWaterfallProps {
  timing: HTTPTiming
  totalDuration: number | null
}

interface TimingSegment {
  label: string
  value: number | null
  color: string
  description: string
}

export function TimingWaterfall({ timing, totalDuration }: TimingWaterfallProps) {
  const segments: TimingSegment[] = [
    {
      label: 'DNS',
      value: timing.dnsLookup,
      color: 'bg-cyan-500',
      description: 'DNS 解析',
    },
    {
      label: 'TCP',
      value: timing.tcpConnection,
      color: 'bg-green-500',
      description: 'TCP 连接',
    },
    {
      label: 'TLS',
      value: timing.tlsHandshake,
      color: 'bg-purple-500',
      description: 'TLS 握手',
    },
    {
      label: 'TTFB',
      value: timing.timeToFirstByte,
      color: 'bg-amber-500',
      description: '首字节时间',
    },
    {
      label: 'Download',
      value: timing.contentDownload,
      color: 'bg-blue-500',
      description: '内容下载',
    },
  ]

  // 计算有效的总时间
  const measuredTotal = segments.reduce((sum, seg) => sum + (seg.value || 0), 0)
  const total = totalDuration || measuredTotal || 1

  // 格式化毫秒
  const formatMs = (seconds: number | null): string => {
    if (seconds === null || seconds === undefined) return '-'
    const ms = seconds * 1000
    if (ms < 1) return `${Math.round(ms * 1000)}µs`
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  // 计算百分比
  const getPercentage = (value: number | null): number => {
    if (value === null || value === undefined) return 0
    return (value / total) * 100
  }

  return (
    <div className="space-y-4">
      {/* 瀑布图 */}
      <div className="space-y-2">
        {segments.map((segment) => {
          const percentage = getPercentage(segment.value)
          if (segment.value === null) return null

          return (
            <div key={segment.label} className="flex items-center gap-3">
              <div className="w-16 text-xs text-text-muted shrink-0">{segment.label}</div>
              <div className="flex-1 h-5 bg-bg-dark rounded overflow-hidden relative">
                <div
                  className={`h-full ${segment.color} transition-all duration-300`}
                  style={{ width: `${Math.max(percentage, 1)}%` }}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-mono">
                  {formatMs(segment.value)}
                </span>
              </div>
              <div className="w-12 text-xs text-text-muted text-right shrink-0">
                {percentage.toFixed(1)}%
              </div>
            </div>
          )
        })}
      </div>

      {/* 总时间 */}
      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <div className="w-16 text-xs font-medium shrink-0">Total</div>
        <div className="flex-1 text-xs font-mono text-primary">
          {formatMs(total)}
        </div>
      </div>

      {/* 连接信息 */}
      <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border text-xs">
        {timing.protocolName && (
          <div>
            <span className="text-text-muted">协议:</span>{' '}
            <span className="font-mono text-primary">{timing.protocolName}</span>
          </div>
        )}
        {timing.connectionReused !== null && (
          <div>
            <span className="text-text-muted">连接复用:</span>{' '}
            <span className={timing.connectionReused ? 'text-green-400' : 'text-yellow-400'}>
              {timing.connectionReused ? '是' : '否'}
            </span>
          </div>
        )}
        {timing.localAddress && (
          <div>
            <span className="text-text-muted">本地地址:</span>{' '}
            <span className="font-mono">{timing.localAddress}</span>
          </div>
        )}
        {timing.remoteAddress && (
          <div>
            <span className="text-text-muted">远程地址:</span>{' '}
            <span className="font-mono">{timing.remoteAddress}</span>
          </div>
        )}
        {timing.requestBodyBytesSent !== null && (
          <div>
            <span className="text-text-muted">发送:</span>{' '}
            <span className="font-mono">{formatBytes(timing.requestBodyBytesSent)}</span>
          </div>
        )}
        {timing.responseBodyBytesReceived !== null && (
          <div>
            <span className="text-text-muted">接收:</span>{' '}
            <span className="font-mono">{formatBytes(timing.responseBodyBytesReceived)}</span>
          </div>
        )}
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap gap-3 pt-2 border-t border-border">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center gap-1.5 text-xs">
            <div className={`w-3 h-3 rounded ${segment.color}`} />
            <span className="text-text-muted">{segment.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// 紧凑版本，用于列表中显示
export function TimingBar({ timing, totalDuration }: TimingWaterfallProps) {
  const segments = [
    { value: timing.dnsLookup, color: 'bg-cyan-500' },
    { value: timing.tcpConnection, color: 'bg-green-500' },
    { value: timing.tlsHandshake, color: 'bg-purple-500' },
    { value: timing.timeToFirstByte, color: 'bg-amber-500' },
    { value: timing.contentDownload, color: 'bg-blue-500' },
  ]

  const total = totalDuration || segments.reduce((sum, seg) => sum + (seg.value || 0), 0) || 1

  return (
    <div className="flex h-2 rounded overflow-hidden bg-bg-dark">
      {segments.map((segment, i) => {
        if (segment.value === null) return null
        const percentage = (segment.value / total) * 100
        const ms = segment.value * 1000
        const msFormatted = ms < 1 ? `${Math.round(ms * 1000)}µs` : `${Math.round(ms)}ms`
        return (
          <div
            key={i}
            className={`${segment.color} transition-all duration-300`}
            style={{ width: `${percentage}%` }}
            title={msFormatted}
          />
        )
      })}
    </div>
  )
}
