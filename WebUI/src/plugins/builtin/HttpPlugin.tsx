// HTTP 请求监控前端插件
// 专注于 HTTP/HTTPS 请求监控功能
// 断点/Mock/Chaos 功能已独立为单独插件

import React, { useEffect, useCallback, useState } from 'react'
import {
    FrontendPlugin,
    PluginContext,
    PluginEvent,
    PluginMetadata,
    PluginRenderProps,
    PluginState,
    BuiltinPluginId,
} from '../types'
import { HttpIcon, ArrowUpIcon, ArrowDownIcon } from '@/components/icons'
import { useHTTPStore, isSessionDivider } from '@/stores/httpStore'
import { useMockStore } from '@/stores/mockStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useToastStore } from '@/stores/toastStore'
import { VirtualHTTPEventTable, type ScrollControls } from '@/components/VirtualHTTPEventTable'
import { GroupedHTTPEventList } from '@/components/GroupedHTTPEventList'
import { HTTPEventDetail } from '@/components/HTTPEventDetail'
import { FilterPopover } from '@/components/FilterPopover'
import { ListLoadingOverlay } from '@/components/ListLoadingOverlay'
import { MockRuleEditor } from '@/components/MockRuleEditor'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { getExportHTTPUrl, getExportHARUrl, deleteAllHTTPEvents } from '@/services/api'
import { Checkbox } from '@/components/Checkbox'
import { Toggle } from '@/components/Toggle'
import clsx from 'clsx'

// 插件实现类
class HttpPluginImpl implements FrontendPlugin {
    metadata: PluginMetadata = {
        pluginId: BuiltinPluginId.HTTP,
        displayName: 'HTTP',
        version: '1.0.0',
        description: 'HTTP/HTTPS 请求监控',
        icon: <HttpIcon size={16} />,
    }

    state: PluginState = 'uninitialized'
    isEnabled = true

    private pluginContext: PluginContext | null = null
    private unsubscribe: (() => void) | null = null

    async initialize(context: PluginContext): Promise<void> {
        this.pluginContext = context
        this.state = 'loading'

        // 注意：HTTP 事件由 DevicePluginView 统一处理并添加到 httpStore
        // 不需要在这里重复订阅，避免重复添加事件

        this.state = 'ready'
    }

    render(props: PluginRenderProps): React.ReactNode {
        return <HttpPluginView {...props} />
    }

    onActivate(): void {
        console.log('[HttpPlugin] Activated')
    }

    onDeactivate(): void {
        console.log('[HttpPlugin] Deactivated')
    }

    onEvent(_event: PluginEvent): void {
        // 事件由 DevicePluginView 统一处理
    }

    destroy(): void {
        this.unsubscribe?.()
        this.pluginContext = null
        this.state = 'uninitialized'
    }

    // 获取上下文（供外部访问）
    get context(): PluginContext | null {
        return this.pluginContext
    }
}

// 插件视图组件 - 专注于 HTTP 请求监控
function HttpPluginView({ context, isActive }: PluginRenderProps) {
    const deviceId = context.deviceId ?? ''

    // Stores
    const httpStore = useHTTPStore()
    const mockStore = useMockStore()
    const { isConnected } = useConnectionStore()
    const toast = useToastStore()

    // UI 状态
    const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)
    const [showClearAllConfirm, setShowClearAllConfirm] = useState(false)
    const [isClearingAll, setIsClearingAll] = useState(false)
    const [showMoreMenu, setShowMoreMenu] = useState(false)

    // 计算过滤后的事件列表
    const filteredEvents = httpStore.filteredItems.filter((item) => !isSessionDivider(item))
    const allSelected = httpStore.selectedIds.size === filteredEvents.length && filteredEvents.length > 0

    // 初始化：加载数据
    // 注意：实时连接由 DevicePluginView 统一管理，不需要在这里重复监听
    useEffect(() => {
        if (!deviceId || !isActive) return

        // 加载 HTTP 事件
        httpStore.fetchEvents(deviceId)

        // 加载 Mock 规则（用于显示请求是否被 Mock）
        mockStore.fetchRules(deviceId)
    }, [deviceId, isActive])

    // 选择事件
    const onSelectEvent = useCallback((eventId: string) => {
        if (deviceId) {
            httpStore.selectEvent(deviceId, eventId)
        }
    }, [deviceId])

    // 收藏变化
    const onFavoriteChange = useCallback((eventId: string, isFavorite: boolean) => {
        httpStore.updateEventFavorite(eventId, isFavorite)
    }, [])

    // 刷新
    const handleRefresh = useCallback(() => {
        if (deviceId) {
            httpStore.fetchEvents(deviceId)
        }
    }, [deviceId])

    // 批量删除
    const handleBatchDelete = useCallback(async () => {
        if (deviceId) {
            // 从 store 获取最新的 selectedIds
            const selectedIds = useHTTPStore.getState().selectedIds
            const count = selectedIds.size
            if (count === 0) {
                toast.show('warning', '没有选中任何请求')
                setShowBatchDeleteConfirm(false)
                return
            }
            try {
                await httpStore.batchDelete(deviceId)
                toast.show('success', `已删除 ${count} 条请求`)
            } catch {
                toast.show('error', '删除失败')
            }
            setShowBatchDeleteConfirm(false)
        }
    }, [deviceId, httpStore, toast])

    // 批量导出选中
    const handleExportSelected = useCallback(() => {
        const ids = Array.from(httpStore.selectedIds)
        if (ids.length > 0) {
            window.open(getExportHARUrl(deviceId, ids), '_blank')
        }
    }, [deviceId])

    // 清除全部请求
    const handleClearAll = useCallback(async () => {
        if (!deviceId) return
        setIsClearingAll(true)
        try {
            const result = await deleteAllHTTPEvents(deviceId)
            httpStore.clearEvents()
            toast.show('success', `已清除 ${result.deleted} 个请求`)
            setShowClearAllConfirm(false)
        } catch {
            toast.show('error', '清除失败')
        } finally {
            setIsClearingAll(false)
        }
    }, [deviceId, toast])

    if (!isActive) {
        return null
    }

    // 直接渲染 HTTP 请求内容，不再有子标签
    return (
        <HTTPRequestsContent
            deviceId={deviceId}
            httpStore={httpStore}
            mockStore={mockStore}
            isConnected={isConnected}
            onSelectEvent={onSelectEvent}
            onFavoriteChange={onFavoriteChange}
            onRefresh={handleRefresh}
            filteredEvents={filteredEvents}
            allSelected={allSelected}
            showBatchDeleteConfirm={showBatchDeleteConfirm}
            setShowBatchDeleteConfirm={setShowBatchDeleteConfirm}
            showClearAllConfirm={showClearAllConfirm}
            setShowClearAllConfirm={setShowClearAllConfirm}
            isClearingAll={isClearingAll}
            handleClearAll={handleClearAll}
            showMoreMenu={showMoreMenu}
            setShowMoreMenu={setShowMoreMenu}
            handleExportSelected={handleExportSelected}
            handleBatchDelete={handleBatchDelete}
            toast={toast}
        />
    )
}

// HTTP 请求列表内容组件
function HTTPRequestsContent({
    deviceId,
    httpStore,
    mockStore,
    isConnected,
    onSelectEvent,
    onFavoriteChange,
    onRefresh,
    filteredEvents,
    allSelected,
    showBatchDeleteConfirm,
    setShowBatchDeleteConfirm,
    showClearAllConfirm,
    setShowClearAllConfirm,
    isClearingAll,
    handleClearAll,
    showMoreMenu,
    setShowMoreMenu,
    handleExportSelected,
    handleBatchDelete,
    toast,
}: {
    deviceId: string
    httpStore: ReturnType<typeof useHTTPStore.getState>
    mockStore: ReturnType<typeof useMockStore.getState>
    isConnected: boolean
    onSelectEvent: (id: string) => void
    onFavoriteChange: (eventId: string, isFavorite: boolean) => void
    onRefresh: () => void
    filteredEvents: Array<unknown>
    allSelected: boolean
    showBatchDeleteConfirm: boolean
    setShowBatchDeleteConfirm: (show: boolean) => void
    showClearAllConfirm: boolean
    setShowClearAllConfirm: (show: boolean) => void
    isClearingAll: boolean
    handleClearAll: () => Promise<void>
    showMoreMenu: boolean
    setShowMoreMenu: (show: boolean) => void
    handleExportSelected: () => void
    handleBatchDelete: () => void
    toast: ReturnType<typeof useToastStore.getState>
}) {
    // 滚动控制状态
    const [scrollControls, setScrollControls] = useState<ScrollControls | null>(null)

    return (
        <div className="h-full flex flex-col">
            {/* Toolbar */}
            <div className="bg-bg-medium border-b border-border flex-shrink-0">
                {/* 第一行：筛选功能 */}
                <div className="px-4 py-2 flex items-center gap-2 flex-nowrap min-w-0">
                    {/* 左侧：刷新 - 批量选择 - 方法 - 搜索 - 更多筛选 */}
                    <button
                        onClick={onRefresh}
                        disabled={httpStore.isLoading}
                        className={clsx(
                            "btn btn-secondary text-xs px-2.5 py-1.5 flex-shrink-0",
                            httpStore.isLoading && "opacity-70"
                        )}
                        title="刷新列表 (Ctrl+R)"
                    >
                        刷新
                    </button>

                    <div className="h-5 w-px bg-border flex-shrink-0" />

                    <button
                        onClick={() => httpStore.toggleSelectMode()}
                        className={clsx(
                            'btn text-xs px-2.5 py-1.5 flex-shrink-0',
                            httpStore.isSelectMode ? 'btn-primary' : 'btn-secondary'
                        )}
                        title={httpStore.isSelectMode ? '退出选择模式' : '进入选择模式'}
                    >
                        {httpStore.isSelectMode ? '取消选择' : '批量选择'}
                    </button>

                    <div className="h-5 w-px bg-border flex-shrink-0" />

                    {/* 过滤区 */}
                    <input
                        type="text"
                        value={httpStore.filters.urlContains}
                        onChange={(e) => httpStore.setFilter('urlContains', e.target.value)}
                        placeholder="搜索 URL..."
                        className="input text-xs py-1.5 px-2.5 w-40 flex-shrink-0"
                        data-search-input
                    />

                    <FilterPopover
                        selectOptions={[
                            {
                                key: 'method',
                                label: '请求方法',
                                value: httpStore.filters.method,
                                options: [
                                    { value: '', label: '全部方法' },
                                    { value: 'GET', label: 'GET' },
                                    { value: 'POST', label: 'POST' },
                                    { value: 'PUT', label: 'PUT' },
                                    { value: 'DELETE', label: 'DELETE' },
                                    { value: 'PATCH', label: 'PATCH' },
                                ],
                                onChange: (value) => httpStore.setFilter('method', value),
                            },
                        ]}
                        options={[
                            {
                                key: 'mocked',
                                label: '仅显示 Mock 的请求',
                                shortLabel: 'Mock',
                                checked: httpStore.filters.mockedOnly,
                                onChange: (checked) => httpStore.setFilter('mockedOnly', checked),
                            },
                            {
                                key: 'favorites',
                                label: '仅显示收藏请求',
                                shortLabel: '收藏',
                                checked: httpStore.filters.favoritesOnly,
                                onChange: (checked) => httpStore.setFilter('favoritesOnly', checked),
                            },
                            {
                                key: 'errors',
                                label: '仅显示 Error 请求',
                                shortLabel: 'Error',
                                checked: httpStore.filters.statusRange === '400-599',
                                onChange: (checked) => httpStore.setFilter('statusRange', checked ? '400-599' : ''),
                            },
                        ]}
                    />

                    {/* 弹性空间 */}
                    <div className="flex-1 min-w-4" />

                    {/* 右侧：清除全部 - 自动滚动 - 更多 - 连接状态 - 请求总条数 */}
                    {/* 清除全部请求按钮 */}
                    <button
                        onClick={() => setShowClearAllConfirm(true)}
                        className="btn text-xs px-2 py-1.5 flex-shrink-0 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                        title="清除全部请求（从数据库删除）"
                        disabled={filteredEvents.length === 0 || isClearingAll}
                    >
                        清除全部
                    </button>

                    <div className="h-5 w-px bg-border flex-shrink-0" />

                    {/* 自动滚动 */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs text-text-muted">自动滚动</span>
                        <Toggle
                            checked={httpStore.autoScroll}
                            onChange={(checked) => httpStore.setAutoScroll(checked)}
                        />
                    </div>

                    <div className="h-5 w-px bg-border flex-shrink-0" />

                    {/* 更多菜单 */}
                    <div className="relative flex-shrink-0">
                        <button
                            onClick={() => setShowMoreMenu(!showMoreMenu)}
                            className="btn btn-secondary text-xs px-2 py-1.5"
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
                                    <label className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary cursor-pointer hover:bg-bg-light border-b border-border">
                                        <Checkbox
                                            checked={httpStore.filters.showBlacklisted}
                                            onChange={(checked) => httpStore.setFilter('showBlacklisted', checked)}
                                        />
                                        显示已隐藏请求
                                    </label>

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

                    <div className="h-5 w-px bg-border flex-shrink-0" />

                    {/* 连接状态 */}
                    <span className={clsx(
                        'px-2 py-0.5 rounded text-xs flex-shrink-0',
                        isConnected ? 'bg-status-success-bg text-status-success' : 'bg-red-500/20 text-red-400'
                    )}>
                        {isConnected ? '已连接' : '已断开'}
                    </span>

                    {/* 请求总条数 */}
                    <span className="text-xs text-text-secondary flex-shrink-0">
                        共 {httpStore.total} 条
                        {httpStore.events.length < httpStore.total && (
                            <span className="text-text-muted">（已加载 {httpStore.events.length}）</span>
                        )}
                    </span>
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
                            className={clsx(
                                'btn btn-secondary text-xs px-2.5 py-1',
                                httpStore.selectedIds.size === 0 && 'opacity-50 cursor-not-allowed'
                            )}
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
                            className={clsx(
                                'btn bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 text-xs px-2.5 py-1',
                                httpStore.selectedIds.size === 0 && 'opacity-50 cursor-not-allowed hover:bg-yellow-500/10'
                            )}
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
                            className={clsx(
                                'btn btn-secondary text-xs px-2.5 py-1',
                                httpStore.selectedIds.size === 0 && 'opacity-50 cursor-not-allowed'
                            )}
                        >
                            取消收藏
                        </button>
                        <button
                            onClick={handleExportSelected}
                            disabled={httpStore.selectedIds.size === 0}
                            className={clsx(
                                'btn btn-secondary text-xs px-2.5 py-1',
                                httpStore.selectedIds.size === 0 && 'opacity-50 cursor-not-allowed'
                            )}
                        >
                            导出选中
                        </button>
                        <button
                            onClick={() => setShowBatchDeleteConfirm(true)}
                            disabled={httpStore.selectedIds.size === 0}
                            className={clsx(
                                'btn text-xs px-2.5 py-1 border',
                                httpStore.selectedIds.size === 0
                                    ? 'bg-red-500/5 text-red-400/50 border-red-500/10 cursor-not-allowed'
                                    : 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20'
                            )}
                        >
                            删除选中
                        </button>
                    </div>
                )}
            </div>

            {/* Split Panel */}
            <div className="flex-1 flex overflow-hidden min-h-0">
                <div className="flex-1 min-w-[400px] border-r border-border flex flex-col relative min-h-0">
                    {/* 刷新加载覆盖层 */}
                    <ListLoadingOverlay isLoading={httpStore.isLoading} text="刷新 HTTP 列表..." />

                    <div className="flex-1 min-h-0">
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
                                showBlacklisted={httpStore.filters.showBlacklisted}
                                onLoadMore={() => deviceId && httpStore.loadMore(deviceId)}
                                hasMore={httpStore.hasMore()}
                                isLoading={httpStore.isLoading}
                                loadedCount={httpStore.events.length}
                                totalCount={httpStore.total}
                                onScrollControlsReady={setScrollControls}
                            />
                        ) : (
                            <GroupedHTTPEventList
                                events={httpStore.filteredItems.filter((item): item is typeof httpStore.events[0] =>
                                    !isSessionDivider(item)
                                )}
                                groupMode={httpStore.groupMode}
                                selectedId={httpStore.selectedEventId}
                                onSelect={onSelectEvent}
                                deviceId={deviceId}
                                isSelectMode={httpStore.isSelectMode}
                                selectedIds={httpStore.selectedIds}
                                onToggleSelect={httpStore.toggleSelectId}
                                showBlacklisted={httpStore.filters.showBlacklisted}
                            />
                        )}
                    </div>

                    {/* 悬浮滚动按钮 */}
                    {scrollControls && (
                        <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
                            <button
                                onClick={() => scrollControls.scrollToTop()}
                                disabled={scrollControls.isAtTop}
                                className={clsx(
                                    "w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-lg",
                                    scrollControls.isAtTop
                                        ? "bg-primary/30 text-white/30 cursor-not-allowed"
                                        : "bg-primary text-white hover:bg-primary/80"
                                )}
                                title="滚动到顶部"
                            >
                                <ArrowUpIcon size={16} />
                            </button>
                            <button
                                onClick={() => scrollControls.scrollToBottom()}
                                disabled={scrollControls.isAtBottom}
                                className={clsx(
                                    "w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-lg",
                                    scrollControls.isAtBottom
                                        ? "bg-primary/30 text-white/30 cursor-not-allowed"
                                        : "bg-primary text-white hover:bg-primary/80"
                                )}
                                title="滚动到底部"
                            >
                                <ArrowDownIcon size={16} />
                            </button>
                        </div>
                    )}
                </div>
                <div className="w-[45%] min-w-[400px] bg-bg-dark/50">
                    <HTTPEventDetail
                        event={httpStore.selectedEvent}
                        deviceId={deviceId}
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

            {/* Clear All Confirmation Dialog */}
            <ConfirmDialog
                isOpen={showClearAllConfirm}
                onClose={() => setShowClearAllConfirm(false)}
                onConfirm={handleClearAll}
                title="清除全部请求"
                message={`确定要清除该设备的全部 HTTP 请求记录吗？\n\n此操作将从数据库永久删除所有请求数据，且不可恢复。`}
                confirmText="确认清除"
                cancelText="取消"
                type="danger"
                loading={isClearingAll}
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
        </div>
    )
}

// 导出插件实例
export const HttpPlugin = new HttpPluginImpl()
