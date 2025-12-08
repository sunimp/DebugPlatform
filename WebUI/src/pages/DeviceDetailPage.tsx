import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useDeviceStore } from '@/stores/deviceStore'
import { useHTTPStore, isSessionDivider } from '@/stores/httpStore'
import { useLogStore } from '@/stores/logStore'
import { useWSStore } from '@/stores/wsStore'
import { useMockStore } from '@/stores/mockStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useThemeStore } from '@/stores/themeStore'
import { useSessionActivityStore } from '@/stores/sessionActivityStore'
import { useBreakpointStore } from '@/stores/breakpointStore'
import { useToastStore } from '@/stores/toastStore'
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
import { ListLoadingOverlay } from '@/components/ListLoadingOverlay'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { getExportHTTPUrl, getExportLogsUrl, getExportHARUrl, getWSSessionDetail } from '@/services/api'
import { getPlatformIcon } from '@/utils/deviceIcons'
import {
  HttpIcon,
  WebSocketIcon,
  LogIcon,
  BreakpointIcon,
  MockIcon,
  ChaosIcon,
  DatabaseIcon,
  BackIcon,
  KeyboardIcon,
  MoreIcon,
  NetworkCaptureIcon,
  LogCaptureIcon,
  WSCaptureIcon,
  DBCaptureIcon,
  ClearIcon,
  StarIcon,
  IPhoneIcon,
  TrafficLightIcon,
} from '@/components/icons'
import { useRuleStore } from '@/stores/ruleStore'
import type { BreakpointHit, TrafficRule } from '@/types'
import clsx from 'clsx'

type Tab = 'http' | 'logs' | 'websocket' | 'database'

// 主标签配置：简化为核心监控功能
// HTTP 内部再细分子功能：请求列表、断点、Mock、故障注入、流量规则
const tabConfig: Array<{ id: Tab; label: string; icon: React.ReactNode; description: string }> = [
  { id: 'http', label: 'HTTP', icon: <HttpIcon size={16} />, description: 'HTTP/HTTPS 请求与调试工具' },
  { id: 'websocket', label: 'WebSocket', icon: <WebSocketIcon size={16} />, description: 'WS 连接' },
  { id: 'logs', label: '日志', icon: <LogIcon size={16} />, description: '应用日志' },
  { id: 'database', label: '数据库', icon: <DatabaseIcon size={16} />, description: 'SQLite 浏览' },
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
  const [wsCapture, setWsCapture] = useState(true)
  const [dbInspector, setDbInspector] = useState(true)
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false)
  const [showClearDeviceDialog, setShowClearDeviceDialog] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  // 同时更新 state 和 URL 的 tab 切换函数
  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabState(tab)
    setSearchParams({ tab }, { replace: true })
  }, [setSearchParams])

  const { currentDevice, selectDevice, clearSelection, toggleCapture, toggleWebSocketCapture, toggleDatabaseInspector, clearDeviceData, toggleFavorite, isFavorite } =
    useDeviceStore()
  const { setConnected, setInDeviceDetail } = useConnectionStore()
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const { addActivity, clearActivities, loadDeviceActivities } = useSessionActivityStore()

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
        }
      },
    },
    {
      key: 'l',
      ctrl: true,
      description: '清屏',
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
    loadDeviceActivities(deviceId) // 加载设备连接历史

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
          // 断点现在是 HTTP Tab 的子功能，切换到 HTTP Tab
          setActiveTab('http')
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

  // 同步捕获开关状态到设备信息
  useEffect(() => {
    if (currentDevice?.deviceInfo) {
      setNetworkCapture(currentDevice.deviceInfo.captureEnabled)
      setLogCapture(currentDevice.deviceInfo.logCaptureEnabled)
      setWsCapture(currentDevice.deviceInfo.wsCaptureEnabled)
      setDbInspector(currentDevice.deviceInfo.dbInspectorEnabled)
    }
  }, [currentDevice])

  const handleBack = () => {
    navigate('/')
  }

  // 修复：正确处理捕获开关，使用 currentDevice 中的状态
  const handleNetworkCaptureChange = useCallback((checked: boolean) => {
    setNetworkCapture(checked)
    if (currentDevice) {
      toggleCapture(checked, currentDevice.deviceInfo.logCaptureEnabled)
    }
  }, [toggleCapture, currentDevice])

  const handleLogCaptureChange = useCallback((checked: boolean) => {
    setLogCapture(checked)
    if (currentDevice) {
      toggleCapture(currentDevice.deviceInfo.captureEnabled, checked)
    }
  }, [toggleCapture, currentDevice])

  const handleWsCaptureChange = useCallback((checked: boolean) => {
    setWsCapture(checked)
    toggleWebSocketCapture(checked)
  }, [toggleWebSocketCapture])

  const handleDbInspectorChange = useCallback((checked: boolean) => {
    setDbInspector(checked)
    toggleDatabaseInspector(checked)
  }, [toggleDatabaseInspector])

  const handleClearDeviceData = useCallback(async () => {
    // 暂停 WebSocket 重连，避免清空数据后持续重连
    realtimeService.pauseReconnect()

    await clearDeviceData()

    // 清空前端数据状态
    httpStore.clearEvents()
    logStore.clearEvents()
    wsStore.clearSessions()

    // 清空前端规则状态
    mockStore.clearRules()
    breakpointStore.clear()

    setShowClearDeviceDialog(false)

    // 恢复 WebSocket 连接
    realtimeService.resumeReconnect()
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
      {/* Header - 紧凑模式 */}
      <header className="px-4 py-2 bg-bg-dark border-b border-border">
        <div className="flex items-center gap-3">
          {/* 返回按钮 */}
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors group px-2 py-1.5 rounded hover:bg-bg-light"
          >
            <span className="group-hover:-translate-x-0.5 transition-transform">
              <BackIcon size={16} />
            </span>
            <span className="text-sm font-medium">返回</span>
          </button>

          <div className="h-5 w-px bg-border" />

          {/* 设备信息 - 紧凑单行 */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-border flex-shrink-0">
              {currentDevice ? getPlatformIcon(currentDevice.deviceInfo.platform, 18) : <IPhoneIcon size={18} />}
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-base font-semibold text-text-primary truncate">
                {currentDevice?.deviceInfo.deviceName || '加载中...'}
              </h1>
              {currentDevice?.deviceInfo.isSimulator && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 flex-shrink-0">
                  模拟器
                </span>
              )}
              {deviceId && (
                <button
                  onClick={() => toggleFavorite(deviceId)}
                  className={clsx(
                    "p-0.5 rounded transition-colors flex-shrink-0",
                    isFavorite(deviceId)
                      ? "text-yellow-400 hover:text-yellow-300"
                      : "text-text-muted hover:text-yellow-400"
                  )}
                  title={isFavorite(deviceId) ? "取消收藏" : "收藏设备"}
                >
                  <StarIcon size={14} filled={isFavorite(deviceId)} />
                </button>
              )}
              {currentDevice && (
                <span
                  className={clsx(
                    'text-xs px-2 py-0.5 rounded flex items-center gap-1 flex-shrink-0',
                    currentDevice.isOnline
                      ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                      : 'bg-red-500/10 text-red-400 border border-red-500/30'
                  )}
                >
                  <span className={clsx(
                    'w-1.5 h-1.5 rounded-full',
                    currentDevice.isOnline ? 'bg-green-400' : 'bg-red-400'
                  )} />
                  {currentDevice.isOnline ? '在线' : '离线'}
                </span>
              )}
              {currentDevice && (
                <span className="text-xs text-text-muted hidden xl:block truncate">
                  {currentDevice.deviceInfo.deviceModel} · {currentDevice.deviceInfo.platform} {currentDevice.deviceInfo.systemVersion} · {currentDevice.deviceInfo.appName}
                </span>
              )}
            </div>
          </div>

          {/* 捕获开关 - 紧凑图标模式 */}
          <div className="flex items-center gap-1 px-2 py-1 bg-bg-medium rounded-lg border border-border">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer group px-2 py-1 rounded hover:bg-bg-light" title="HTTP 捕获">
              <input
                type="checkbox"
                checked={networkCapture}
                onChange={(e) => handleNetworkCaptureChange(e.target.checked)}
                className="accent-primary w-3.5 h-3.5"
              />
              <NetworkCaptureIcon size={14} className={networkCapture ? 'text-primary' : 'text-text-muted'} />
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer group px-2 py-1 rounded hover:bg-bg-light" title="WebSocket 捕获">
              <input
                type="checkbox"
                checked={wsCapture}
                onChange={(e) => handleWsCaptureChange(e.target.checked)}
                className="accent-primary w-3.5 h-3.5"
              />
              <WSCaptureIcon size={14} className={wsCapture ? 'text-primary' : 'text-text-muted'} />
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer group px-2 py-1 rounded hover:bg-bg-light" title="日志捕获">
              <input
                type="checkbox"
                checked={logCapture}
                onChange={(e) => handleLogCaptureChange(e.target.checked)}
                className="accent-primary w-3.5 h-3.5"
              />
              <LogCaptureIcon size={14} className={logCapture ? 'text-primary' : 'text-text-muted'} />
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer group px-2 py-1 rounded hover:bg-bg-light" title="数据库监控">
              <input
                type="checkbox"
                checked={dbInspector}
                onChange={(e) => handleDbInspectorChange(e.target.checked)}
                className="accent-primary w-3.5 h-3.5"
              />
              <DBCaptureIcon size={14} className={dbInspector ? 'text-primary' : 'text-text-muted'} />
            </label>
          </div>

          {/* 工具按钮 */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowShortcutsHelp(true)}
              className="btn btn-ghost p-2 rounded"
              title="快捷键 (Ctrl+/)"
            >
              <KeyboardIcon size={16} />
            </button>

            <div className="relative">
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="btn btn-ghost p-2 rounded"
                title="更多操作"
              >
                <MoreIcon size={16} />
              </button>
              {showMoreMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowMoreMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 w-48 bg-bg-dark border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                    <button
                      onClick={() => {
                        setShowMoreMenu(false)
                        setShowClearDeviceDialog(true)
                      }}
                      className="w-full px-3 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                    >
                      <ClearIcon size={14} />
                      <span>清空设备数据</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Tabs - 主功能标签，更紧凑 */}
      <div className="px-4 py-2 bg-bg-dark border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-0.5 p-0.5 bg-bg-medium rounded-lg border border-border w-fit">
          {tabConfig.map((tab, index) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={`${tab.description} (⌘${index + 1})`}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors relative whitespace-nowrap',
                activeTab === tab.id
                  ? 'bg-primary text-bg-darkest'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-light'
              )}
            >
              <span className="text-sm">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.id === 'http' && breakpointStore.pendingHits.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center animate-pulse">
                  {breakpointStore.pendingHits.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 常驻连接活动 */}
        {deviceId && (
          <SessionActivityIndicator deviceId={deviceId} alwaysShow />
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'http' && (
          <HTTPTab
            deviceId={deviceId}
            httpStore={httpStore}
            mockStore={mockStore}
            breakpointStore={breakpointStore}
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

// HTTP 子 Tab 类型
type HTTPSubTab = 'requests' | 'breakpoints' | 'mock' | 'chaos' | 'rules'

// HTTP Tab Component - 包含子 Tab 导航
function HTTPTab({
  deviceId,
  httpStore,
  mockStore,
  breakpointStore,
  onSelectEvent,
  onShowRelatedLogs,
  onFavoriteChange,
  onRefresh,
}: {
  deviceId: string
  httpStore: ReturnType<typeof useHTTPStore.getState>
  mockStore: ReturnType<typeof useMockStore.getState>
  breakpointStore: ReturnType<typeof useBreakpointStore.getState>
  onSelectEvent: (id: string) => void
  onShowRelatedLogs: (traceId: string) => void
  onFavoriteChange: (eventId: string, isFavorite: boolean) => void
  onRefresh: () => void
}) {
  const [activeSubTab, setActiveSubTab] = useState<HTTPSubTab>('requests')

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

  // HTTP 子 Tab 配置
  const httpSubTabs: Array<{ id: HTTPSubTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'requests', label: '请求列表', icon: <HttpIcon size={14} /> },
    { id: 'breakpoints', label: '断点', icon: <BreakpointIcon size={14} />, badge: breakpointStore.pendingHits.length },
    { id: 'mock', label: 'Mock', icon: <MockIcon size={14} /> },
    { id: 'chaos', label: '故障注入', icon: <ChaosIcon size={14} /> },
    { id: 'rules', label: '流量规则', icon: <TrafficLightIcon size={14} /> },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* HTTP 子 Tab 导航栏 */}
      <div className="px-4 py-2.5 bg-bg-dark/80 border-b border-border flex items-center gap-1 p-1">
        {httpSubTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-colors relative whitespace-nowrap',
              activeSubTab === tab.id
                ? 'bg-accent-blue text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-light'
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge && tab.badge > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-orange-500 text-white text-xs rounded-full min-w-[18px] text-center animate-pulse">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 子 Tab 内容 */}
      {activeSubTab === 'requests' && (
        <HTTPRequestsContent
          deviceId={deviceId}
          httpStore={httpStore}
          mockStore={mockStore}
          onSelectEvent={onSelectEvent}
          onShowRelatedLogs={onShowRelatedLogs}
          onFavoriteChange={onFavoriteChange}
          onRefresh={onRefresh}
          filteredCount={filteredCount}
          showBatchDeleteConfirm={showBatchDeleteConfirm}
          setShowBatchDeleteConfirm={setShowBatchDeleteConfirm}
          handleExportSelected={handleExportSelected}
          handleBatchDelete={handleBatchDelete}
        />
      )}

      {activeSubTab === 'breakpoints' && (
        <BreakpointManager
          deviceId={deviceId}
          pendingHits={breakpointStore.pendingHits}
          onResumeBreakpoint={(requestId, action) => breakpointStore.resumeBreakpoint(deviceId, requestId, action)}
        />
      )}

      {activeSubTab === 'mock' && (
        <MockTab deviceId={deviceId} mockStore={mockStore} />
      )}

      {activeSubTab === 'chaos' && (
        <ChaosManager deviceId={deviceId} />
      )}

      {activeSubTab === 'rules' && (
        <TrafficRulesContent deviceId={deviceId} />
      )}
    </div>
  )
}

// HTTP 请求列表内容组件
function HTTPRequestsContent({
  deviceId,
  httpStore,
  mockStore,
  onSelectEvent,
  onShowRelatedLogs,
  onFavoriteChange,
  onRefresh,
  filteredCount,
  showBatchDeleteConfirm,
  setShowBatchDeleteConfirm,
  handleExportSelected,
  handleBatchDelete,
}: {
  deviceId: string
  httpStore: ReturnType<typeof useHTTPStore.getState>
  mockStore: ReturnType<typeof useMockStore.getState>
  onSelectEvent: (id: string) => void
  onShowRelatedLogs: (traceId: string) => void
  onFavoriteChange: (eventId: string, isFavorite: boolean) => void
  onRefresh: () => void
  filteredCount: number
  showBatchDeleteConfirm: boolean
  setShowBatchDeleteConfirm: (show: boolean) => void
  handleExportSelected: () => void
  handleBatchDelete: () => void
}) {
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const toast = useToastStore()

  // 检查是否全选
  const filteredEvents = httpStore.filteredItems.filter((item) => !isSessionDivider(item))
  const allSelected = httpStore.selectedIds.size === filteredEvents.length && filteredEvents.length > 0

  return (
    <>
      {/* Toolbar */}
      <div className="bg-bg-medium border-b border-border">
        {/* 第一行：筛选功能 */}
        <div className="px-4 py-2 flex items-center gap-2 flex-nowrap min-w-0">
          {/* 主要操作区 */}
          <button
            onClick={onRefresh}
            disabled={httpStore.isLoading}
            className={clsx(
              "btn btn-secondary text-xs px-2.5 py-1.5 flex-shrink-0",
              httpStore.isLoading && "opacity-70"
            )}
            title="刷新列表 (Ctrl+R)"
          >
            <span className={httpStore.isLoading ? "inline-block animate-spin mr-1" : "hidden"}>⟳</span>
            刷新
          </button>

          <div className="h-5 w-px bg-border flex-shrink-0" />

          <button
            onClick={() => httpStore.toggleSelectMode()}
            className={clsx(
              'btn text-xs px-2.5 py-1.5',
              httpStore.isSelectMode ? 'btn-primary' : 'btn-secondary'
            )}
            title={httpStore.isSelectMode ? '退出选择模式' : '进入选择模式'}
          >
            {httpStore.isSelectMode ? '取消选择' : '批量选择'}
          </button>

          <div className="h-5 w-px bg-border flex-shrink-0" />

          {/* 过滤区 */}
          <select
            value={httpStore.filters.method}
            onChange={(e) => httpStore.setFilter('method', e.target.value)}
            className="select text-xs py-1.5 px-2"
          >
            <option value="">方法</option>
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
            placeholder="搜索 URL..."
            className="input text-xs py-1.5 px-2.5 w-40"
            data-search-input
          />

          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer hover:text-text-primary px-1.5 flex-shrink-0">
            <input
              type="checkbox"
              checked={httpStore.filters.mockedOnly}
              onChange={(e) => httpStore.setFilter('mockedOnly', e.target.checked)}
              className="accent-primary w-3 h-3"
            />
            Mock
          </label>

          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer hover:text-text-primary px-1.5 flex-shrink-0">
            <input
              type="checkbox"
              checked={httpStore.filters.favoritesOnly}
              onChange={(e) => httpStore.setFilter('favoritesOnly', e.target.checked)}
              className="accent-primary w-3 h-3"
            />
            收藏
          </label>

          <button
            onClick={() => httpStore.setFilter('statusRange', httpStore.filters.statusRange === '400-599' ? '' : '400-599')}
            className={clsx(
              "px-2 py-1 rounded text-xs font-medium border transition-colors flex-shrink-0",
              httpStore.filters.statusRange === '400-599'
                ? "bg-red-500/20 text-red-400 border-red-500/20"
                : "bg-bg-light text-text-muted border-border hover:text-text-secondary"
            )}
          >
            Errors
          </button>

          {/* 弹性空间 */}
          <div className="flex-1 min-w-4" />

          {/* 右侧信息和更多菜单 */}
          <span className="text-xs text-text-muted bg-bg-light px-2 py-1 rounded flex-shrink-0">
            {filteredCount !== httpStore.events.length
              ? `${filteredCount}/${httpStore.events.length}`
              : `${httpStore.events.length}`} 条
          </span>

          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer hover:text-text-primary px-1.5 flex-shrink-0">
            <input
              type="checkbox"
              checked={httpStore.autoScroll}
              onChange={(e) => httpStore.setAutoScroll(e.target.checked)}
              className="accent-primary w-3 h-3"
            />
            自动滚动
          </label>

          <div className="h-5 w-px bg-border" />

          {/* 清屏按钮 */}
          <button
            onClick={() => httpStore.clearEvents()}
            className="btn btn-ghost text-text-muted hover:text-red-400 text-xs px-2 py-1.5 flex-shrink-0"
            title="清空当前列表"
          >
            清屏
          </button>

          <div className="h-5 w-px bg-border" />

          {/* 更多菜单 */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="btn btn-ghost text-xs px-2 py-1.5"
              title="更多选项"
            >
              更多 ▾
            </button>
            {showMoreMenu && (
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  onClick={() => setShowMoreMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-48 bg-bg-dark border border-border rounded-lg shadow-lg z-[101] py-1">
                  {/* 分组模式 */}
                  <div className="px-3 py-2 border-b border-border">
                    <span className="text-xs text-text-muted">分组模式</span>
                    <div className="flex items-center gap-1 mt-1.5">
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
                  </div>

                  {/* 显示黑名单 */}
                  <label className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary cursor-pointer hover:bg-bg-light">
                    <input
                      type="checkbox"
                      checked={httpStore.filters.showBlacklisted}
                      onChange={(e) => httpStore.setFilter('showBlacklisted', e.target.checked)}
                      className="accent-primary w-3 h-3"
                    />
                    显示黑名单域名
                  </label>

                  <div className="border-t border-border my-1" />

                  {/* 导出全部 */}
                  <a
                    href={getExportHTTPUrl(deviceId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-bg-light hover:text-text-primary"
                    onClick={() => setShowMoreMenu(false)}
                  >
                    导出全部 HAR
                  </a>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 第二行：批量操作（仅在选择模式下显示） */}
        {httpStore.isSelectMode && (
          <div className="px-4 py-2 bg-primary/5 border-t border-border flex items-center gap-2">
            <span className="text-xs text-text-secondary">
              已选 <span className="text-primary font-medium">{httpStore.selectedIds.size}</span> / {filteredEvents.length} 项
            </span>

            <div className="h-4 w-px bg-border" />

            <button
              onClick={() => httpStore.selectAll()}
              className="btn btn-secondary text-xs px-2.5 py-1"
            >
              {allSelected ? '取消全选' : '全选'}
            </button>
            <button
              onClick={() => httpStore.clearSelectedIds()}
              className="btn btn-secondary text-xs px-2.5 py-1"
              disabled={httpStore.selectedIds.size === 0}
            >
              清除选择
            </button>

            <div className="h-4 w-px bg-border" />

            <button
              onClick={async () => {
                try {
                  const count = await httpStore.batchFavorite(deviceId, true)
                  if (count) toast.show('success', `已收藏 ${count} 条请求`)
                } catch {
                  toast.show('error', '收藏失败')
                }
              }}
              disabled={httpStore.selectedIds.size === 0}
              className="btn bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 text-xs px-2.5 py-1"
            >
              收藏
            </button>
            <button
              onClick={async () => {
                try {
                  const count = await httpStore.batchFavorite(deviceId, false)
                  if (count) toast.show('success', `已取消收藏 ${count} 条请求`)
                } catch {
                  toast.show('error', '取消收藏失败')
                }
              }}
              disabled={httpStore.selectedIds.size === 0}
              className="btn btn-secondary text-xs px-2.5 py-1"
            >
              取消收藏
            </button>
            <button
              onClick={handleExportSelected}
              disabled={httpStore.selectedIds.size === 0}
              className="btn btn-secondary text-xs px-2.5 py-1"
            >
              导出选中
            </button>
            <button
              onClick={() => setShowBatchDeleteConfirm(true)}
              disabled={httpStore.selectedIds.size === 0}
              className="btn btn-danger text-xs px-2.5 py-1"
            >
              删除选中
            </button>
          </div>
        )}
      </div>

      {/* Split Panel */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-[400px] border-r border-border flex flex-col relative">
          {/* 刷新加载覆盖层 */}
          <ListLoadingOverlay isLoading={httpStore.isLoading} text="刷新 HTTP 列表..." />

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
              mockRules={mockStore.rules}
              onEditMockRule={(rule) => {
                mockStore.openEditor(rule)
              }}
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
            mockRules={mockStore.rules}
            onEditMockRule={(rule) => {
              mockStore.openEditor(rule)
            }}
            onCreateMockFromRequest={(url, method, responseBody, responseHeaders) => {
              mockStore.openEditorWithTemplate({ url, method, responseBody, responseHeaders })
            }}
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

      {/* Mock Rule Editor Modal - 用于在请求列表中直接编辑 Mock 规则 */}
      <MockRuleEditor
        rule={mockStore.editingRule}
        isOpen={mockStore.isEditorOpen}
        onClose={mockStore.closeEditor}
        onSave={async (ruleData) => {
          // 判断是编辑还是创建：检查 editingRule 是否有有效的 id
          if (mockStore.editingRule?.id) {
            await mockStore.updateRule(deviceId, mockStore.editingRule.id, ruleData)
          } else {
            await mockStore.createRule(deviceId, ruleData)
          }
        }}
        loading={mockStore.loading}
        httpOnly={true}
      />
    </>
  )
}

// 流量规则内容组件 - 简化版，从 RulesPage 提取
function TrafficRulesContent({ deviceId: _deviceId }: { deviceId: string }) {
  const { rules, isLoading, fetchRules, createOrUpdateRule, deleteRule } = useRuleStore()
  const [showEditor, setShowEditor] = useState(false)
  const [editingRule, setEditingRule] = useState<Partial<typeof rules[0]> | null>(null)

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  // 切换规则启用状态
  const handleToggleEnabled = async (rule: typeof rules[0]) => {
    await createOrUpdateRule({
      ...rule,
      isEnabled: !rule.isEnabled,
    })
  }

  // 创建新规则
  const handleCreate = () => {
    setEditingRule({
      name: '',
      matchType: 'domain',
      matchValue: '',
      action: 'highlight',
      isEnabled: true,
      priority: 0,
    })
    setShowEditor(true)
  }

  // 编辑规则
  const handleEdit = (rule: typeof rules[0]) => {
    setEditingRule({ ...rule })
    setShowEditor(true)
  }

  // 保存规则
  const handleSave = async () => {
    if (!editingRule) return
    await createOrUpdateRule(editingRule as typeof rules[0])
    setShowEditor(false)
    setEditingRule(null)
  }

  // 获取动作的显示名称和颜色
  const getActionDisplay = (action: string) => {
    switch (action) {
      case 'highlight':
        return { label: '高亮', color: 'text-green-400', bgColor: 'bg-green-500/5 border-green-500/20', icon: '✓' }
      case 'hide':
        return { label: '隐藏', color: 'text-red-400', bgColor: 'bg-red-500/5 border-red-500/20', icon: '✗' }
      case 'mark':
        return { label: '标记', color: 'text-yellow-400', bgColor: 'bg-yellow-500/5 border-yellow-500/20', icon: '★' }
      default:
        return { label: action, color: 'text-text-secondary', bgColor: 'bg-bg-light border-border', icon: '' }
    }
  }

  // 获取匹配类型的显示名称
  const getMatchTypeDisplay = (matchType: string) => {
    switch (matchType) {
      case 'domain':
        return '域名'
      case 'urlRegex':
        return '正则'
      case 'header':
        return '请求头'
      default:
        return matchType
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header - 与其他子 Tab 保持一致 */}
      <div className="px-4 py-3 border-b border-border bg-bg-dark/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrafficLightIcon size={24} className="text-text-primary" />
          <div>
            <h3 className="font-medium text-text-primary">流量规则</h3>
            <p className="text-xs text-text-muted">配置域名的高亮、隐藏、标记策略</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted bg-bg-light px-2 py-1 rounded-lg">
            {rules.length} 条规则
          </span>
          <button onClick={handleCreate} className="btn btn-primary text-sm">
            + 新建规则
          </button>
        </div>
      </div>

      {/* Rule List */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-text-muted">加载中...</div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <TrafficLightIcon size={48} className="mb-3 opacity-50" />
            <p className="text-sm mb-3">暂无流量规则</p>
            <button onClick={handleCreate} className="btn btn-primary text-sm">
              + 新建规则
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => {
              const actionDisplay = getActionDisplay(rule.action)
              return (
                <div
                  key={rule.id}
                  className={clsx(
                    'flex items-center justify-between p-4 rounded-lg border transition-colors group',
                    rule.isEnabled
                      ? actionDisplay.bgColor
                      : 'bg-bg-light border-border opacity-60'
                  )}
                >
                  <div className="flex items-center gap-4">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rule.isEnabled}
                        onChange={() => handleToggleEnabled(rule)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-bg-medium rounded-full peer peer-checked:bg-primary transition-colors"></div>
                      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
                    </label>
                    <div>
                      <div className="font-medium text-text-primary flex items-center gap-2">
                        <span className={clsx('text-sm', actionDisplay.color)}>{actionDisplay.icon}</span>
                        {rule.name || rule.matchValue}
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">
                        <span className="px-1.5 py-0.5 bg-bg-medium rounded text-2xs mr-1.5">
                          {getMatchTypeDisplay(rule.matchType)}
                        </span>
                        {rule.matchValue}
                        <span className="mx-1.5">·</span>
                        <span className={actionDisplay.color}>
                          {actionDisplay.label}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(rule)}
                      className="btn btn-ghost text-text-muted hover:text-text-primary text-sm"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => deleteRule(rule.id)}
                      className="btn btn-ghost text-red-400 hover:text-red-300 text-sm"
                    >
                      删除
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Rule Editor Modal */}
      {showEditor && editingRule && (
        <TrafficRuleEditor
          rule={editingRule}
          onChange={setEditingRule}
          onSave={handleSave}
          onCancel={() => {
            setShowEditor(false)
            setEditingRule(null)
          }}
        />
      )}
    </div>
  )
}

// 流量规则编辑器组件
function TrafficRuleEditor({
  rule,
  onChange,
  onSave,
  onCancel,
}: {
  rule: Partial<TrafficRule>
  onChange: (rule: Partial<TrafficRule>) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-dark border border-border rounded-xl shadow-2xl w-full max-w-lg">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-text-primary">
            {rule.id ? '编辑规则' : '新建规则'}
          </h3>
        </div>
        <div className="p-5 space-y-4">
          {/* 规则名称 */}
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">规则名称</label>
            <input
              type="text"
              value={rule.name || ''}
              onChange={(e) => onChange({ ...rule, name: e.target.value })}
              placeholder="可选，留空将使用匹配值作为名称"
              className="input w-full"
            />
          </div>

          {/* 匹配类型 */}
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">匹配类型</label>
            <div className="flex gap-2">
              {[
                { value: 'domain', label: '域名匹配' },
                { value: 'urlRegex', label: '正则匹配' },
                { value: 'header', label: '请求头' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onChange({ ...rule, matchType: opt.value as TrafficRule['matchType'] })}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-sm transition-colors',
                    rule.matchType === opt.value
                      ? 'bg-primary text-white'
                      : 'bg-bg-light text-text-secondary hover:text-text-primary'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 匹配值 */}
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">
              {rule.matchType === 'domain' ? '域名' : rule.matchType === 'urlRegex' ? '正则表达式' : '请求头名称'}
            </label>
            <input
              type="text"
              value={rule.matchValue || ''}
              onChange={(e) => onChange({ ...rule, matchValue: e.target.value })}
              placeholder={rule.matchType === 'domain' ? 'example.com' : rule.matchType === 'urlRegex' ? '.*api/v1.*' : 'X-Custom-Header'}
              className="input w-full"
            />
          </div>

          {/* 动作 */}
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">动作</label>
            <div className="flex gap-2">
              {[
                { value: 'highlight', label: '高亮显示', color: 'text-green-400 border-green-500/30' },
                { value: 'hide', label: '隐藏', color: 'text-red-400 border-red-500/30' },
                { value: 'mark', label: '标记', color: 'text-yellow-400 border-yellow-500/30' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onChange({ ...rule, action: opt.value as TrafficRule['action'] })}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                    rule.action === opt.value
                      ? `${opt.color} bg-bg-light`
                      : 'border-border text-text-secondary hover:text-text-primary'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-3">
          <button onClick={onCancel} className="btn btn-secondary">
            取消
          </button>
          <button
            onClick={onSave}
            disabled={!rule.matchValue}
            className="btn btn-primary"
          >
            保存
          </button>
        </div>
      </div>
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
  const toast = useToastStore()
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  // 检查是否全选
  const allSelected = logStore.selectedIds.size === filteredCount && filteredCount > 0

  const handleBatchDelete = useCallback(async () => {
    const count = logStore.selectedIds.size
    try {
      await logStore.batchDelete(deviceId)
      toast.show('success', `已删除 ${count} 条日志`)
    } catch {
      toast.show('error', '删除失败')
    }
    setShowBatchDeleteConfirm(false)
  }, [deviceId, logStore, toast])

  // 批量导出选中的日志
  const handleExportSelected = useCallback(() => {
    const ids = Array.from(logStore.selectedIds)
    if (ids.length > 0) {
      const url = `${getExportLogsUrl(deviceId)}&ids=${ids.join(',')}`
      window.open(url, '_blank')
    }
  }, [deviceId, logStore.selectedIds])

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="bg-bg-medium/50 border-b border-border">
        {/* 第一行：筛选功能 */}
        <div className="px-4 py-2 flex items-center gap-2 flex-nowrap min-w-0">
          <button
            onClick={onRefresh}
            disabled={logStore.isLoading}
            className={clsx(
              "btn btn-secondary text-xs px-2.5 py-1.5",
              logStore.isLoading && "opacity-70"
            )}
            title="刷新列表 (Ctrl+R)"
          >
            <span className={logStore.isLoading ? "inline-block animate-spin mr-1" : "hidden"}>⟳</span>
            刷新
          </button>

          <div className="h-5 w-px bg-border flex-shrink-0" />

          <button
            onClick={() => logStore.toggleSelectMode()}
            className={clsx(
              'btn text-xs px-2.5 py-1.5',
              logStore.isSelectMode ? 'btn-primary' : 'btn-secondary'
            )}
            title={logStore.isSelectMode ? '退出选择模式' : '进入选择模式'}
          >
            {logStore.isSelectMode ? '取消选择' : '批量选择'}
          </button>

          <div className="h-5 w-px bg-border flex-shrink-0" />

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

          {/* 弹性空间 */}
          <div className="flex-1 min-w-4" />

          {/* 右侧信息 */}
          <span className="text-xs text-text-muted bg-bg-light px-2 py-1 rounded flex-shrink-0">
            {filteredCount !== totalCount ? `${filteredCount}/${totalCount}` : `${totalCount}`} 条
          </span>

          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer hover:text-text-primary px-1.5 flex-shrink-0">
            <input
              type="checkbox"
              checked={logStore.autoScroll}
              onChange={(e) => logStore.setAutoScroll(e.target.checked)}
              className="accent-primary w-3 h-3"
            />
            自动滚动
          </label>

          <div className="h-5 w-px bg-border" />

          {/* 清屏 */}
          <button
            onClick={() => logStore.clearEvents()}
            className="btn btn-ghost text-text-muted hover:text-red-400 text-xs px-2 py-1.5 flex-shrink-0"
            title="清空当前列表"
          >
            清屏
          </button>

          <div className="h-5 w-px bg-border" />

          {/* 更多菜单 */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="btn btn-ghost text-xs px-2 py-1.5"
              title="更多选项"
            >
              更多 ▾
            </button>
            {showMoreMenu && (
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  onClick={() => setShowMoreMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-40 bg-bg-dark border border-border rounded-lg shadow-lg z-[101] py-1">
                  {/* 导出全部 */}
                  <a
                    href={getExportLogsUrl(deviceId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-bg-light hover:text-text-primary"
                    onClick={() => setShowMoreMenu(false)}
                  >
                    导出全部
                  </a>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 第二行：批量操作（仅在选择模式下显示） */}
        {logStore.isSelectMode && (
          <div className="px-4 py-2 bg-primary/5 border-t border-border flex items-center gap-2">
            <span className="text-xs text-text-secondary">
              已选 <span className="text-primary font-medium">{logStore.selectedIds.size}</span> / {filteredCount} 项
            </span>

            <div className="h-4 w-px bg-border" />

            <button
              onClick={() => logStore.selectAll()}
              className="btn btn-secondary text-xs px-2.5 py-1"
            >
              {allSelected ? '取消全选' : '全选'}
            </button>
            <button
              onClick={() => logStore.clearSelectedIds()}
              className="btn btn-secondary text-xs px-2.5 py-1"
              disabled={logStore.selectedIds.size === 0}
            >
              清除选择
            </button>

            <div className="h-4 w-px bg-border" />

            <button
              onClick={handleExportSelected}
              disabled={logStore.selectedIds.size === 0}
              className="btn btn-secondary text-xs px-2.5 py-1"
            >
              导出选中
            </button>
            <button
              onClick={() => setShowBatchDeleteConfirm(true)}
              disabled={logStore.selectedIds.size === 0}
              className="btn btn-danger text-xs px-2.5 py-1"
            >
              删除选中
            </button>
          </div>
        )}
      </div>

      {/* Log List */}
      <div className="flex-1 relative overflow-hidden">
        <ListLoadingOverlay isLoading={logStore.isLoading} text="刷新日志列表..." />
        <LogList
          events={logStore.filteredEvents}
          autoScroll={logStore.autoScroll}
          isSelectMode={logStore.isSelectMode}
          selectedIds={logStore.selectedIds}
          onToggleSelect={logStore.toggleSelectId}
        />
      </div>

      {/* Batch Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={showBatchDeleteConfirm}
        onClose={() => setShowBatchDeleteConfirm(false)}
        onConfirm={handleBatchDelete}
        title="确认删除"
        message={`确定要删除选中的 ${logStore.selectedIds.size} 条日志吗？\n\n此操作不可恢复。`}
        confirmText="删除"
        type="danger"
      />
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
      // 如果已选中，再次点击则取消选中
      if (wsStore.selectedSessionId === sessionId) {
        wsStore.clearSelection()
      } else {
        wsStore.selectSession(deviceId, sessionId)
      }
    },
    [deviceId, wsStore.selectedSessionId]
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
            disabled={wsStore.sessionsLoading}
            className={clsx(
              "btn btn-secondary",
              wsStore.sessionsLoading && "opacity-70"
            )}
            title="刷新列表"
          >
            <span className={wsStore.sessionsLoading ? "inline-block animate-spin mr-1" : "hidden"}>⟳</span>
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
        <div className="w-[40%] min-w-[300px] border-r border-border relative">
          {/* 刷新加载覆盖层 */}
          <ListLoadingOverlay isLoading={wsStore.sessionsLoading} text="刷新 WebSocket 列表..." />

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
    <div className="h-full flex flex-col">
      {/* Header - 与其他子 Tab 保持一致 */}
      <div className="px-4 py-3 border-b border-border bg-bg-dark/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MockIcon size={24} className="text-text-primary" />
          <div>
            <h3 className="font-medium text-text-primary">Mock 规则</h3>
            <p className="text-xs text-text-muted">模拟接口响应数据</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted bg-bg-light px-2 py-1 rounded-lg">
            {mockStore.rules.length} 条规则
          </span>
          <button onClick={handleCreateNew} className="btn btn-primary text-sm">
            + 新建规则
          </button>
        </div>
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
        httpOnly
      />
    </div>
  )
}
