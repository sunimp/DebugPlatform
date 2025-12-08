// VirtualHTTPEventTable.tsx
// 使用虚拟滚动优化的 HTTP 事件列表
//
// Created by Sun on 2025/12/06.
// Copyright © 2025 Sun. All rights reserved.
//

import { useRef, useEffect, useCallback, useMemo } from 'react'
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
import { MockIcon, StarIcon, HttpIcon, TagIcon } from './icons'
import { MockRulePopover } from './MockRulePopover'

// 行高度（像素）
const ROW_HEIGHT = 56

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
}: Props) {
    const parentRef = useRef<HTMLDivElement>(null)
    const lastFirstItemRef = useRef<string | null>(null)

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
    const httpEvents = useMemo(() => {
        if (applicableRules.length === 0) {
            return rawHttpEvents
        }

        return rawHttpEvents.filter(event => {
            const rule = matchEventRule(event, applicableRules)
            // 如果匹配到 hide 规则，则隐藏
            return !rule || rule.action !== 'hide'
        })
    }, [rawHttpEvents, applicableRules])

    // 虚拟滚动器
    const virtualizer = useVirtualizer({
        count: httpEvents.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 10, // 预渲染额外的行
    })

    const virtualItems = virtualizer.getVirtualItems()

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

    const renderEventRow = (event: HTTPEventSummary, style: React.CSSProperties) => {
        const isError = !event.statusCode || event.statusCode >= 400
        const isSelected = event.id === selectedId
        const isChecked = selectedIds.has(event.id)

        // 使用 URL 级别的收藏状态（优先于请求级别的状态）
        const isFavorite = deviceId ? isUrlFavorite(deviceId, event.url) : event.isFavorite

        // 检查是否匹配规则（用于高亮/标记）
        const matchedRule = matchEventRule(event, applicableRules)
        const isHighlighted = matchedRule?.action === 'highlight'
        const isMarked = matchedRule?.action === 'mark'
        const ruleColor = matchedRule?.color

        // 计算最终样式
        const rowStyle = isMarked && ruleColor && !isSelected
            ? { ...style, borderLeftColor: ruleColor }
            : style

        return (
            <div
                key={event.id}
                style={rowStyle}
                onClick={(e) => handleRowClick(event, e)}
                className={clsx(
                    'flex items-center cursor-pointer transition-all duration-150 group border-b border-border-light',
                    // 错误状态
                    isError && !isSelected && !isHighlighted && 'bg-red-500/5 hover:bg-red-500/10',
                    // 选中状态 - 使用更浅的蓝色背景
                    isSelected && 'bg-accent-blue/15 border-l-2 border-l-accent-blue',
                    // 批量选中
                    isChecked && !isSelected && 'bg-primary/15',
                    // 高亮规则
                    isHighlighted && !isSelected && 'bg-yellow-500/10 hover:bg-yellow-500/20 border-l-4 border-l-yellow-500',
                    // 标记规则
                    isMarked && !isSelected && !isHighlighted && 'border-l-4',
                    // 默认
                    !isSelected && !isChecked && !isError && !isHighlighted && !isMarked && 'hover:bg-bg-light/60'
                )}
            >
                {/* 标记图标 */}
                {(isHighlighted || isMarked) && !isSelected && (
                    <div className="w-6 flex-shrink-0 flex items-center justify-center">
                        {isHighlighted && <StarIcon size={12} filled className="text-yellow-500" />}
                        {isMarked && !isHighlighted && <TagIcon size={12} style={{ color: ruleColor || 'currentColor' }} />}
                    </div>
                )}

                {/* Checkbox */}
                {isSelectMode && (
                    <div className="px-3 py-3.5 w-10 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggleSelect?.(event.id)}
                            className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                        />
                    </div>
                )}

                {/* Time */}
                <div className={clsx(
                    'px-4 py-3.5 w-[100px] flex-shrink-0',
                    isSelected ? 'text-accent-blue' : 'text-text-muted'
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
                            isSelected ? 'text-accent-blue font-medium' : 'text-text-primary group-hover:text-primary'
                        )} title={event.url}>
                            {truncateUrl(event.url)}
                        </span>
                        <span className={clsx(
                            'text-xs truncate font-mono',
                            isSelected ? 'text-accent-blue/70' : 'text-text-muted opacity-70'
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
                    {event.isMocked && (
                        <MockRulePopover
                            url={event.url}
                            mockRuleId={event.mockRuleId}
                            rules={mockRules}
                            onEditRule={onEditMockRule}
                        >
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-purple-500/15 text-purple-400 shadow-sm shadow-purple-500/10 hover:bg-purple-500/25 transition-colors cursor-pointer" title="已 Mock - 点击查看规则">
                                <MockIcon size={14} />
                            </span>
                        </MockRulePopover>
                    )}
                    {isFavorite && (
                        <span className="badge-favorite text-base" title="已收藏">
                            <StarIcon size={14} filled />
                        </span>
                    )}
                    {!event.isMocked && !isFavorite && (
                        <span className="w-7 h-7" />
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center bg-bg-medium border-b border-border text-text-secondary sticky top-0 z-10">
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
                        style={{
                            height: `${virtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {virtualItems.map((virtualItem) => {
                            const event = httpEvents[virtualItem.index]
                            return renderEventRow(event, {
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualItem.size}px`,
                                transform: `translateY(${virtualItem.start}px)`,
                            })
                        })}
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
