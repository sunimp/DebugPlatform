import { useEffect, useState } from 'react'
import { getServerStats } from '@/services/api'
import type { ServerStats } from '@/types'

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '-'
  if (bytes === 0) return '0 B'
  if (isNaN(bytes)) return '-'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  // 确保索引不超出数组范围
  const sizeIndex = Math.min(i, sizes.length - 1)
  
  return parseFloat((bytes / Math.pow(k, sizeIndex)).toFixed(1)) + ' ' + sizes[sizeIndex]
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toString()
}

export function ServerStatsPanel() {
  const [stats, setStats] = useState<ServerStats | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const fetchStats = async () => {
    setIsLoading(true)
    try {
      const data = await getServerStats()
      setStats(data)
    } catch (error) {
      console.error('Failed to fetch server stats:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
    // 每 30 秒刷新一次
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  if (!stats) {
    return null
  }

  const StatRow = ({ icon, label, value }: { icon: string; label: string; value: string | number }) => (
    <div className="flex justify-between items-center py-1">
      <span className="text-text-muted">
        <span className="mr-1.5">{icon}</span>
        {label}
      </span>
      <span className="font-mono text-text-primary">{value}</span>
    </div>
  )

  return (
    <div className="border-t border-border">
      {/* Header - clickable to expand */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-bg-light transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>📊</span>
          <span className="text-xs font-medium text-text-primary">服务器统计</span>
        </div>
        <div className="flex items-center gap-2">
          {!isExpanded && stats && (
            <span className="text-xs text-text-muted">
              {formatNumber(stats.httpEventCount)} HTTP · {formatNumber(stats.logEventCount)} Log
            </span>
          )}
          <span className={`text-xs text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-3 text-xs space-y-0.5">
          {/* 数据统计 */}
          <div className="text-text-muted/60 text-2xs uppercase tracking-wider mt-1 mb-1">数据记录</div>
          <StatRow icon="🌐" label="HTTP 事件" value={formatNumber(stats.httpEventCount)} />
          <StatRow icon="📝" label="日志条目" value={formatNumber(stats.logEventCount)} />
          <StatRow icon="🔌" label="WS 会话" value={formatNumber(stats.wsSessionCount)} />
          <StatRow icon="📨" label="WS 帧" value={formatNumber(stats.wsFrameCount)} />
          
          {/* 规则统计 */}
          <div className="text-text-muted/60 text-2xs uppercase tracking-wider mt-2 mb-1">规则配置</div>
          <StatRow icon="🎭" label="Mock 规则" value={stats.mockRuleCount} />
          <StatRow icon="⏸️" label="断点规则" value={stats.breakpointRuleCount} />
          <StatRow icon="🌀" label="混沌规则" value={stats.chaosRuleCount} />
          <StatRow icon="🚦" label="流量规则" value={stats.trafficRuleCount} />
          
          {/* 设备统计 */}
          <div className="text-text-muted/60 text-2xs uppercase tracking-wider mt-2 mb-1">设备连接</div>
          <StatRow icon="📱" label="在线设备" value={stats.onlineDeviceCount} />
          <StatRow icon="📋" label="历史会话" value={stats.deviceSessionCount} />
          
          {/* 数据库大小 */}
          {stats.databaseSizeBytes !== null && (
            <>
              <div className="text-text-muted/60 text-2xs uppercase tracking-wider mt-2 mb-1">存储</div>
              <StatRow icon="💾" label="数据库大小" value={formatBytes(stats.databaseSizeBytes)} />
            </>
          )}
          
          {/* 刷新按钮 */}
          <button
            onClick={fetchStats}
            disabled={isLoading}
            className="mt-2 w-full py-1.5 text-center text-xs text-text-muted hover:text-text-primary hover:bg-bg-light rounded transition-colors disabled:opacity-50"
          >
            {isLoading ? '刷新中...' : '🔄 刷新统计'}
          </button>
        </div>
      )}
    </div>
  )
}
