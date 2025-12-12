// VirtualHTTPEventTable.tsx
// 使用虚拟滚动优化的 HTTP 事件列表
//
// Created by Sun on 2025/12/06.
// Copyright © 2025 Sun. All rights reserved.
//

import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { HTTPEventSummary, TrafficRule, MockRule } from '@/types'
import { type ListItem, isSessionDivider } from '@/stores/httpStore'
import { useRuleStore } from '@/stores/ruleStore'
import { useFavoriteUrlStore } from '@/stores/favoriteUrlStore'
import {
    formatSmartTime,
    formatDuration,
    getDurationClass,
    getStatusClass,
    getMethodClass,
    truncateUrl,
    extractDomain,
} from '@/utils/format'
import clsx from 'clsx'
import { MockIcon, StarIcon, HttpIcon, TagIcon, HighlightIcon, RefreshIcon } from './icons'
import { MockRulePopover } from './MockRulePopover'
import { Checkbox } from './Checkbox'
import { LoadMoreButton } from './LoadMoreButton'

// 行高度（像素）
const ROW_HEIGHT = 56

// 滚动控制回调接口
export interface ScrollControls {
    scrollToTop: () => void
    scrollToBottom: () => void
    isAtTop: boolean
    isAtBottom: boolean
}

interface Props {
    items: ListItem[]
    selectedId: string | null
    onSelect: (id: string) => void
    autoScroll: boolean
    /** 当前设备 ID，用于获取设备特定的规则 */
    deviceId?: string
    // 批量选择
    isSelectMode?: boolean
    selectedIds?: Set<string>
    onToggleSelect?: (id: string) => void
    /** Mock 规则列表，用于点击 Mock 标记时显示匹配的规则 */
    mockRules?: MockRule[]
    /** 点击编辑 Mock 规则 */
    onEditMockRule?: (rule: MockRule) => void
    /** 是否显示已隐藏请求（默认 false，即隐藏被规则过滤的请求） */
    showBlacklisted?: boolean
    // 加载更多
    onLoadMore?: () => void
    hasMore?: boolean
    isLoading?: boolean
    loadedCount?: number
    totalCount?: number
    /** 滚动控制回调，用于暴露滚动功能给父组件 */
    onScrollControlsReady?: (controls: ScrollControls) => void
}

/**
 * 匹配事件对应的规则
 */
function matchEventRule(event: HTTPEventSummary, rules: TrafficRule[]): TrafficRule | undefined {
    return rules.find(rule => {
        if (!rule.isEnabled) return false

        if (rule.matchType === 'domain') {
            try {
                const url = new URL(event.url)
                return url.hostname === rule.matchValue || url.hostname.endsWith('.' + rule.matchValue)
            } catch {
                return false
            }
        }

        if (rule.matchType === 'urlRegex') {
            try {
                const regex = new RegExp(rule.matchValue)
                return regex.test(event.url)
            } catch {
                return false
            }
        }

        // header 类型需要详细数据，在 summary 列表中跳过
        return false
    })
}

export function VirtualHTTPEventTable({
    items,
    selectedId,
    onSelect,
    autoScroll,
    deviceId,
    isSelectMode = false,
    selectedIds = new Set(),
    onToggleSelect,
    mockRules = [],
    onEditMockRule,
    showBlacklisted = false,
    onLoadMore,
    hasMore = false,
    isLoading = false,
    loadedCount = 0,
    totalCount = 0,
    onScrollControlsReady,
}: Props) {
    const parentRef = useRef<HTMLDivElement>(null)
    const lastFirstItemRef = useRef<string | null>(null)
    const [isAtTop, setIsAtTop] = useState(true)
    const [isAtBottom, setIsAtBottom] = useState(false)

    // 获取规则
    const { deviceRules, rules, fetchDeviceRules, fetchRules } = useRuleStore()

    // 获取 URL 级别收藏状态
    const { isFavorite: isUrlFavorite } = useFavoriteUrlStore()

    // 加载规则
    useEffect(() => {
        if (deviceId) {
            fetchDeviceRules(deviceId)
        } else {
            fetchRules()
        }
    }, [deviceId, fetchDeviceRules, fetchRules])

    // 当前适用的规则列表
    const applicableRules = useMemo(() => {
        return deviceId ? deviceRules : rules
    }, [deviceId, deviceRules, rules])

    // 过滤掉会话分隔符，只保留 HTTP 事件
    const rawHttpEvents = useMemo(() => {
        return items.filter((item) => !isSessionDivider(item)) as HTTPEventSummary[]
    }, [items])

    // 应用规则过滤（隐藏匹配 'hide' 规则的事件）
    // 当 showBlacklisted 为 true 时，显示所有事件（包括黑名单）
    const httpEvents = useMemo(() => {
        if (showBlacklisted || applicableRules.length === 0) {
            return rawHttpEvents
        }

        return rawHttpEvents.filter(event => {
            const rule = matchEventRule(event, applicableRules)
            // 如果匹配到 hide 规则，则隐藏
            return !rule || rule.action !== 'hide'
        })
    }, [rawHttpEvents, applicableRules, showBlacklisted])

    // 生成一个稳定的 key，当 httpEvents 数组内容变化时更新
    // 使用第一个事件的 ID 和数组长度来唯一标识当前数据状态
    const virtualizerKey = useMemo(() => {
        const firstId = httpEvents[0]?.id || 'empty'
        return `${firstId}-${httpEvents.length}`
    }, [httpEvents])

    // 虚拟滚动器
    const virtualizer = useVirtualizer({
        count: httpEvents.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 10, // 预渲染额外的行
        // 使用唯一 key 来区分每个项，避免数据变化后列表重叠
        getItemKey: useCallback((index: number) => httpEvents[index]?.id ?? `item-${index}`, [httpEvents]),
    })

    const virtualItems = virtualizer.getVirtualItems()

    // 滚动位置监听
    useEffect(() => {
        const scrollElement = parentRef.current
        if (!scrollElement) return

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = scrollElement
            const atTop = scrollTop <= 10
            const atBottom = scrollTop + clientHeight >= scrollHeight - 10
            setIsAtTop(atTop)
            setIsAtBottom(atBottom)
        }

        // 初始状态
        handleScroll()

        scrollElement.addEventListener('scroll', handleScroll, { passive: true })
        return () => scrollElement.removeEventListener('scroll', handleScroll)
    }, [])

    // 滚动控制函数
    const scrollToTop = useCallback(() => {
        virtualizer.scrollToIndex(0, { align: 'start', behavior: 'smooth' })
    }, [virtualizer])

    const scrollToBottom = useCallback(() => {
        if (httpEvents.length > 0) {
            virtualizer.scrollToIndex(httpEvents.length - 1, { align: 'end', behavior: 'smooth' })
        }
    }, [virtualizer, httpEvents.length])

    // 暴露滚动控制给父组件
    useEffect(() => {
        if (onScrollControlsReady) {
            onScrollControlsReady({
                scrollToTop,
                scrollToBottom,
                isAtTop,
                isAtBottom,
            })
        }
    }, [onScrollControlsReady, scrollToTop, scrollToBottom, isAtTop, isAtBottom])

    // 当数据变化时（特别是新事件添加到头部），强制重新计算
    useEffect(() => {
        // 清除所有缓存的测量值，从头开始
        virtualizer.measure()
    }, [virtualizerKey, virtualizer])

    // 当有新事件添加到列表头部时自动滚动到顶部
    useEffect(() => {
        const firstEvent = httpEvents[0]
        const firstId = firstEvent?.id ?? null
        const hasNewItem = firstId !== null && firstId !== lastFirstItemRef.current

        if (autoScroll && hasNewItem) {
            virtualizer.scrollToIndex(0, { align: 'start', behavior: 'smooth' })
        }

        lastFirstItemRef.current = firstId
    }, [httpEvents, autoScroll, virtualizer])

    const handleRowClick = useCallback((event: HTTPEventSummary, e: React.MouseEvent) => {
        if (isSelectMode && onToggleSelect) {
            e.preventDefault()
            onToggleSelect(event.id)
        } else {
            // 如果已选中，再次点击则取消选中
            if (selectedId === event.id) {
                onSelect('')
            } else {
                onSelect(event.id)
            }
        }
    }, [isSelectMode, onToggleSelect, onSelect, selectedId])

    const renderEventRowContent = (event: HTTPEventSummary, _index: number) => {
        const isError = !event.statusCode || event.statusCode >= 400
        const isSelected = event.id === selectedId
        const isChecked = selectedIds.has(event.id)
        // 使用后端返回的序号，保证删除数据后原有序号不变
        const rowNumber = event.seqNum

        // 使用 URL 级别的收藏状态（优先于请求级别的状态）
        const isFavorite = deviceId ? isUrlFavorite(deviceId, event.url) : event.isFavorite

        // 直接使用 event.isMocked 状态，不需要检查规则是否仍然存在
        // 即使规则被删除，已经被 Mock 的请求仍然应该显示 Mock 标记
        const isMocked = event.isMocked

        // 检查是否匹配规则（用于高亮/标记）
        const matchedRule = matchEventRule(event, applicableRules)
        const isHighlighted = matchedRule?.action === 'highlight'
        const isMarked = matchedRule?.action === 'mark'
        // 标记规则默认使用蓝色（与规则列表的 badge-info 一致）
        const ruleColor = matchedRule?.color || (isMarked ? '#60a5fa' : undefined)

        // 计算最终样式
        const rowStyle: React.CSSProperties = isMarked && ruleColor && !isSelected
            ? { borderLeftColor: ruleColor }
            : {}

        return (
            <div
                style={rowStyle}
                onClick={(e) => handleRowClick(event, e)}
                className={clsx(
                    'flex items-center cursor-pointer transition-all duration-150 group border-b border-border h-full',
                    // 选中状态 - 底色块样式，使用主题绿色
                    isSelected && 'bg-selected',
                    // 批量选中（非选中状态）
                    !isSelected && isChecked && 'bg-primary/15',
                    // 高亮规则（非选中状态）- 只用底色，去掉左边框
                    !isSelected && !isChecked && isHighlighted && 'bg-yellow-500/10 hover:bg-yellow-500/20',
                    // 标记规则（非选中、非高亮状态）
                    !isSelected && !isChecked && !isHighlighted && isMarked && 'border-l-4',
                    // 错误状态（非选中、非高亮状态）
                    !isSelected && !isChecked && !isHighlighted && isError && 'bg-red-500/5 hover:bg-red-500/10',
                    // 默认悬停
                    !isSelected && !isChecked && !isHighlighted && !isError && 'hover:bg-bg-light/60'
                )}
            >
                {/* 序号列 */}
                <div className={clsx(
                    'w-12 flex-shrink-0 flex items-center justify-center text-xs font-mono',
                    isSelected ? 'text-white/80' : 'text-text-muted'
                )}>
                    {rowNumber}
                </div>

                {/* 标记图标区域 - 始终保留宽度以确保列对齐 */}
                <div className="w-6 flex-shrink-0 flex items-center justify-center">
                    {isHighlighted && <HighlightIcon size={12} filled className="text-yellow-500" />}
                    {isMarked && !isHighlighted && <TagIcon size={12} style={{ color: ruleColor }} />}
                </div>

                {/* Checkbox */}
                {isSelectMode && (
                    <div className="w-10 flex-shrink-0 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                            checked={isChecked}
                            onChange={() => onToggleSelect?.(event.id)}
                        />
                    </div>
                )}

                {/* Time */}
                <div className={clsx(
                    'px-4 py-3.5 w-[100px] flex-shrink-0',
                    isSelected ? 'text-white' : 'text-text-muted'
                )}>
                    <span className="text-sm font-mono">{formatSmartTime(event.startTime)}</span>
                </div>

                {/* Method */}
                <div className="px-4 py-3.5 w-[90px] flex-shrink-0">
                    <span
                        className={clsx(
                            'inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-xs font-mono font-bold min-w-[60px] shadow-sm',
                            getMethodClass(event.method)
                        )}
                    >
                        {event.method}
                    </span>
                </div>

                {/* Status */}
                <div className="px-4 py-3.5 w-[80px] flex-shrink-0">
                    <span
                        className={clsx(
                            'inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-xs font-mono font-semibold min-w-[44px] shadow-sm',
                            getStatusClass(event.statusCode)
                        )}
                    >
                        {event.statusCode ?? 'ERR'}
                    </span>
                </div>

                {/* URL */}
                <div className="px-4 py-3.5 flex-1 min-w-0 overflow-hidden">
                    <div className="flex flex-col gap-0.5">
                        <span className={clsx(
                            'text-sm truncate transition-colors',
                            isSelected ? 'text-white font-medium' : 'text-text-primary'
                        )} title={event.url}>
                            {truncateUrl(event.url)}
                        </span>
                        <span className={clsx(
                            'text-xs truncate font-mono',
                            isSelected ? 'text-white/70' : 'text-text-muted'
                        )}>
                            {extractDomain(event.url)}
                        </span>
                    </div>
                </div>

                {/* Duration */}
                <div className="px-4 py-3.5 w-[90px] flex-shrink-0">
                    <span className={clsx(
                        'text-sm font-mono font-medium',
                        getDurationClass(event.duration)
                    )}>
                        {formatDuration(event.duration)}
                    </span>
                </div>

                {/* Tags */}
                <div className="px-4 py-3.5 w-[80px] flex-shrink-0 flex items-center justify-center gap-2">
                    {event.isReplay && (
                        <span className="inline-flex items-center justify-center w-6 h-6 text-blue-400" title="重放请求">
                            <RefreshIcon size={14} />
                        </span>
                    )}
                    {isMocked && (
                        <MockRulePopover
                            url={event.url}
                            mockRuleId={event.mockRuleId}
                            rules={mockRules}
                            onEditRule={onEditMockRule}
                        >
                            <span className="inline-flex items-center justify-center w-6 h-6 text-purple-400 hover:text-purple-300 transition-colors cursor-pointer" title="已 Mock - 点击查看规则">
                                <MockIcon size={14} />
                            </span>
                        </MockRulePopover>
                    )}
                    {isFavorite && (
                        <span className="badge-favorite text-base" title="已收藏">
                            <StarIcon size={14} filled />
                        </span>
                    )}
                    {!isMocked && !isFavorite && !event.isReplay && (
                        <span className="w-6 h-6" />
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center bg-bg-medium border-b border-border text-text-secondary sticky top-0 z-10 flex-shrink-0">
                {/* 序号列 */}
                <div className="w-12 flex-shrink-0 px-2 py-2 font-semibold text-xs uppercase tracking-wider text-center">#</div>
                {/* 标记图标区域占位 */}
                <div className="w-6 flex-shrink-0"></div>
                {isSelectMode && (
                    <div className="px-3 py-2 w-10 flex-shrink-0">
                        <span className="sr-only">选择</span>
                    </div>
                )}
                <div className="px-4 py-2 w-[100px] flex-shrink-0 font-semibold text-xs uppercase tracking-wider">时间</div>
                <div className="px-4 py-2 w-[90px] flex-shrink-0 font-semibold text-xs uppercase tracking-wider">方法</div>
                <div className="px-4 py-2 w-[80px] flex-shrink-0 font-semibold text-xs uppercase tracking-wider">状态</div>
                <div className="px-4 py-2 flex-1 font-semibold text-xs uppercase tracking-wider">URL / 域名</div>
                <div className="px-4 py-2 w-[90px] flex-shrink-0 font-semibold text-xs uppercase tracking-wider">耗时</div>
                <div className="px-4 py-2 w-[80px] flex-shrink-0 font-semibold text-xs uppercase tracking-wider text-center">标记</div>
            </div>

            {/* Virtual List */}
            <div ref={parentRef} className="flex-1 overflow-auto">
                {httpEvents.length > 0 ? (
                    <div
                        key={virtualizerKey}
                        style={{
                            height: `${virtualizer.getTotalSize() + (onLoadMore ? 60 : 0)}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {virtualItems.map((virtualItem) => {
                            const event = httpEvents[virtualItem.index]
                            // 使用 event.id 和 index 组合作为 key，确保唯一性
                            const rowKey = `${event.id}-${virtualItem.index}`
                            return (
                                <div
                                    key={rowKey}
                                    style={{
                                        position: 'absolute',
                                        top: `${virtualItem.start}px`,
                                        left: 0,
                                        width: '100%',
                                        height: `${ROW_HEIGHT}px`,
                                    }}
                                >
                                    {renderEventRowContent(event, virtualItem.index)}
                                </div>
                            )
                        })}

                        {/* 加载更多按钮 - 定位在虚拟列表内容底部 */}
                        {onLoadMore && (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: `${virtualizer.getTotalSize()}px`,
                                    left: 0,
                                    width: '100%',
                                }}
                            >
                                <LoadMoreButton
                                    onClick={onLoadMore}
                                    hasMore={hasMore}
                                    isLoading={isLoading}
                                    loadedCount={loadedCount}
                                    totalCount={totalCount}
                                />
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-text-muted py-20">
                        <div className="w-16 h-16 rounded-lg bg-bg-light flex items-center justify-center mb-4 border border-border">
                            <HttpIcon size={32} className="opacity-60" />
                        </div>
                        <p className="text-sm font-medium text-text-secondary mb-1">暂无 HTTP 请求</p>
                        <p className="text-xs text-text-muted">等待网络请求被捕获...</p>
                    </div>
                )}
            </div>
        </div>
    )
}
