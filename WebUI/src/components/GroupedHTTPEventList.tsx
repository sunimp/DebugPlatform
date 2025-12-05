// GroupedHTTPEventList.tsx
// 按域名/路径分组的 HTTP 事件列表
//
// Created by Sun on 2025/12/06.
// Copyright © 2025 Sun. All rights reserved.
//

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { HTTPEventSummary, TrafficRule } from '@/types'
import { useRuleStore } from '@/stores/ruleStore'
import {
    formatSmartTime,
    formatDuration,
    getDurationClass,
    getStatusClass,
    getMethodClass,
    extractDomain,
} from '@/utils/format'
import clsx from 'clsx'

// 分组模式
export type GroupMode = 'none' | 'domain' | 'path'

// 分组数据结构
interface EventGroup {
    key: string
    label: string
    count: number
    events: HTTPEventSummary[]
    expanded: boolean
    // 统计信息
    avgDuration: number
    errorCount: number
    mockedCount: number
}

// 虚拟列表项类型
type VirtualItem =
    | { type: 'group-header'; group: EventGroup; index: number }
    | { type: 'event'; event: HTTPEventSummary; groupKey: string }

interface Props {
    events: HTTPEventSummary[]
    groupMode: GroupMode
    selectedId: string | null
    onSelect: (id: string) => void
    /** 当前设备 ID，用于获取设备特定的规则 */
    deviceId?: string
    // 批量选择
    isSelectMode?: boolean
    selectedIds?: Set<string>
    onToggleSelect?: (id: string) => void
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

        return false
    })
}

// 按域名分组
function groupByDomain(events: HTTPEventSummary[]): Map<string, HTTPEventSummary[]> {
    const groups = new Map<string, HTTPEventSummary[]>()

    for (const event of events) {
        const domain = extractDomain(event.url) || 'unknown'
        if (!groups.has(domain)) {
            groups.set(domain, [])
        }
        groups.get(domain)!.push(event)
    }

    return groups
}

// 按路径前缀分组
function groupByPath(events: HTTPEventSummary[]): Map<string, HTTPEventSummary[]> {
    const groups = new Map<string, HTTPEventSummary[]>()

    for (const event of events) {
        try {
            const url = new URL(event.url)
            // 取前两级路径
            const pathParts = url.pathname.split('/').filter(Boolean)
            const prefix = pathParts.length > 0
                ? `${url.hostname}/${pathParts.slice(0, 2).join('/')}`
                : url.hostname

            if (!groups.has(prefix)) {
                groups.set(prefix, [])
            }
            groups.get(prefix)!.push(event)
        } catch {
            const key = 'invalid-url'
            if (!groups.has(key)) {
                groups.set(key, [])
            }
            groups.get(key)!.push(event)
        }
    }

    return groups
}

// 计算分组统计
function createEventGroups(
    events: HTTPEventSummary[],
    groupMode: GroupMode,
    expandedKeys: Set<string>
): EventGroup[] {
    if (groupMode === 'none') {
        return []
    }

    const grouped = groupMode === 'domain'
        ? groupByDomain(events)
        : groupByPath(events)

    const groups: EventGroup[] = []

    for (const [key, groupEvents] of grouped) {
        const durations = groupEvents
            .filter(e => e.duration !== null)
            .map(e => e.duration!)

        groups.push({
            key,
            label: key,
            count: groupEvents.length,
            events: groupEvents,
            expanded: expandedKeys.has(key),
            avgDuration: durations.length > 0
                ? durations.reduce((a, b) => a + b, 0) / durations.length
                : 0,
            errorCount: groupEvents.filter(e => !e.statusCode || e.statusCode >= 400).length,
            mockedCount: groupEvents.filter(e => e.isMocked).length,
        })
    }

    // 按请求数量排序
    groups.sort((a, b) => b.count - a.count)

    return groups
}

// 构建虚拟列表项
function buildVirtualItems(groups: EventGroup[]): VirtualItem[] {
    const items: VirtualItem[] = []

    for (let i = 0; i < groups.length; i++) {
        const group = groups[i]
        items.push({ type: 'group-header', group, index: i })

        if (group.expanded) {
            for (const event of group.events) {
                items.push({ type: 'event', event, groupKey: group.key })
            }
        }
    }

    return items
}

// 行高
const GROUP_HEADER_HEIGHT = 48
const EVENT_ROW_HEIGHT = 56

export function GroupedHTTPEventList({
    events,
    groupMode,
    selectedId,
    onSelect,
    deviceId,
    isSelectMode = false,
    selectedIds = new Set(),
    onToggleSelect,
}: Props) {
    const parentRef = useRef<HTMLDivElement>(null)
    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

    // 获取规则
    const { deviceRules, rules, fetchDeviceRules, fetchRules } = useRuleStore()

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

    // 应用规则过滤（隐藏匹配 'hide' 规则的事件）
    const filteredEvents = useMemo(() => {
        if (applicableRules.length === 0) {
            return events
        }

        return events.filter(event => {
            const rule = matchEventRule(event, applicableRules)
            return !rule || rule.action !== 'hide'
        })
    }, [events, applicableRules])

    // 计算分组
    const groups = useMemo(
        () => createEventGroups(filteredEvents, groupMode, expandedKeys),
        [filteredEvents, groupMode, expandedKeys]
    )

    // 构建虚拟列表项
    const virtualItems = useMemo(
        () => buildVirtualItems(groups),
        [groups]
    )

    // 虚拟滚动器
    const virtualizer = useVirtualizer({
        count: virtualItems.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (index) => {
            const item = virtualItems[index]
            return item.type === 'group-header' ? GROUP_HEADER_HEIGHT : EVENT_ROW_HEIGHT
        },
        overscan: 10,
    })

    // 切换分组展开
    const toggleGroup = useCallback((key: string) => {
        setExpandedKeys(prev => {
            const next = new Set(prev)
            if (next.has(key)) {
                next.delete(key)
            } else {
                next.add(key)
            }
            return next
        })
    }, [])

    // 展开/收起所有
    const expandAll = useCallback(() => {
        setExpandedKeys(new Set(groups.map(g => g.key)))
    }, [groups])

    const collapseAll = useCallback(() => {
        setExpandedKeys(new Set())
    }, [])

    // 如果没有分组模式，返回 null（由父组件处理）
    if (groupMode === 'none') {
        return null
    }

    const handleRowClick = (event: HTTPEventSummary, e: React.MouseEvent) => {
        if (isSelectMode && onToggleSelect) {
            e.preventDefault()
            onToggleSelect(event.id)
        } else {
            onSelect(event.id)
        }
    }

    const renderGroupHeader = (group: EventGroup, style: React.CSSProperties) => (
        <div
            key={`group-${group.key}`}
            style={style}
            className="flex items-center px-4 py-2 bg-bg-light border-b border-border cursor-pointer hover:bg-bg-lighter"
            onClick={() => toggleGroup(group.key)}
        >
            <span className="text-lg mr-2">{group.expanded ? '▼' : '▶'}</span>
            <span className="font-medium text-text-primary flex-1 truncate">{group.label}</span>
            <div className="flex items-center gap-3 text-xs">
                <span className="px-2 py-1 bg-bg-medium rounded text-text-secondary">
                    {group.count} 请求
                </span>
                <span className="px-2 py-1 bg-bg-medium rounded text-text-muted">
                    平均 {formatDuration(group.avgDuration)}
                </span>
                {group.errorCount > 0 && (
                    <span className="px-2 py-1 bg-red-500/20 rounded text-red-400">
                        {group.errorCount} 错误
                    </span>
                )}
                {group.mockedCount > 0 && (
                    <span className="px-2 py-1 bg-purple-500/20 rounded text-purple-400">
                        {group.mockedCount} Mock
                    </span>
                )}
            </div>
        </div>
    )

    const renderEventRow = (event: HTTPEventSummary, style: React.CSSProperties) => {
        const isError = !event.statusCode || event.statusCode >= 400
        const isSelected = event.id === selectedId
        const isChecked = selectedIds.has(event.id)

        // 检查是否匹配规则（用于高亮/标记）
        const matchedRule = matchEventRule(event, applicableRules)
        const isHighlighted = matchedRule?.action === 'highlight'
        const isMarked = matchedRule?.action === 'mark'
        const ruleColor = matchedRule?.color

        return (
            <div
                key={event.id}
                style={isMarked && ruleColor && !isSelected ? { ...style, borderLeftColor: ruleColor } : style}
                onClick={(e) => handleRowClick(event, e)}
                className={clsx(
                    'flex items-center cursor-pointer transition-all duration-150 group border-b border-border-light pl-8',
                    isError && !isSelected && !isHighlighted && 'bg-red-500/5 hover:bg-red-500/10',
                    isSelected && 'bg-primary text-white shadow-sm shadow-primary/20',
                    isChecked && !isSelected && 'bg-primary/15',
                    isHighlighted && !isSelected && 'bg-yellow-500/10 hover:bg-yellow-500/20 border-l-4 border-l-yellow-500',
                    isMarked && !isSelected && !isHighlighted && 'border-l-4',
                    !isSelected && !isChecked && !isError && !isHighlighted && !isMarked && 'hover:bg-bg-light/60'
                )}
            >
                {/* 标记图标 */}
                {(isHighlighted || isMarked) && !isSelected && (
                    <div className="w-6 flex-shrink-0 flex items-center justify-center -ml-6">
                        {isHighlighted && <span className="text-yellow-500 text-xs">⭐</span>}
                        {isMarked && !isHighlighted && <span className="text-xs" style={{ color: ruleColor || 'currentColor' }}>🏷️</span>}
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
                    'px-3 py-3.5 w-[90px] flex-shrink-0',
                    isSelected ? 'text-white/80' : 'text-text-muted'
                )}>
                    <span className="text-sm font-mono">{formatSmartTime(event.startTime)}</span>
                </div>

                {/* Method */}
                <div className="px-3 py-3.5 w-[80px] flex-shrink-0">
                    <span
                        className={clsx(
                            'inline-flex items-center justify-center px-2 py-1 rounded-lg text-xs font-mono font-bold min-w-[50px] shadow-sm',
                            isSelected ? 'bg-white/20 text-white' : getMethodClass(event.method)
                        )}
                    >
                        {event.method}
                    </span>
                </div>

                {/* Status */}
                <div className="px-3 py-3.5 w-[70px] flex-shrink-0">
                    <span
                        className={clsx(
                            'inline-flex items-center justify-center px-2 py-1 rounded-lg text-xs font-mono font-semibold min-w-[40px] shadow-sm',
                            isSelected ? 'bg-white/20 text-white' : getStatusClass(event.statusCode)
                        )}
                    >
                        {event.statusCode ?? 'ERR'}
                    </span>
                </div>

                {/* Path */}
                <div className="px-3 py-3.5 flex-1 min-w-0 overflow-hidden">
                    <span className={clsx(
                        'text-sm truncate',
                        isSelected ? 'text-white' : 'text-text-primary'
                    )} title={event.url}>
                        {(() => {
                            try {
                                return new URL(event.url).pathname
                            } catch {
                                return event.url
                            }
                        })()}
                    </span>
                </div>

                {/* Duration */}
                <div className="px-3 py-3.5 w-[80px] flex-shrink-0">
                    <span className={clsx(
                        'text-sm font-mono font-medium',
                        isSelected ? 'text-white' : getDurationClass(event.duration)
                    )}>
                        {formatDuration(event.duration)}
                    </span>
                </div>

                {/* Tags */}
                <div className="px-3 py-3.5 w-[60px] flex-shrink-0 flex items-center justify-center gap-1">
                    {event.isMocked && (
                        <span className="text-sm" title="已 Mock">🎭</span>
                    )}
                    {event.isFavorite && (
                        <span className="text-sm text-accent-yellow" title="已收藏">★</span>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 工具栏 */}
            <div className="flex items-center justify-between px-4 py-2 bg-bg-medium border-b border-border">
                <span className="text-sm text-text-secondary">
                    {groups.length} 个分组，{events.length} 个请求
                </span>
                <div className="flex gap-2">
                    <button
                        onClick={expandAll}
                        className="px-2 py-1 text-xs text-text-muted hover:text-text-secondary hover:bg-bg-light rounded"
                    >
                        展开全部
                    </button>
                    <button
                        onClick={collapseAll}
                        className="px-2 py-1 text-xs text-text-muted hover:text-text-secondary hover:bg-bg-light rounded"
                    >
                        收起全部
                    </button>
                </div>
            </div>

            {/* 虚拟列表 */}
            <div ref={parentRef} className="flex-1 overflow-auto">
                {virtualItems.length > 0 ? (
                    <div
                        style={{
                            height: `${virtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {virtualizer.getVirtualItems().map((virtualItem) => {
                            const item = virtualItems[virtualItem.index]
                            const style: React.CSSProperties = {
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualItem.size}px`,
                                transform: `translateY(${virtualItem.start}px)`,
                            }

                            if (item.type === 'group-header') {
                                return renderGroupHeader(item.group, style)
                            } else {
                                return renderEventRow(item.event, style)
                            }
                        })}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-text-muted py-20">
                        <div className="w-16 h-16 rounded-lg bg-bg-light flex items-center justify-center mb-4 border border-border">
                            <span className="text-3xl opacity-60">🌐</span>
                        </div>
                        <p className="text-sm font-medium text-text-secondary mb-1">暂无 HTTP 请求</p>
                        <p className="text-xs text-text-muted">等待网络请求被捕获...</p>
                    </div>
                )}
            </div>
        </div>
    )
}
