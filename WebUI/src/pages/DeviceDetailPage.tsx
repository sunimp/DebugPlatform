import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useDeviceStore } from '@/stores/deviceStore'
import { useHTTPStore } from '@/stores/httpStore'
import { useLogStore } from '@/stores/logStore'
import { useWSStore } from '@/stores/wsStore'
import { useMockStore } from '@/stores/mockStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useThemeStore } from '@/stores/themeStore'
import { useSessionActivityStore } from '@/stores/sessionActivityStore'
import { useBreakpointStore } from '@/stores/breakpointStore'
import { realtimeService, parseHTTPEvent, parseLogEvent, parseWSEvent } from '@/services/realtime'
import { VirtualHTTPEventTable } from '@/components/VirtualHTTPEventTable'
import { GroupedHTTPEventList } from '@/components/GroupedHTTPEventList'
import { HTTPEventDetail } from '@/components/HTTPEventDetail'
import { LogList } from '@/components/LogList'
import { LogFilters } from '@/components/LogFilters'
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp'
import { WSSessionList } from '@/components/WSSessionList'
import { WSSessionDetail } from '@/components/WSSessionDetail'
import { MockRuleList } from '@/components/MockRuleList'
import { MockRuleEditor } from '@/components/MockRuleEditor'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SessionActivityIndicator } from '@/components/SessionActivityIndicator'
import { BreakpointManager } from '@/components/BreakpointManager'
import { ChaosManager } from '@/components/ChaosManager'
import { DBInspector } from '@/components/DBInspector'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { getExportHTTPUrl, getExportLogsUrl, getExportHARUrl, getWSSessionDetail } from '@/services/api'
import type { BreakpointHit } from '@/types'
import clsx from 'clsx'

type Tab = 'http' | 'logs' | 'websocket' | 'mock' | 'breakpoint' | 'chaos' | 'database'

// 标签配置：按功能分组
// 1. 核心监控: HTTP, WebSocket, 日志（最常用）
// 2. 调试干预: 断点, Mock, 故障注入（主动操作）
// 3. 数据查看: 数据库（独立功能）
const tabConfig: Array<{ id: Tab; label: string; icon: string; description: string; group?: 'monitor' | 'debug' | 'data' }> = [
  // 核心监控功能
  { id: 'http', label: 'HTTP', icon: '🌐', description: 'HTTP/HTTPS 请求', group: 'monitor' },
  { id: 'websocket', label: 'WebSocket', icon: '🔌', description: 'WS 连接', group: 'monitor' },
  { id: 'logs', label: '日志', icon: '📝', description: '应用日志', group: 'monitor' },
  // 调试干预功能
  { id: 'breakpoint', label: '断点', icon: '⏸️', description: '请求断点', group: 'debug' },
  { id: 'mock', label: 'Mock', icon: '🎭', description: '接口模拟', group: 'debug' },
  { id: 'chaos', label: '故障注入', icon: '🎲', description: '故障注入', group: 'debug' },
  // 数据查看功能
  { id: 'database', label: '数据库', icon: '🗃️', description: 'SQLite 浏览', group: 'data' },
]

export function DeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // 从 URL 参数读取初始 tab（支持旧的 network 参数向后兼容）
  const tabParam = searchParams.get('tab')
  const initialTab = (tabParam === 'network' ? 'http' : tabParam as Tab) || 'http'
  const [activeTab, setActiveTabState] = useState<Tab>(initialTab)
  const [networkCapture, setNetworkCapture] = useState(true)
  const [logCapture, setLogCapture] = useState(true)
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false)
  const [showClearDeviceDialog, setShowClearDeviceDialog] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showActivityPanel, setShowActivityPanel] = useState(false)

  // 同时更新 state 和 URL 的 tab 切换函数
  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabState(tab)
    setSearchParams({ tab }, { replace: true })
  }, [setSearchParams])

  const { currentDevice, selectDevice, clearSelection, toggleCapture, clearDeviceData, toggleFavorite, isFavorite } =
    useDeviceStore()
  const { setConnected, setInDeviceDetail } = useConnectionStore()
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const { addActivity, clearActivities } = useSessionActivityStore()

  // HTTP Store
  const httpStore = useHTTPStore()

  // Log Store
  const logStore = useLogStore()

  // WebSocket Store
  const wsStore = useWSStore()

  // Mock Store
  const mockStore = useMockStore()

  // Breakpoint Store
  const breakpointStore = useBreakpointStore()

  // 键盘快捷键
  useKeyboardShortcuts([
    // 标签切换快捷键 (⌘1-7)
    ...tabConfig.map((tab, index) => ({
      key: String(index + 1),
      ctrl: true,
      description: `切换到${tab.label}`,
      action: () => setActiveTab(tab.id),
    })),
    {
      key: 'k',
      ctrl: true,
      description: '搜索',
      action: () => {
        const searchInput = document.querySelector<HTMLInputElement>('[data-search-input]')
        searchInput?.focus()
      },
    },
    {
      key: 'r',
      ctrl: true,
      description: '刷新',
      action: () => {
        if (deviceId) {
          if (activeTab === 'http') httpStore.fetchEvents(deviceId)
          else if (activeTab === 'logs') logStore.fetchEvents(deviceId)
          else if (activeTab === 'websocket') wsStore.fetchSessions(deviceId)
          else if (activeTab === 'mock') mockStore.fetchRules(deviceId)
        }
      },
    },
    {
      key: 'l',
      ctrl: true,
      description: '清空列表',
      action: () => {
        if (activeTab === 'http') {
          httpStore.clearEvents()
        } else if (activeTab === 'logs') {
          logStore.clearEvents()
        }
      },
    },
    {
      key: 't',
      ctrl: true,
      description: '切换主题',
      action: toggleTheme,
    },
    {
      key: '/',
      ctrl: true,
      description: '显示快捷键帮助',
      action: () => setShowShortcutsHelp(true),
    },
    {
      key: 'Escape',
      description: '取消选择',
      action: () => {
        if (showShortcutsHelp) {
          setShowShortcutsHelp(false)
        } else if (mockStore.isEditorOpen) {
          mockStore.closeEditor()
        } else if (httpStore.isSelectMode) {
          httpStore.toggleSelectMode()
        } else {
          httpStore.clearSelection()
        }
      },
    },
    {
      key: 'a',
      ctrl: true,
      description: '全选',
      action: () => {
        if (activeTab === 'http' && httpStore.isSelectMode) {
          httpStore.selectAll()
        }
      },
    },
    {
      key: 'Backspace',
      description: '删除选中',
      action: () => {
        if (
          activeTab === 'http' &&
          httpStore.isSelectMode &&
          httpStore.selectedIds.size > 0 &&
          deviceId
        ) {
          httpStore.batchDelete(deviceId)
        }
      },
    },
    {
      key: 'f',
      description: '收藏',
      action: () => {
        if (
          activeTab === 'http' &&
          httpStore.isSelectMode &&
          httpStore.selectedIds.size > 0 &&
          deviceId
        ) {
          httpStore.batchFavorite(deviceId, true)
        }
      },
    },
  ])

  // 加载设备详情和数据
  useEffect(() => {
    if (!deviceId) return

    // 标记进入设备详情页
    setInDeviceDetail(true)

    selectDevice(deviceId)
    httpStore.fetchEvents(deviceId)
    logStore.fetchEvents(deviceId)
    logStore.fetchFilterOptions(deviceId)
    wsStore.fetchSessions(deviceId)
    mockStore.fetchRules(deviceId)

    // 连接实时流
    realtimeService.connect(deviceId)

    const unsubMessage = realtimeService.onMessage((message) => {
      if (message.deviceId !== deviceId) return

      switch (message.type) {
        case 'httpEvent':
          httpStore.addRealtimeEvent(parseHTTPEvent(message.payload))
          break
        case 'logEvent':
          logStore.addRealtimeEvent(parseLogEvent(message.payload))
          break
        case 'wsEvent': {
          const wsEvent = parseWSEvent(message.payload)
          if (wsEvent.type === 'sessionCreated') {
            const session = wsEvent.data as { id: string; url: string; connectTime: string }
            wsStore.addRealtimeSession({
              id: session.id,
              url: session.url,
              connectTime: session.connectTime,
              disconnectTime: null,
              closeCode: null,
              closeReason: null,
              isOpen: true,
            })
          } else if (wsEvent.type === 'sessionClosed') {
            const data = wsEvent.data as { id: string; closeCode?: number; closeReason?: string }
            wsStore.updateSessionStatus(data.id, false, data.closeCode, data.closeReason)
          } else if (wsEvent.type === 'frame') {
            const frame = wsEvent.data as {
              id: string
              sessionId: string
              direction: 'send' | 'receive'
              opcode: string
              payload?: string // base64 encoded
              payloadPreview?: string
              timestamp: string
              isMocked: boolean
            }

            // 如果没有对应的 session，尝试从 API 获取
            // 这可能发生在 sessionCreated 事件丢失或页面刷新后的情况
            if (!wsStore.sessions.some(s => s.id === frame.sessionId)) {
              // 先创建一个占位 session 避免重复请求
              wsStore.addRealtimeSession({
                id: frame.sessionId,
                url: '(loading...)',
                connectTime: frame.timestamp,
                disconnectTime: null,
                closeCode: null,
                closeReason: null,
                isOpen: true,
              })
              // 异步获取真实的 session 信息
              getWSSessionDetail(deviceId, frame.sessionId)
                .then(detail => {
                  wsStore.updateSessionUrl(frame.sessionId, detail.url)
                })
                .catch(() => {
                  // 如果获取失败，更新为 unknown
                  wsStore.updateSessionUrl(frame.sessionId, '(unknown)')
                })
            }

            // payload 是 base64 编码的字符串，计算实际字节大小
            const payloadSize = frame.payload ? Math.floor(frame.payload.length * 3 / 4) : 0
            wsStore.addRealtimeFrame({
              id: frame.id,
              sessionId: frame.sessionId,
              direction: frame.direction,
              opcode: frame.opcode,
              payloadPreview: frame.payloadPreview ?? null,
              payloadSize,
              timestamp: frame.timestamp,
              isMocked: frame.isMocked,
            })
          }
          break
        }
        case 'deviceConnected': {
          const data = JSON.parse(message.payload)
          // 添加到连接活动记录（独立于 HTTP 列表）
          addActivity({
            id: `${data.sessionId}-connected`,
            deviceId: deviceId,
            sessionId: data.sessionId,
            timestamp: new Date().toISOString(),
            type: 'connected',
            deviceName: data.deviceName,
          })
          break
        }
        case 'deviceDisconnected': {
          // 添加到连接活动记录
          addActivity({
            id: `${Date.now()}-disconnected`,
            deviceId: deviceId,
            sessionId: '',
            timestamp: new Date().toISOString(),
            type: 'disconnected',
          })
          break
        }
        case 'breakpointHit': {
          // 解析断点命中事件
          const hit = JSON.parse(message.payload) as BreakpointHit
          breakpointStore.addHit(hit)
          // 自动切换到断点 tab
          setActiveTab('breakpoint')
          break
        }
      }
    })

    const unsubConnection = realtimeService.onConnection(setConnected)

    return () => {
      unsubMessage()
      unsubConnection()
      realtimeService.disconnect()
      clearSelection()
      httpStore.clearEvents()
      logStore.clearEvents()
      wsStore.clearSessions()
      mockStore.clearRules()
      breakpointStore.clear()
      clearActivities()
      // 标记离开设备详情页
      setInDeviceDetail(false)
    }
  }, [deviceId])

  const handleBack = () => {
    navigate('/')
  }

  // 修复：正确处理捕获开关
  const handleNetworkCaptureChange = useCallback((checked: boolean) => {
    setNetworkCapture(checked)
    toggleCapture(checked, logCapture)
  }, [toggleCapture, logCapture])

  const handleLogCaptureChange = useCallback((checked: boolean) => {
    setLogCapture(checked)
    toggleCapture(networkCapture, checked)
  }, [toggleCapture, networkCapture])

  const handleClearDeviceData = useCallback(async () => {
    await clearDeviceData()
    httpStore.clearEvents()
    logStore.clearEvents()
    wsStore.clearSessions()
    setShowClearDeviceDialog(false)
  }, [clearDeviceData])

  const handleSelectHTTPEvent = useCallback(
    (eventId: string) => {
      if (deviceId) {
        httpStore.selectEvent(deviceId, eventId)
      }
    },
    [deviceId]
  )

  const handleShowRelatedLogs = useCallback((traceId: string) => {
    logStore.setFilter('traceId', traceId)
    setActiveTab('logs')
  }, [])

  const handleFavoriteChange = useCallback((eventId: string, isFavorite: boolean) => {
    httpStore.updateEventFavorite(eventId, isFavorite)
  }, [])

  if (!deviceId) return null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="px-6 py-5 bg-bg-dark border-b border-border">
        <div className="flex items-center gap-5">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors group px-3 py-2 rounded hover:bg-bg-light"
          >
            <span className="group-hover:-translate-x-1 transition-transform text-lg">←</span>
            <span className="font-medium">返回</span>
          </button>

          <div className="h-8 w-px bg-border" />

          <div className="flex items-center gap-4 flex-1">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center border border-border">
              <span className="text-2xl">📱</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
                {currentDevice?.deviceInfo.deviceName || '加载中...'}
                {deviceId && (
                  <button
                    onClick={() => toggleFavorite(deviceId)}
                    className={clsx(
                      "p-1 rounded transition-colors",
                      isFavorite(deviceId)
                        ? "text-yellow-400 hover:text-yellow-300"
                        : "text-text-muted hover:text-yellow-400"
                    )}
                    title={isFavorite(deviceId) ? "取消收藏" : "收藏设备"}
                  >
                    {isFavorite(deviceId) ? "⭐" : "☆"}
                  </button>
                )}
              </h1>
              {currentDevice && (
                <p className="text-sm text-text-muted mt-0.5">
                  {currentDevice.deviceInfo.platform} {currentDevice.deviceInfo.systemVersion} • <span className="text-text-secondary">{currentDevice.deviceInfo.appName}</span>
                </p>
              )}
            </div>
            {currentDevice && (
              <span
                className={clsx(
                  'badge ml-3 px-3 py-1',
                  currentDevice.isOnline ? 'badge-success' : 'badge-danger'
                )}
              >
                <span className={clsx(
                  'w-2 h-2 rounded-full mr-2',
                  currentDevice.isOnline ? 'bg-green-400' : 'bg-red-400'
                )} />
                {currentDevice.isOnline ? '在线' : '离线'}
              </span>
            )}

            {/* Connection Activity Indicator */}
            {deviceId && (
              <SessionActivityIndicator
                deviceId={deviceId}
                isExpanded={showActivityPanel}
                onToggleExpand={() => setShowActivityPanel(!showActivityPanel)}
              />
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Capture Toggles */}
            <div className="flex items-center gap-5 px-5 py-2.5 bg-bg-medium rounded-lg border border-border">
              <label className="flex items-center gap-2.5 text-sm cursor-pointer group">
                <input
                  type="checkbox"
                  checked={networkCapture}
                  onChange={(e) => handleNetworkCaptureChange(e.target.checked)}
                  className="accent-primary w-4 h-4"
                />
                <span className="text-text-secondary group-hover:text-text-primary transition-colors font-medium">
                  🌐 网络
                </span>
              </label>
              <div className="w-px h-5 bg-border" />
              <label className="flex items-center gap-2.5 text-sm cursor-pointer group">
                <input
                  type="checkbox"
                  checked={logCapture}
                  onChange={(e) => handleLogCaptureChange(e.target.checked)}
                  className="accent-primary w-4 h-4"
                />
                <span className="text-text-secondary group-hover:text-text-primary transition-colors font-medium">
                  📝 日志
                </span>
              </label>
            </div>

            <button
              onClick={() => setShowShortcutsHelp(true)}
              className="btn btn-ghost px-3.5 py-2.5 rounded"
              title="快捷键 (Ctrl+/)"
            >
              ⌨️
            </button>

            {/* More Menu */}
            <div className="relative">
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="btn btn-ghost px-3.5 py-2.5 rounded"
                title="更多操作"
              >
                ⋮
              </button>
              {showMoreMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowMoreMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-52 bg-bg-dark border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                    <button
                      onClick={() => {
                        setShowMoreMenu(false)
                        setShowClearDeviceDialog(true)
                      }}
                      className="w-full px-4 py-3.5 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-3 transition-colors font-medium"
                    >
                      <span>🗑️</span>
                      <span>清空设备数据</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Tabs - 按功能分组显示 */}
      <div className="px-6 py-4 bg-bg-dark border-b border-border">
        <div className="flex items-center gap-1 p-1 bg-bg-medium rounded-lg border border-border w-fit">
          {tabConfig.map((tab, index) => {
            // 在不同分组之间添加分隔线
            const prevTab = tabConfig[index - 1]
            const showSeparator = prevTab && prevTab.group !== tab.group

            return (
              <div key={tab.id} className="flex items-center">
                {showSeparator && (
                  <div className="w-px h-6 bg-border mx-1" />
                )}
                <button
                  onClick={() => setActiveTab(tab.id)}
                  title={`${tab.description} (⌘${index + 1})`}
                  className={clsx(
                    'flex items-center gap-2 px-5 py-2.5 rounded text-sm font-medium transition-colors relative',
                    activeTab === tab.id
                      ? 'bg-primary text-bg-darkest'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-light'
                  )}
                >
                  <span className="text-base">{tab.icon}</span>
                  <span>{tab.label}</span>
                  {/* Breakpoint pending count badge */}
                  {tab.id === 'breakpoint' && breakpointStore.pendingHits.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center animate-pulse">
                      {breakpointStore.pendingHits.length}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'http' && (
          <HTTPTab
            deviceId={deviceId}
            httpStore={httpStore}
            onSelectEvent={handleSelectHTTPEvent}
            onShowRelatedLogs={handleShowRelatedLogs}
            onFavoriteChange={handleFavoriteChange}
            onRefresh={() => httpStore.fetchEvents(deviceId)}
          />
        )}

        {activeTab === 'websocket' && (
          <WebSocketTab deviceId={deviceId} wsStore={wsStore} />
        )}

        {activeTab === 'logs' && (
          <LogsTab
            deviceId={deviceId}
            logStore={logStore}
            onRefresh={() => logStore.fetchEvents(deviceId)}
          />
        )}

        {activeTab === 'mock' && (
          <MockTab deviceId={deviceId} mockStore={mockStore} />
        )}

        {activeTab === 'breakpoint' && (
          <BreakpointManager
            deviceId={deviceId}
            pendingHits={breakpointStore.pendingHits}
            onResumeBreakpoint={(requestId, action) => breakpointStore.resumeBreakpoint(deviceId, requestId, action)}
          />
        )}

        {activeTab === 'chaos' && (
          <ChaosManager deviceId={deviceId} />
        )}

        {activeTab === 'database' && (
          <DBInspector deviceId={deviceId} />
        )}
      </div>

      {/* Keyboard Shortcuts Help Modal */}
      <KeyboardShortcutsHelp isOpen={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />

      {/* Clear Device Data Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showClearDeviceDialog}
        onClose={() => setShowClearDeviceDialog(false)}
        onConfirm={handleClearDeviceData}
        title="清空设备数据"
        message={`确定要清空 "${currentDevice?.deviceInfo.deviceName || '该设备'}" 的所有数据吗？\n\n这将删除：\n• 所有 HTTP 请求记录\n• 所有日志事件\n• 所有 WebSocket 会话\n\n此操作不可恢复。`}
        confirmText="确认清空"
        cancelText="取消"
        type="danger"
      />
    </div>
  )
}

// HTTP Tab Component
function HTTPTab({
  deviceId,
  httpStore,
  onSelectEvent,
  onShowRelatedLogs,
  onFavoriteChange,
  onRefresh,
}: {
  deviceId: string
  httpStore: ReturnType<typeof useHTTPStore.getState>
  onSelectEvent: (id: string) => void
  onShowRelatedLogs: (traceId: string) => void
  onFavoriteChange: (eventId: string, isFavorite: boolean) => void
  onRefresh: () => void
}) {
  // 批量删除确认对话框
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)

  const handleExportSelected = () => {
    const ids = Array.from(httpStore.selectedIds)
    if (ids.length > 0) {
      window.open(getExportHARUrl(deviceId, ids), '_blank')
    }
  }

  const handleBatchDelete = useCallback(async () => {
    await httpStore.batchDelete(deviceId)
    setShowBatchDeleteConfirm(false)
  }, [deviceId, httpStore])

  // 显示的记录数（过滤后）
  const filteredCount = httpStore.filteredItems.filter(
    (item) => !('type' in item && item.type === 'session-divider')
  ).length

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-5 py-4 bg-bg-medium border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onRefresh}
            className="btn btn-secondary"
            title="刷新列表 (Ctrl+R)"
          >
            刷新
          </button>

          <div className="h-7 w-px bg-border" />

          <button
            onClick={() => httpStore.toggleSelectMode()}
            className={clsx(
              'btn',
              httpStore.isSelectMode ? 'btn-primary' : 'btn-secondary'
            )}
            title={httpStore.isSelectMode ? '退出选择模式' : '进入选择模式'}
          >
            {httpStore.isSelectMode ? '取消选择' : '批量选择'}
          </button>

          {httpStore.isSelectMode && (
            <>
              <button
                onClick={() => httpStore.selectAll()}
                className="btn btn-secondary"
                title="全选/取消全选"
              >
                {httpStore.selectedIds.size === httpStore.events.length ? '取消全选' : '全选'}
              </button>
              <button
                onClick={() => httpStore.batchFavorite(deviceId, true)}
                disabled={httpStore.selectedIds.size === 0}
                className="btn bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20"
                title="收藏选中的请求"
              >
                ⭐ 收藏 ({httpStore.selectedIds.size})
              </button>
              <button
                onClick={handleExportSelected}
                disabled={httpStore.selectedIds.size === 0}
                className="btn btn-secondary"
                title="导出选中的请求为 HAR"
              >
                导出 ({httpStore.selectedIds.size})
              </button>
              <button
                onClick={() => setShowBatchDeleteConfirm(true)}
                disabled={httpStore.selectedIds.size === 0}
                className="btn btn-danger"
                title="删除选中的请求"
              >
                删除 ({httpStore.selectedIds.size})
              </button>
            </>
          )}

          <div className="h-7 w-px bg-border" />

          <select
            value={httpStore.filters.method}
            onChange={(e) => httpStore.setFilter('method', e.target.value)}
            className="select"
          >
            <option value="">所有方法</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
          </select>

          <input
            type="text"
            value={httpStore.filters.urlContains}
            onChange={(e) => httpStore.setFilter('urlContains', e.target.value)}
            placeholder="🔍 搜索 URL..."
            className="input w-60"
            data-search-input
          />

          <label className="flex items-center gap-2.5 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-colors px-2">
            <input
              type="checkbox"
              checked={httpStore.filters.mockedOnly}
              onChange={(e) => httpStore.setFilter('mockedOnly', e.target.checked)}
              className="accent-primary w-4 h-4"
            />
            仅 Mock
          </label>
          <label className="flex items-center gap-2.5 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-colors px-2">
            <input
              type="checkbox"
              checked={httpStore.filters.favoritesOnly}
              onChange={(e) => httpStore.setFilter('favoritesOnly', e.target.checked)}
              className="accent-primary w-4 h-4"
            />
            仅收藏
          </label>

          <div className="h-6 w-px bg-border/50" />

          <label className="flex items-center gap-2.5 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-colors px-2" title="显示被黑名单策略隐藏的域名">
            <input
              type="checkbox"
              checked={httpStore.filters.showBlacklisted}
              onChange={(e) => httpStore.setFilter('showBlacklisted', e.target.checked)}
              className="accent-primary w-4 h-4"
            />
            显示黑名单
          </label>

          <div className="flex items-center gap-1">
            <button
              onClick={() => httpStore.setFilter('statusRange', httpStore.filters.statusRange === '400-599' ? '' : '400-599')}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all shadow-sm",
                httpStore.filters.statusRange === '400-599'
                  ? "bg-red-500/20 text-red-400 border-red-500/10 shadow-red-500/10"
                  : "bg-bg-light text-text-secondary border-border-subtle hover:bg-bg-lighter hover:border-border-light"
              )}
            >
              ⚠️ Errors
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-text-muted bg-bg-light/70 px-3 py-1.5 rounded-lg border border-border-subtle font-medium">
            {filteredCount !== httpStore.events.length
              ? `${filteredCount} / ${httpStore.events.length}`
              : `${httpStore.events.length}`}{' '}
            条记录
          </span>

          <label className="flex items-center gap-2.5 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-colors">
            <input
              type="checkbox"
              checked={httpStore.autoScroll}
              onChange={(e) => httpStore.setAutoScroll(e.target.checked)}
              className="accent-primary w-4 h-4"
            />
            自动滚动
          </label>

          <div className="h-6 w-px bg-border/50" />

          {/* 分组模式选择 */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-muted mr-1">分组:</span>
            {(['none', 'domain', 'path'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => httpStore.setGroupMode(mode)}
                className={clsx(
                  'px-2 py-1 text-xs rounded transition-colors',
                  httpStore.groupMode === mode
                    ? 'bg-primary text-white'
                    : 'bg-bg-light text-text-muted hover:text-text-secondary'
                )}
              >
                {mode === 'none' ? '无' : mode === 'domain' ? '域名' : '路径'}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-border/50" />

          <a
            href={getExportHTTPUrl(deviceId)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            导出全部
          </a>

          <button
            onClick={() => httpStore.clearEvents()}
            className="btn btn-ghost text-text-muted hover:text-text-secondary"
            title="清空当前列表（不删除数据库）"
          >
            清屏
          </button>
        </div>
      </div>

      {/* Split Panel */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-[400px] border-r border-border flex flex-col">
          {httpStore.groupMode === 'none' ? (
            <VirtualHTTPEventTable
              items={httpStore.filteredItems}
              selectedId={httpStore.selectedEventId}
              onSelect={onSelectEvent}
              autoScroll={httpStore.autoScroll}
              deviceId={deviceId}
              isSelectMode={httpStore.isSelectMode}
              selectedIds={httpStore.selectedIds}
              onToggleSelect={httpStore.toggleSelectId}
            />
          ) : (
            <GroupedHTTPEventList
              events={httpStore.filteredItems.filter((item): item is typeof httpStore.events[0] =>
                !('type' in item && item.type === 'session-divider')
              )}
              groupMode={httpStore.groupMode}
              selectedId={httpStore.selectedEventId}
              onSelect={onSelectEvent}
              deviceId={deviceId}
              isSelectMode={httpStore.isSelectMode}
              selectedIds={httpStore.selectedIds}
              onToggleSelect={httpStore.toggleSelectId}
            />
          )}
        </div>
        <div className="w-[45%] min-w-[400px] bg-bg-dark/50">
          <HTTPEventDetail
            event={httpStore.selectedEvent}
            deviceId={deviceId}
            onShowRelatedLogs={onShowRelatedLogs}
            onFavoriteChange={onFavoriteChange}
          />
        </div>
      </div>

      {/* Batch Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showBatchDeleteConfirm}
        onClose={() => setShowBatchDeleteConfirm(false)}
        onConfirm={handleBatchDelete}
        title="删除 HTTP 请求"
        message={`确定要删除选中的 ${httpStore.selectedIds.size} 个 HTTP 请求吗？\n\n此操作不可恢复。`}
        confirmText="确认删除"
        cancelText="取消"
        type="danger"
      />
    </div>
  )
}

// Logs Tab Component
function LogsTab({
  deviceId,
  logStore,
  onRefresh,
}: {
  deviceId: string
  logStore: ReturnType<typeof useLogStore.getState>
  onRefresh: () => void
}) {
  // 计算过滤后的数量
  const filteredCount = logStore.filteredEvents.length
  const totalCount = logStore.events.length

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-3 bg-bg-medium/50 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={onRefresh} className="btn btn-secondary" title="刷新列表 (Ctrl+R)">
            刷新
          </button>

          <div className="h-6 w-px bg-border" />

          <LogFilters
            minLevel={logStore.filters.minLevel}
            subsystems={logStore.subsystems}
            categories={logStore.categories}
            selectedSubsystem={logStore.filters.subsystem}
            selectedCategory={logStore.filters.category}
            searchText={logStore.filters.text}
            searchQuery={logStore.filters.searchQuery}
            onMinLevelChange={logStore.setMinLevel}
            onSubsystemChange={(v) => logStore.setFilter('subsystem', v)}
            onCategoryChange={(v) => logStore.setFilter('category', v)}
            onSearchChange={(v) => logStore.setFilter('text', v)}
            onSearchQueryChange={logStore.setSearchQuery}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted bg-bg-light px-2 py-1 rounded-lg">
            {filteredCount !== totalCount ? `${filteredCount} / ${totalCount}` : `${totalCount}`} 条记录
          </span>

          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-colors">
            <input
              type="checkbox"
              checked={logStore.autoScroll}
              onChange={(e) => logStore.setAutoScroll(e.target.checked)}
              className="accent-primary"
            />
            自动滚动
          </label>

          <div className="h-6 w-px bg-border" />

          <a
            href={getExportLogsUrl(deviceId)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            导出
          </a>

          <button
            onClick={() => logStore.clearEvents()}
            className="btn btn-ghost text-text-muted hover:text-text-secondary"
            title="清空当前列表（不删除数据库）"
          >
            清屏
          </button>
        </div>
      </div>

      {/* Log List */}
      <LogList events={logStore.filteredEvents} autoScroll={logStore.autoScroll} />
    </div>
  )
}

// WebSocket Tab Component
function WebSocketTab({
  deviceId,
  wsStore,
}: {
  deviceId: string
  wsStore: ReturnType<typeof useWSStore.getState>
}) {
  // 防抖搜索
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 批量删除确认对话框
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)

  const handleBatchDelete = useCallback(async () => {
    await wsStore.batchDelete(deviceId)
    setShowBatchDeleteConfirm(false)
  }, [deviceId, wsStore])

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      wsStore.selectSession(deviceId, sessionId)
    },
    [deviceId]
  )

  const handleLoadMoreFrames = useCallback(() => {
    if (wsStore.selectedSessionId) {
      wsStore.loadMoreFrames(deviceId, wsStore.selectedSessionId)
    }
  }, [deviceId, wsStore.selectedSessionId])

  const handleFrameDirectionChange = useCallback(
    (direction: string) => {
      wsStore.setFrameDirection(direction)
      if (wsStore.selectedSessionId) {
        wsStore.fetchFrames(deviceId, wsStore.selectedSessionId)
      }
    },
    [deviceId, wsStore.selectedSessionId]
  )

  // URL 搜索带防抖
  const handleUrlSearch = useCallback(
    (value: string) => {
      wsStore.setFilter('urlContains', value)

      // 清除之前的定时器
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }

      // 防抖 300ms 后刷新
      searchTimeoutRef.current = setTimeout(() => {
        wsStore.fetchSessions(deviceId)
      }, 300)
    },
    [deviceId]
  )

  // 状态筛选立即刷新
  const handleStatusChange = useCallback(
    (value: string) => {
      wsStore.setFilter('isOpen', value === '' ? undefined : value === 'true')
      wsStore.fetchSessions(deviceId)
    },
    [deviceId]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-3 bg-bg-medium/50 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => wsStore.fetchSessions(deviceId)}
            className="btn btn-secondary"
            title="刷新列表"
          >
            刷新
          </button>

          <div className="h-6 w-px bg-border" />

          <button
            onClick={() => wsStore.toggleSelectMode()}
            className={clsx(
              'btn',
              wsStore.isSelectMode ? 'btn-primary' : 'btn-secondary'
            )}
            title={wsStore.isSelectMode ? '退出选择模式' : '进入选择模式'}
          >
            {wsStore.isSelectMode ? '取消选择' : '批量选择'}
          </button>

          {wsStore.isSelectMode && (
            <>
              <button
                onClick={() => wsStore.selectAll()}
                className="btn btn-secondary"
                title="全选/取消全选"
              >
                {wsStore.selectedIds.size === wsStore.sessions.length ? '取消全选' : '全选'}
              </button>
              <button
                onClick={() => setShowBatchDeleteConfirm(true)}
                disabled={wsStore.selectedIds.size === 0}
                className="btn btn-danger"
                title="删除选中的会话"
              >
                删除 ({wsStore.selectedIds.size})
              </button>
            </>
          )}

          <div className="h-6 w-px bg-border" />

          <input
            type="text"
            value={wsStore.filters.urlContains || ''}
            onChange={(e) => handleUrlSearch(e.target.value)}
            placeholder="搜索 URL..."
            className="input w-56"
          />

          <select
            value={wsStore.filters.isOpen === undefined ? '' : String(wsStore.filters.isOpen)}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="select"
          >
            <option value="">所有状态</option>
            <option value="true">连接中</option>
            <option value="false">已关闭</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted bg-bg-light px-2 py-1 rounded-lg">
            {wsStore.totalSessions} 个会话
          </span>

          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-colors">
            <input
              type="checkbox"
              checked={wsStore.autoScroll}
              onChange={(e) => wsStore.setAutoScroll(e.target.checked)}
              className="accent-primary"
            />
            自动滚动
          </label>

          <div className="h-6 w-px bg-border" />

          <button
            onClick={() => wsStore.clearSessions()}
            className="btn btn-ghost text-text-muted hover:text-text-secondary"
            title="清空当前列表（不删除数据库）"
          >
            清屏
          </button>
        </div>
      </div>

      {/* Split Panel */}
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[40%] min-w-[300px] border-r border-border">
          <WSSessionList
            sessions={wsStore.sessions}
            selectedId={wsStore.selectedSessionId}
            onSelect={handleSelectSession}
            loading={wsStore.sessionsLoading}
            autoScroll={wsStore.autoScroll}
            isSelectMode={wsStore.isSelectMode}
            selectedIds={wsStore.selectedIds}
            onToggleSelect={wsStore.toggleSelectId}
          />
        </div>
        <div className="flex-1 min-w-[400px] bg-bg-dark/50">
          <WSSessionDetail
            deviceId={deviceId}
            session={wsStore.selectedSession}
            frames={wsStore.frames}
            loading={wsStore.framesLoading}
            onLoadMore={handleLoadMoreFrames}
            hasMore={wsStore.frames.length < wsStore.totalFrames}
            frameDirection={wsStore.frameDirection}
            onFrameDirectionChange={handleFrameDirectionChange}
          />
        </div>
      </div>

      {/* Batch Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showBatchDeleteConfirm}
        onClose={() => setShowBatchDeleteConfirm(false)}
        onConfirm={handleBatchDelete}
        title="删除 WebSocket 会话"
        message={`确定要删除选中的 ${wsStore.selectedIds.size} 个 WebSocket 会话吗？\n\n此操作将同时删除这些会话的所有帧数据，不可恢复。`}
        confirmText="确认删除"
        cancelText="取消"
        type="danger"
      />
    </div>
  )
}

// Mock Tab Component
function MockTab({
  deviceId,
  mockStore,
}: {
  deviceId: string
  mockStore: ReturnType<typeof useMockStore.getState>
}) {
  const handleCreateNew = useCallback(() => {
    mockStore.openEditor()
  }, [])

  const handleEdit = useCallback((rule: typeof mockStore.rules[0]) => {
    mockStore.openEditor(rule)
  }, [])

  const handleDelete = useCallback(
    (ruleId: string) => {
      mockStore.deleteRule(deviceId, ruleId)
    },
    [deviceId]
  )

  const handleToggleEnabled = useCallback(
    (ruleId: string) => {
      mockStore.toggleRuleEnabled(deviceId, ruleId)
    },
    [deviceId]
  )

  const handleSave = useCallback(
    async (ruleData: Parameters<typeof mockStore.createRule>[1]) => {
      if (mockStore.editingRule) {
        await mockStore.updateRule(deviceId, mockStore.editingRule.id, ruleData)
      } else {
        await mockStore.createRule(deviceId, ruleData)
      }
    },
    [deviceId, mockStore.editingRule]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-3 bg-bg-medium/50 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => mockStore.fetchRules(deviceId)}
            className="btn btn-secondary"
          >
            刷新
          </button>

          <span className="text-xs text-text-muted bg-bg-light px-2 py-1 rounded-lg">
            {mockStore.rules.length} 条规则
          </span>
        </div>

        <button onClick={handleCreateNew} className="btn bg-primary text-white hover:bg-primary-dark">
          + 创建规则
        </button>
      </div>

      {/* Rule List */}
      <div className="flex-1 overflow-auto">
        <MockRuleList
          rules={mockStore.rules}
          loading={mockStore.loading}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onToggleEnabled={handleToggleEnabled}
          onCreateNew={handleCreateNew}
        />
      </div>

      {/* Rule Editor Modal */}
      <MockRuleEditor
        rule={mockStore.editingRule}
        isOpen={mockStore.isEditorOpen}
        onClose={mockStore.closeEditor}
        onSave={handleSave}
        loading={mockStore.loading}
      />
    </div>
  )
}
