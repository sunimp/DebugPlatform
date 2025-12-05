// logSearch.ts
// 日志高级搜索解析器
//
// 支持语法:
// - level:error, level:warning, level:info, level:debug, level:verbose
// - subsystem:Network
// - category:API
// - message:"some text" 或 message:timeout
// - traceId:xxx
// - file:ViewController.swift
// - function:viewDidLoad
// - timestamp:>2025-12-05T10:00:00
// - timestamp:<2025-12-05T12:00:00
// - 纯文本搜索（匹配 message）
//
// Created by Sun on 2025/12/06.
// Copyright © 2025 Sun. All rights reserved.
//

import type { LogEvent, LogLevel } from '@/types'

// 日志级别优先级（从低到高）
const LEVEL_PRIORITY: Record<LogLevel, number> = {
    verbose: 0,
    debug: 1,
    info: 2,
    warning: 3,
    error: 4,
}

export interface ParsedLogSearch {
    level?: LogLevel  // 精确级别
    minLevel?: LogLevel  // 最小级别
    subsystem?: string
    category?: string
    message?: string  // 消息搜索（支持正则）
    messageRegex?: RegExp  // 编译后的正则
    traceId?: string
    file?: string
    function?: string
    timestampFrom?: Date
    timestampTo?: Date
    freeText?: string  // 未匹配的自由文本
}

// 解析搜索查询
export function parseLogSearchQuery(query: string): ParsedLogSearch {
    const result: ParsedLogSearch = {}

    if (!query.trim()) {
        return result
    }

    // 支持的字段
    const patterns = [
        // level:error 或 level:>=warning
        { field: 'level', pattern: /level:(>=)?(\w+)/gi },
        // subsystem:Network
        { field: 'subsystem', pattern: /subsystem:("([^"]+)"|(\S+))/gi },
        // category:API
        { field: 'category', pattern: /category:("([^"]+)"|(\S+))/gi },
        // message:"some text" 或 message:timeout
        { field: 'message', pattern: /message:("([^"]+)"|(\S+))/gi },
        // traceId:xxx
        { field: 'traceId', pattern: /traceId:(\S+)/gi },
        // file:xxx
        { field: 'file', pattern: /file:("([^"]+)"|(\S+))/gi },
        // function:xxx
        { field: 'function', pattern: /function:("([^"]+)"|(\S+))/gi },
        // timestamp:>2025-12-05T10:00:00
        { field: 'timestampFrom', pattern: /timestamp:>(\S+)/gi },
        // timestamp:<2025-12-05T10:00:00
        { field: 'timestampTo', pattern: /timestamp:<(\S+)/gi },
    ]

    let remainingQuery = query

    for (const { field, pattern } of patterns) {
        let match
        while ((match = pattern.exec(query)) !== null) {
            remainingQuery = remainingQuery.replace(match[0], '')

            switch (field) {
                case 'level': {
                    const isMinLevel = match[1] === '>='
                    const levelValue = match[2].toLowerCase() as LogLevel
                    if (LEVEL_PRIORITY[levelValue] !== undefined) {
                        if (isMinLevel) {
                            result.minLevel = levelValue
                        } else {
                            result.level = levelValue
                        }
                    }
                    break
                }
                case 'subsystem':
                    result.subsystem = match[2] || match[3]
                    break
                case 'category':
                    result.category = match[2] || match[3]
                    break
                case 'message': {
                    const messageValue = match[2] || match[3]
                    result.message = messageValue
                    // 尝试编译为正则
                    try {
                        result.messageRegex = new RegExp(messageValue, 'i')
                    } catch {
                        // 如果不是有效的正则，使用普通字符串匹配
                    }
                    break
                }
                case 'traceId':
                    result.traceId = match[1]
                    break
                case 'file':
                    result.file = match[2] || match[3]
                    break
                case 'function':
                    result.function = match[2] || match[3]
                    break
                case 'timestampFrom': {
                    const date = new Date(match[1])
                    if (!isNaN(date.getTime())) {
                        result.timestampFrom = date
                    }
                    break
                }
                case 'timestampTo': {
                    const date = new Date(match[1])
                    if (!isNaN(date.getTime())) {
                        result.timestampTo = date
                    }
                    break
                }
            }
        }
    }

    // 剩余的文本作为自由文本搜索
    const freeText = remainingQuery.trim()
    if (freeText) {
        result.freeText = freeText
    }

    return result
}

// 使用解析后的查询过滤日志
export function filterLogsWithSearch(
    events: LogEvent[],
    search: ParsedLogSearch,
    baseMinLevel: LogLevel = 'verbose'
): LogEvent[] {
    // 确定最小级别
    const effectiveMinLevel = search.minLevel || search.level || baseMinLevel
    const minPriority = LEVEL_PRIORITY[effectiveMinLevel]

    return events.filter((event) => {
        // 1. 级别过滤
        const eventPriority = LEVEL_PRIORITY[event.level] ?? 0

        // 如果指定了精确级别，只显示该级别
        if (search.level && event.level !== search.level) {
            return false
        }

        // 最小级别过滤
        if (eventPriority < minPriority) {
            return false
        }

        // 2. Subsystem 过滤
        if (search.subsystem && event.subsystem !== search.subsystem) {
            return false
        }

        // 3. Category 过滤
        if (search.category && event.category !== search.category) {
            return false
        }

        // 4. Message 过滤
        if (search.message) {
            if (search.messageRegex) {
                if (!search.messageRegex.test(event.message)) {
                    return false
                }
            } else if (!event.message.toLowerCase().includes(search.message.toLowerCase())) {
                return false
            }
        }

        // 5. TraceId 过滤
        if (search.traceId && event.traceId !== search.traceId) {
            return false
        }

        // 6. File 过滤
        if (search.file && event.file) {
            if (!event.file.toLowerCase().includes(search.file.toLowerCase())) {
                return false
            }
        }

        // 7. Function 过滤
        if (search.function && event.function) {
            if (!event.function.toLowerCase().includes(search.function.toLowerCase())) {
                return false
            }
        }

        // 8. 时间范围过滤
        if (search.timestampFrom || search.timestampTo) {
            const eventTime = new Date(event.timestamp)
            if (search.timestampFrom && eventTime < search.timestampFrom) {
                return false
            }
            if (search.timestampTo && eventTime > search.timestampTo) {
                return false
            }
        }

        // 9. 自由文本搜索（搜索 message, subsystem, category）
        if (search.freeText) {
            const searchText = search.freeText.toLowerCase()
            const matchMessage = event.message.toLowerCase().includes(searchText)
            const matchSubsystem = event.subsystem?.toLowerCase().includes(searchText)
            const matchCategory = event.category?.toLowerCase().includes(searchText)
            const matchFile = event.file?.toLowerCase().includes(searchText)
            const matchFunction = event.function?.toLowerCase().includes(searchText)

            if (!matchMessage && !matchSubsystem && !matchCategory && !matchFile && !matchFunction) {
                return false
            }
        }

        return true
    })
}

// 生成搜索帮助文本
export const SEARCH_HELP = `
支持的搜索语法:
• level:error - 精确匹配级别
• level:>=warning - 显示 warning 及以上级别
• subsystem:Network - 匹配 subsystem
• category:API - 匹配 category
• message:"error message" - 搜索消息内容
• traceId:xxx - 匹配 traceId
• file:ViewController - 匹配文件名
• function:viewDidLoad - 匹配函数名
• timestamp:>2025-12-05T10:00:00 - 时间范围
• 直接输入文本搜索消息内容
`.trim()
