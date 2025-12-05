/**
 * BlobCell.tsx
 * BLOB 数据单元格渲染组件
 * 
 * 支持：
 * 1. 使用配置的 Protobuf Schema 解码显示
 * 2. 自动 Wire Format 解析
 * 3. 原始 Hex 展示
 */

import { useState, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { useProtobufStore } from '@/stores/protobufStore'
import { tryAutoDecode, formatDecodedMessage } from '@/utils/protobufDescriptor'

interface BlobCellProps {
    /** Base64 编码的 BLOB 数据 */
    value: string
    /** 数据库 ID */
    dbId: string
    /** 表名 */
    tableName: string
    /** 列名 */
    columnName: string
    /** 最大显示宽度 */
    maxWidth?: number
}

type ViewMode = 'decoded' | 'wire' | 'hex'

export function BlobCell({
    value,
    dbId,
    tableName,
    columnName,
    maxWidth = 300,
}: BlobCellProps) {
    const { getColumnConfig, decodeBlobData } = useProtobufStore()
    const [isExpanded, setIsExpanded] = useState(false)
    const [viewMode, setViewMode] = useState<ViewMode>('decoded')
    const [decodedData, setDecodedData] = useState<Record<string, unknown> | null>(null)
    const [decodeError, setDecodeError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    const config = getColumnConfig(dbId, tableName, columnName)

    // 解码数据
    useEffect(() => {
        if (!value || !isExpanded) return

        setIsLoading(true)
        setDecodeError(null)

        if (config) {
            // 使用配置的 Schema 解码
            decodeBlobData(dbId, tableName, columnName, value).then(result => {
                setIsLoading(false)
                if (result.success) {
                    setDecodedData(result.data)
                    setDecodeError(null)
                } else {
                    setDecodedData(null)
                    setDecodeError(result.error)
                }
            })
        } else {
            // 尝试 Wire Format 解析
            const autoDecoded = tryAutoDecode(value)
            setDecodedData(autoDecoded)
            setDecodeError(autoDecoded ? null : '无法自动解析')
            setIsLoading(false)
        }
    }, [value, isExpanded, config, dbId, tableName, columnName, decodeBlobData])

    // 计算 BLOB 大小
    const blobSize = useMemo(() => {
        try {
            const binaryString = atob(value)
            return binaryString.length
        } catch {
            return 0
        }
    }, [value])

    // Hex 视图
    const hexView = useMemo(() => {
        try {
            const binaryString = atob(value)
            const bytes: string[] = []
            for (let i = 0; i < Math.min(binaryString.length, 256); i++) {
                bytes.push(binaryString.charCodeAt(i).toString(16).padStart(2, '0'))
            }
            return bytes
        } catch {
            return []
        }
    }, [value])

    // Wire Format 自动解析结果
    const wireDecoded = useMemo(() => {
        if (viewMode !== 'wire' || !isExpanded) return null
        return tryAutoDecode(value)
    }, [value, viewMode, isExpanded])

    // 折叠状态的预览
    if (!isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                title="点击展开"
            >
                <span className="opacity-70">📦</span>
                <span className="font-mono">
                    {config ? `[${config.messageType.split('.').pop()}]` : `[BLOB ${blobSize}B]`}
                </span>
                {config && <span className="text-green-400 text-2xs">✓</span>}
            </button>
        )
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setIsExpanded(false)}
        >
            <div
                className="bg-bg-dark rounded-lg border border-border shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
                style={{ maxWidth }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* 头部 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                        <span className="text-purple-400">📦</span>
                        <span className="font-mono text-sm text-text-primary">{columnName}</span>
                        <span className="text-xs text-text-muted">({blobSize} bytes)</span>
                        {config && (
                            <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded">
                                {config.messageType}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="p-1 rounded hover:bg-bg-light text-text-muted hover:text-text-secondary transition-colors"
                    >
                        ✕
                    </button>
                </div>

                {/* 视图切换 */}
                <div className="flex gap-1 px-4 py-2 border-b border-border">
                    <button
                        onClick={() => setViewMode('decoded')}
                        className={clsx(
                            'px-3 py-1 text-xs rounded transition-colors',
                            viewMode === 'decoded'
                                ? 'bg-primary/20 text-primary'
                                : 'text-text-muted hover:text-text-secondary hover:bg-bg-light'
                        )}
                    >
                        {config ? 'Schema 解码' : '自动解析'}
                    </button>
                    <button
                        onClick={() => setViewMode('wire')}
                        className={clsx(
                            'px-3 py-1 text-xs rounded transition-colors',
                            viewMode === 'wire'
                                ? 'bg-primary/20 text-primary'
                                : 'text-text-muted hover:text-text-secondary hover:bg-bg-light'
                        )}
                    >
                        Wire Format
                    </button>
                    <button
                        onClick={() => setViewMode('hex')}
                        className={clsx(
                            'px-3 py-1 text-xs rounded transition-colors',
                            viewMode === 'hex'
                                ? 'bg-primary/20 text-primary'
                                : 'text-text-muted hover:text-text-secondary hover:bg-bg-light'
                        )}
                    >
                        Hex
                    </button>
                </div>

                {/* 内容 */}
                <div className="flex-1 overflow-auto p-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                        </div>
                    ) : viewMode === 'decoded' ? (
                        decodedData ? (
                            <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap">
                                {formatDecodedMessage(decodedData)}
                            </pre>
                        ) : decodeError ? (
                            <div className="text-center py-8">
                                <div className="text-yellow-400 mb-2">⚠️</div>
                                <p className="text-sm text-text-muted">{decodeError}</p>
                                {!config && (
                                    <p className="text-xs text-text-muted/50 mt-2">
                                        配置 Protobuf Schema 以获得更好的解析结果
                                    </p>
                                )}
                            </div>
                        ) : null
                    ) : viewMode === 'wire' ? (
                        wireDecoded ? (
                            <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap">
                                {formatDecodedMessage(wireDecoded)}
                            </pre>
                        ) : (
                            <div className="text-center py-8 text-text-muted">
                                无法解析 Wire Format
                            </div>
                        )
                    ) : (
                        // Hex 视图
                        <div className="font-mono text-xs">
                            <div className="flex flex-wrap gap-1">
                                {hexView.map((byte, idx) => (
                                    <span
                                        key={idx}
                                        className={clsx(
                                            'px-1 py-0.5 rounded',
                                            idx % 16 < 8 ? 'bg-bg-light' : 'bg-bg-lighter'
                                        )}
                                    >
                                        {byte}
                                    </span>
                                ))}
                                {blobSize > 256 && (
                                    <span className="text-text-muted px-2">
                                        ... 还有 {blobSize - 256} bytes
                                    </span>
                                )}
                            </div>
                            <div className="mt-4 text-text-muted">
                                共 {blobSize} bytes
                            </div>
                        </div>
                    )}
                </div>

                {/* 底部提示 */}
                {!config && viewMode === 'decoded' && (
                    <div className="px-4 py-2 border-t border-border text-xs text-text-muted bg-bg-darker">
                        💡 提示：上传 .desc 文件并配置列映射可获得精确的解析结果
                    </div>
                )}
            </div>
        </div>
    )
}

/**
 * 检测值是否是 Base64 编码的 BLOB
 */
export function isBase64Blob(value: string | null): boolean {
    if (!value || typeof value !== 'string') return false

    // 检查是否是有效的 Base64（长度是 4 的倍数，只包含 Base64 字符）
    if (value.length < 4 || value.length % 4 !== 0) return false

    // Base64 字符集
    const base64Regex = /^[A-Za-z0-9+/]+=*$/
    if (!base64Regex.test(value)) return false

    // 尝试解码并检查是否包含非打印字符（表示是二进制数据）
    try {
        const decoded = atob(value)
        let binaryCount = 0
        for (let i = 0; i < Math.min(decoded.length, 100); i++) {
            const code = decoded.charCodeAt(i)
            if (code < 32 || code > 126) {
                binaryCount++
            }
        }
        // 如果超过 30% 是非打印字符，认为是二进制数据
        return binaryCount / Math.min(decoded.length, 100) > 0.3
    } catch {
        return false
    }
}
