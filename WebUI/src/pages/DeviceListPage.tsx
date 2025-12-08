import { useEffect, useState, useMemo } from 'react'
import { useDeviceStore } from '@/stores/deviceStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { DeviceCard } from '@/components/DeviceCard'
import { ListLoadingOverlay } from '@/components/ListLoadingOverlay'
import { RefreshIcon, IPhoneIcon, ClearIcon, XIcon, OnlineIcon, PackageIcon } from '@/components/icons'
import clsx from 'clsx'

type FilterType = 'all' | 'online' | 'offline'

export function DeviceListPage() {
  const { devices, isLoading, fetchDevices, removeAllOfflineDevices } = useDeviceStore()
  const { isServerOnline } = useConnectionStore()
  const [filter, setFilter] = useState<FilterType>('all')

  const onlineCount = devices.filter(d => d.isOnline).length
  const offlineCount = devices.filter(d => !d.isOnline).length

  const filteredDevices = useMemo(() => {
    switch (filter) {
      case 'online':
        return devices.filter(d => d.isOnline)
      case 'offline':
        return devices.filter(d => !d.isOnline)
      default:
        return devices
    }
  }, [devices, filter])

  useEffect(() => {
    fetchDevices()

    // 定期刷新设备列表
    const interval = setInterval(fetchDevices, 5000)
    return () => clearInterval(interval)
  }, [fetchDevices])

  const handleRemoveAllOffline = async () => {
    if (confirm(`确定要移除所有 ${offlineCount} 个离线设备吗？`)) {
      await removeAllOfflineDevices()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="px-6 py-5 bg-bg-dark border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              设备列表
            </h1>
            <p className="text-sm text-text-muted mt-1">
              管理已连接的调试设备 · {onlineCount} 在线 / {devices.length} 总计
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* 筛选按钮组 */}
            <div className="flex items-center gap-0.5 p-0.5 bg-bg-medium rounded-lg border border-border">
              <button
                onClick={() => setFilter('all')}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded transition-colors',
                  filter === 'all'
                    ? 'bg-primary text-bg-darkest'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-light'
                )}
              >
                全部 ({devices.length})
              </button>
              <button
                onClick={() => setFilter('online')}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded transition-colors',
                  filter === 'online'
                    ? 'bg-green-500 text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-light'
                )}
              >
                在线 ({onlineCount})
              </button>
              <button
                onClick={() => setFilter('offline')}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded transition-colors',
                  filter === 'offline'
                    ? 'bg-gray-500 text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-light'
                )}
              >
                离线 ({offlineCount})
              </button>
            </div>

            {offlineCount > 0 && (
              <button
                onClick={handleRemoveAllOffline}
                className="btn btn-secondary text-red-400 hover:text-red-300 flex items-center gap-2"
              >
                <ClearIcon size={16} />
                <span>移除离线</span>
              </button>
            )}
            <button
              onClick={fetchDevices}
              disabled={isLoading}
              className="btn btn-primary disabled:opacity-50 flex items-center gap-2"
            >
              <span className={isLoading ? 'animate-spin' : ''}>
                <RefreshIcon size={16} />
              </span>
              <span>刷新</span>
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 relative">
        {/* 刷新加载覆盖层 - 仅在有设备时显示 */}
        {filteredDevices.length > 0 && isServerOnline && (
          <ListLoadingOverlay isLoading={isLoading} text="刷新设备列表..." />
        )}

        {/* 服务未启动时显示服务状态 */}
        {!isServerOnline ? (
          <ServerOfflineState onRetry={fetchDevices} isLoading={isLoading} />
        ) : filteredDevices.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredDevices.map((device, index) => (
              <DeviceCard
                key={device.deviceId}
                device={device}
                style={{ animationDelay: `${index * 50}ms` }}
              />
            ))}
          </div>
        ) : (
          <EmptyState isLoading={isLoading} filter={filter} totalCount={devices.length} />
        )}
      </div>
    </div>
  )
}

function EmptyState({ isLoading, filter, totalCount }: { isLoading: boolean; filter: FilterType; totalCount: number }) {
  // 如果有设备但当前筛选结果为空
  if (totalCount > 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="glass-card p-12 text-center max-w-md">
          <IPhoneIcon size={48} className="mx-auto mb-4 text-text-muted opacity-50" />
          <h2 className="text-xl font-semibold text-text-primary mb-2">
            没有{filter === 'online' ? '在线' : '离线'}设备
          </h2>
          <p className="text-text-muted">
            {filter === 'online' ? '当前没有设备在线' : '所有设备都在线'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="glass-card p-12 text-center max-w-md">
        {isLoading ? (
          <>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-bg-light animate-pulse" />
            <div className="h-6 bg-bg-light rounded w-48 mx-auto mb-3 animate-pulse" />
            <div className="h-4 bg-bg-light rounded w-64 mx-auto animate-pulse" />
          </>
        ) : (
          <>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-bg-light flex items-center justify-center text-text-muted">
              <IPhoneIcon size={40} />
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">
              暂无在线设备
            </h2>
            <p className="text-sm text-text-muted mb-6">
              请确保 iOS App 已集成 DebugProbe 并连接到 Debug Hub
            </p>
            <div className="text-left bg-bg-medium rounded-xl p-4 text-xs font-mono text-text-secondary overflow-x-auto">
              <p className="text-text-muted mb-2">// 在 AppDelegate 中初始化</p>
              <p><span className="text-purple-400">let</span> config = <span className="text-primary">DebugProbe.Configuration</span>(</p>
              <p className="pl-4">hubURL: <span className="text-green-400">"ws://{'<'}host{'>'}:{'<'}port{'>'}/debug-bridge"</span></p>
              <p>)</p>
              <p className="mt-1"><span className="text-primary">DebugProbe</span>.shared.start(configuration: config)</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// 服务离线状态组件
function ServerOfflineState({ onRetry, isLoading }: { onRetry: () => void; isLoading: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-red-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-blue/5 rounded-full blur-3xl" />
      </div>

      <div className="max-w-lg w-full relative">
        <div className="glass-card p-10 text-center">
          {/* Status Icon */}
          <div className="w-28 h-28 mx-auto mb-8 rounded-full flex items-center justify-center text-5xl relative bg-red-500/10">
            {/* Pulse ring */}
            <div
              className="absolute inset-0 rounded-full animate-ping opacity-25 bg-red-500"
              style={{ animationDuration: '2s' }}
            />
            {/* Icon */}
            <span className="relative z-10">
              <XIcon size={48} />
            </span>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold mb-3 text-red-400">
            服务未启动
          </h1>
          <p className="text-text-secondary mb-10">
            无法连接到 Debug Hub 服务
          </p>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-4 mb-10">
            <div className="bg-bg-medium/50 rounded-xl p-4 border border-red-500/30 transition-all">
              <div className="flex items-center gap-2 mb-2">
                <OnlineIcon size={16} />
                <span className="text-xs text-text-muted uppercase tracking-wider">状态</span>
              </div>
              <div className="text-xl font-semibold text-red-400">
                OFFLINE
              </div>
            </div>
            <div className="bg-bg-medium/50 rounded-xl p-4 border border-border transition-all">
              <div className="flex items-center gap-2 mb-2">
                <PackageIcon size={16} />
                <span className="text-xs text-text-muted uppercase tracking-wider">服务</span>
              </div>
              <div className="text-xl font-semibold text-primary">
                Debug Hub
              </div>
            </div>
          </div>

          {/* Hint */}
          <div className="text-xs text-text-muted mb-8 p-3 bg-bg-medium/50 rounded-xl">
            <span className="opacity-70">提示:</span>
            <span className="ml-2 text-text-secondary">
              请确保 Debug Hub 服务已启动并运行在正确的端口上
            </span>
          </div>

          {/* Retry Button */}
          <button
            onClick={onRetry}
            disabled={isLoading}
            className="btn btn-primary flex items-center gap-2 mx-auto"
          >
            <span className={isLoading ? 'animate-spin' : ''}>
              <RefreshIcon size={16} />
            </span>
            <span>{isLoading ? '连接中...' : '重试连接'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
