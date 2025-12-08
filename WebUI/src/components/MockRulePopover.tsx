// MockRulePopover.tsx
// 点击 Mock 标记时显示匹配的 Mock 规则列表
//
// Created by Sun on 2025/12/15.
// Copyright © 2025 Sun. All rights reserved.
//

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import type { MockRule, MockTargetType } from '@/types'
import { MockIcon, UploadIcon, DownloadIcon, PencilIcon } from './icons'
import clsx from 'clsx'
import { createPortal } from 'react-dom'

interface MockRulePopoverProps {
    /** 当前请求的 URL */
    url: string
    /** 当前请求匹配的规则 ID（优先使用） */
    mockRuleId?: string | null
    /** Mock 规则列表 */
    rules: MockRule[]
    /** 点击编辑规则 */
    onEditRule?: (rule: MockRule) => void
    /** 触发元素 */
    children: React.ReactNode
}

const targetTypeConfig: Record<MockTargetType, { label: string; icon: React.ReactNode; color: string }> = {
    httpRequest: { label: 'HTTP 请求', icon: <UploadIcon size={12} />, color: 'text-blue-400' },
    httpResponse: { label: 'HTTP 响应', icon: <DownloadIcon size={12} />, color: 'text-green-400' },
    wsOutgoing: { label: 'WS 发送', icon: <UploadIcon size={12} />, color: 'text-purple-400' },
    wsIncoming: { label: 'WS 接收', icon: <DownloadIcon size={12} />, color: 'text-orange-400' },
}

/**
 * 检查 URL 是否匹配规则的 urlPattern
 */
function matchUrlPattern(url: string, pattern: string | null): boolean {
    if (!pattern) return true // 没有 pattern 则匹配所有

    // 尝试正则匹配
    if (pattern.startsWith('^') || pattern.includes('\\')) {
        try {
            const regex = new RegExp(pattern)
            return regex.test(url)
        } catch {
            // 无效的正则，退回到通配符匹配
        }
    }

    // 通配符匹配：* 匹配任意字符
    const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
        .replace(/\*/g, '.*') // * 转为 .*
    try {
        const regex = new RegExp(`^${regexPattern}$`, 'i')
        return regex.test(url)
    } catch {
        return false
    }
}

/**
 * 获取匹配当前 URL 的规则列表
 * 如果提供了 mockRuleId，优先返回该规则
 */
export function getMatchingRules(url: string, rules: MockRule[], mockRuleId?: string | null): MockRule[] {
    // 如果有精确的 mockRuleId，优先查找
    if (mockRuleId) {
        const exactMatch = rules.find(r => r.id === mockRuleId)
        if (exactMatch) {
            return [exactMatch]
        }
    }

    // 否则通过 URL 模式匹配
    return rules.filter(rule => {
        if (!rule.enabled) return false
        // 只匹配 HTTP 相关的规则
        if (rule.targetType !== 'httpRequest' && rule.targetType !== 'httpResponse') return false
        return matchUrlPattern(url, rule.condition.urlPattern)
    })
}

export function MockRulePopover({
    url,
    mockRuleId,
    rules,
    onEditRule,
    children,
}: MockRulePopoverProps) {
    const [isOpen, setIsOpen] = useState(false)
    const popoverRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLDivElement>(null)

    // 获取匹配的规则（优先使用 mockRuleId）
    const matchingRules = getMatchingRules(url, rules, mockRuleId)

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(e.target as Node) &&
                triggerRef.current &&
                !triggerRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false)
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    const handleTriggerClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsOpen(!isOpen)
    }

    const handleEditRule = (rule: MockRule, e: React.MouseEvent) => {
        e.stopPropagation()
        setIsOpen(false)
        onEditRule?.(rule)
    }

    // 计算弹窗位置
    const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 })
    useLayoutEffect(() => {
        if (isOpen && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect()
            // 弹窗在触发元素上方，水平居中
            setPopoverPosition({
                top: rect.top - 8, // mb-2 = 8px
                left: rect.left + rect.width / 2,
            })
        }
    }, [isOpen])

    // 渲染弹窗内容（通过 Portal 渲染到 body）
    const popoverContent = isOpen ? createPortal(
        <div
            ref={popoverRef}
            style={{
                position: 'fixed',
                top: popoverPosition.top,
                left: popoverPosition.left,
                transform: 'translate(-50%, -100%)',
            }}
            className="z-[300] min-w-[280px] max-w-[360px]"
        >
            <div className="bg-bg-dark border border-border rounded-xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-3 py-2 border-b border-border bg-bg-medium/50">
                    <div className="flex items-center gap-2">
                        <MockIcon size={14} className="text-purple-400" />
                        <span className="text-xs font-medium text-text-primary">
                            匹配的 Mock 规则
                        </span>
                        <span className="text-xs text-text-muted">
                            ({matchingRules.length})
                        </span>
                    </div>
                </div>

                {/* Rules List */}
                <div className="max-h-[240px] overflow-auto">
                    {matchingRules.length > 0 ? (
                        <div className="divide-y divide-border/50">
                            {matchingRules.map((rule) => {
                                const config = targetTypeConfig[rule.targetType]
                                return (
                                    <div
                                        key={rule.id}
                                        className="px-3 py-2 hover:bg-bg-light/50 transition-colors group"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={clsx('flex items-center gap-1 text-xs', config.color)}>
                                                        {config.icon}
                                                        {config.label}
                                                    </span>
                                                    <span className="text-xs font-medium text-text-primary truncate">
                                                        {rule.name}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-text-muted font-mono truncate" title={rule.condition.urlPattern || '所有 URL'}>
                                                    {rule.condition.urlPattern || '*'}
                                                </div>
                                            </div>
                                            {onEditRule && (
                                                <button
                                                    onClick={(e) => handleEditRule(rule, e)}
                                                    className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-bg-light opacity-0 group-hover:opacity-100 transition-all"
                                                    title="编辑规则"
                                                >
                                                    <PencilIcon size={12} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="px-3 py-4 text-center text-text-muted text-xs">
                            没有找到匹配的规则
                        </div>
                    )}
                </div>

                {/* Footer hint */}
                <div className="px-3 py-2 border-t border-border bg-bg-medium/30">
                    <p className="text-xs text-text-muted text-center">
                        点击规则可编辑
                    </p>
                </div>
            </div>

            {/* Arrow */}
            <div
                className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-bg-dark border-r border-b border-border rotate-45"
                style={{ bottom: '-4px' }}
            />
        </div>,
        document.body
    ) : null

    return (
        <div className="relative inline-flex">
            {/* Trigger */}
            <div
                ref={triggerRef}
                onClick={handleTriggerClick}
                className="cursor-pointer"
            >
                {children}
            </div>

            {/* Popover (rendered via Portal) */}
            {popoverContent}
        </div>
    )
}
