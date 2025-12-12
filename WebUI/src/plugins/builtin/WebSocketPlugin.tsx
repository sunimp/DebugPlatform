// WebSocket 监控前端插件
// 使用 WSSessionList 和 WSSessionDetail 组件

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
import { WebSocketIcon, TrashIcon } from '@/components/icons'
import { useWSStore } from '@/stores/wsStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useToastStore } from '@/stores/toastStore'
import { WSSessionList } from '@/components/WSSessionList'
import { WSSessionDetail } from '@/components/WSSessionDetail'
import { ListLoadingOverlay } from '@/components/ListLoadingOverlay'
import { Toggle } from '@/components/Toggle'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { parseWSEvent } from '@/services/realtime'
import { deleteAllWSSessions, getWSSessionDetail } from '@/services/api'
import clsx from 'clsx'

// 插件实现类
class WebSocketPluginImpl implements FrontendPlugin {
    metadata: PluginMetadata = {
        pluginId: BuiltinPluginId.WEBSOCKET,
        displayName: 'WebSocket',
        version: '1.0.0',
        description: 'WebSocket 连接监控',
        icon: <WebSocketIcon size={16} />,
    }

    state: PluginState = 'uninitialized'
    isEnabled = true

    private pluginContext: PluginContext | null = null
    private unsubscribe: (() => void) | null = null

    async initialize(context: PluginContext): Promise<void> {
        this.pluginContext = context
        this.state = 'loading'

        // 订阅 WebSocket 事件
        this.unsubscribe = context.subscribeToEvents(
            ['ws_connection', 'ws_message', 'ws_frame'],
            (event) => this.handleEvent(event)
        )

        this.state = 'ready'
    }

    render(props: PluginRenderProps): React.ReactNode {
        return <WebSocketPluginView {...props} />
    }

    onActivate(): void {
        console.log('[WebSocketPlugin] Activated')
    }

    onDeactivate(): void {
        console.log('[WebSocketPlugin] Deactivated')
    }

    onEvent(event: PluginEvent): void {
        this.handleEvent(event)
    }

    destroy(): void {
        this.unsubscribe?.()
        this.pluginContext = null
        this.state = 'uninitialized'
    }

    get context(): PluginContext | null {
        return this.pluginContext
    }

    private handleEvent(event: PluginEvent): void {
        if (!event.payload) return

        const wsStore = useWSStore.getState()
        const payloadStr = typeof event.payload === 'string'
            ? event.payload
            : JSON.stringify(event.payload)
        const wsEvent = parseWSEvent(payloadStr)

        if (wsEvent) {
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
                    sessionUrl?: string
                    direction: 'send' | 'receive'
                    opcode: string
                    payload?: string
                    payloadPreview?: string
                    timestamp: string
                    isMocked: boolean
                    seqNum?: number
                }

                // 如果会话不存在，先创建一个占位会话
                if (!wsStore.sessions.some(s => s.id === frame.sessionId)) {
                    // 使用 frame 中的 sessionUrl（如果有），否则使用占位符
                    const sessionUrl = frame.sessionUrl || '(loading...)'
                    wsStore.addRealtimeSession({
                        id: frame.sessionId,
                        url: sessionUrl,
                        connectTime: frame.timestamp,
                        disconnectTime: null,
                        closeCode: null,
                        closeReason: null,
                        isOpen: true,
                    })

                    // 如果没有 sessionUrl，尝试从后端获取会话详情
                    if (!frame.sessionUrl && this.pluginContext?.deviceId) {
                        const deviceId = this.pluginContext.deviceId
                        getWSSessionDetail(deviceId, frame.sessionId)
                            .then(detail => {
                                wsStore.updateSessionUrl(frame.sessionId, detail.url)
                            })
                            .catch(() => {
                                // 忽略错误，后端可能还没创建会话记录
                            })
                    }
                }

                // 计算 payload 大小（base64 解码后的近似大小）
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
                    seqNum: frame.seqNum ?? 0,
                })
            }
        }
    }
}

// 插件视图组件
function WebSocketPluginView({ context, isActive }: PluginRenderProps) {
    const deviceId = context.deviceId

    // 从 wsStore 获取状态
    const {
        sessions,
        sessionsLoading,
        totalSessions,
        selectedSessionId,
        selectedSession,
        sessionLoading,
        frames,
        totalFrames,
        framesLoading,
        frameDirection,
        autoScroll,
        isSelectMode,
        selectedIds,
        fetchSessions,
        selectSession,
        loadMoreFrames,
        clearSessions,
        setAutoScroll,
        setFrameDirection,
        toggleSelectMode,
        toggleSelectId,
        selectAll,
        clearSelectedIds,
        batchDelete,
        fetchFrames,
    } = useWSStore()

    const { isConnected } = useConnectionStore()
    const toast = useToastStore()

    // 确认对话框状态
    const [showClearAllConfirm, setShowClearAllConfirm] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [isClearingAll, setIsClearingAll] = useState(false)

    // 初始加载
    useEffect(() => {
        if (isActive && deviceId) {
            fetchSessions(deviceId)
        }
    }, [isActive, deviceId, fetchSessions])

    // 处理选择会话
    const handleSelectSession = useCallback((sessionId: string) => {
        if (!deviceId) return
        if (isSelectMode) {
            toggleSelectId(sessionId)
        } else {
            selectSession(deviceId, sessionId)
        }
    }, [deviceId, isSelectMode, selectSession, toggleSelectId])

    // 刷新列表
    const handleRefresh = useCallback(() => {
        if (!deviceId) return
        fetchSessions(deviceId)
    }, [deviceId, fetchSessions])

    // 清除全部会话
    const handleClearAll = useCallback(async () => {
        if (!deviceId) return
        setIsClearingAll(true)
        try {
            const result = await deleteAllWSSessions(deviceId)
            clearSessions()
            toast.show('success', `已清除 ${result.deleted} 个会话`)
            setShowClearAllConfirm(false)
        } catch (error) {
            toast.show('error', '清除失败')
        } finally {
            setIsClearingAll(false)
        }
    }, [deviceId, clearSessions, toast])

    // 批量删除
    const handleBatchDelete = useCallback(async () => {
        if (!deviceId || selectedIds.size === 0) return
        await batchDelete(deviceId)
        setShowDeleteConfirm(false)
        toggleSelectMode()
        toast.show('success', `已删除 ${selectedIds.size} 个会话`)
    }, [deviceId, selectedIds.size, batchDelete, toggleSelectMode, toast])

    // 加载更多帧
    const handleLoadMoreFrames = useCallback(() => {
        if (!deviceId || !selectedSessionId) return
        loadMoreFrames(deviceId, selectedSessionId)
    }, [deviceId, selectedSessionId, loadMoreFrames])

    // 帧方向过滤变更
    const handleFrameDirectionChange = useCallback((direction: string) => {
        if (deviceId && selectedSessionId) {
            // 直接传递 direction 给 fetchFrames，避免状态更新延迟问题
            fetchFrames(deviceId, selectedSessionId, direction)
        } else {
            setFrameDirection(direction)
        }
    }, [deviceId, selectedSessionId, fetchFrames, setFrameDirection])

    if (!isActive) {
        return null
    }

    return (
        <div className="h-full flex flex-col">
            {/* 工具栏 */}
            <div className="flex-shrink-0 px-4 py-2 border-b border-border bg-bg-medium flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {/* 刷新按钮 */}
                    <button
                        onClick={handleRefresh}
                        className="btn btn-secondary text-xs px-2.5 py-1.5"
                        title="刷新"
                        disabled={sessionsLoading}
                    >
                        刷新
                    </button>

                    <div className="h-5 w-px bg-border flex-shrink-0" />

                    {/* 批量选择按钮 */}
                    <button
                        onClick={toggleSelectMode}
                        className={clsx(
                            'btn text-xs px-2.5 py-1.5 flex-shrink-0',
                            isSelectMode ? 'btn-primary' : 'btn-secondary'
                        )}
                        title={isSelectMode ? '退出选择' : '批量选择'}
                    >
                        {isSelectMode ? '取消选择' : '批量选择'}
                    </button>

                    {isSelectMode && (
                        <>
                            <button
                                onClick={selectAll}
                                className="btn btn-secondary text-xs px-2 py-1.5"
                            >
                                全选
                            </button>
                            <button
                                onClick={clearSelectedIds}
                                className="btn btn-secondary text-xs px-2 py-1.5"
                            >
                                清除选择
                            </button>
                            {selectedIds.size > 0 && (
                                <button
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="btn text-xs px-2 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 flex items-center gap-1"
                                >
                                    <TrashIcon size={12} />
                                    删除 ({selectedIds.size})
                                </button>
                            )}
                        </>
                    )}
                </div>

                <div className="flex items-center gap-2 text-xs text-text-secondary">
                    {/* 清除全部会话按钮 */}
                    <button
                        onClick={() => setShowClearAllConfirm(true)}
                        className="btn text-xs px-2 py-1.5 flex-shrink-0 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                        title="清除全部会话（从数据库删除）"
                        disabled={sessions.length === 0 || isClearingAll}
                    >
                        清除全部
                    </button>

                    <div className="h-5 w-px bg-border flex-shrink-0" />

                    {/* 自动滚动 */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs text-text-muted">自动滚动</span>
                        <Toggle
                            checked={autoScroll}
                            onChange={(checked) => setAutoScroll(checked)}
                        />
                    </div>

                    <div className="h-5 w-px bg-border flex-shrink-0" />

                    {/* 连接状态 */}
                    <span className={clsx(
                        'px-2 py-0.5 rounded text-xs',
                        isConnected ? 'bg-status-success-bg text-status-success' : 'bg-red-500/20 text-red-400'
                    )}>
                        {isConnected ? '已连接' : '已断开'}
                    </span>

                    {/* 会话计数 */}
                    <span className="text-xs text-text-secondary">
                        共 {totalSessions} 个会话
                        {sessions.length < totalSessions && (
                            <span className="text-text-muted">（已加载 {sessions.length}）</span>
                        )}
                    </span>
                </div>
            </div>

            {/* 主内容区域 */}
            <div className="flex-1 flex overflow-hidden">
                {/* 左侧：会话列表 */}
                <div className="w-80 border-r border-border flex flex-col relative">
                    <WSSessionList
                        sessions={sessions}
                        selectedId={selectedSessionId}
                        onSelect={handleSelectSession}
                        loading={sessionsLoading}
                        autoScroll={autoScroll}
                        isSelectMode={isSelectMode}
                        selectedIds={selectedIds}
                        onToggleSelect={toggleSelectId}
                    />
                    <ListLoadingOverlay isLoading={sessionsLoading} />
                </div>

                {/* 右侧：会话详情 */}
                <div className="flex-1 flex flex-col relative">
                    {deviceId && (
                        <WSSessionDetail
                            deviceId={deviceId}
                            session={selectedSession}
                            frames={frames}
                            loading={framesLoading || sessionLoading}
                            onLoadMore={handleLoadMoreFrames}
                            hasMore={frames.length < totalFrames}
                            frameDirection={frameDirection}
                            onFrameDirectionChange={handleFrameDirectionChange}
                            loadedCount={frames.length}
                            totalCount={totalFrames}
                        />
                    )}
                </div>
            </div>

            {/* 清除全部确认对话框 */}
            <ConfirmDialog
                isOpen={showClearAllConfirm}
                onClose={() => setShowClearAllConfirm(false)}
                onConfirm={handleClearAll}
                title="清除全部会话"
                message={`确定要清除该设备的全部 WebSocket 会话记录吗？\n\n此操作将从数据库永久删除所有会话及帧数据，且不可恢复。`}
                confirmText="确认清除"
                cancelText="取消"
                type="danger"
                loading={isClearingAll}
            />

            {/* 删除确认对话框 */}
            <ConfirmDialog
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={handleBatchDelete}
                title="删除会话"
                message={`确定要删除选中的 ${selectedIds.size} 个会话吗？\n\n此操作不可恢复。`}
                confirmText="确认删除"
                cancelText="取消"
                type="danger"
            />
        </div>
    )
}

export const WebSocketPlugin = new WebSocketPluginImpl()
