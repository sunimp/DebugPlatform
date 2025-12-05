/**
 * ProtobufConfigPanel.tsx
 * Protobuf 描述符和列映射配置面板
 */

import { useState, useRef, useCallback } from 'react'
import clsx from 'clsx'
import { useProtobufStore } from '@/stores/protobufStore'
import type { ColumnProtobufConfig } from '@/utils/protobufDescriptor'

interface ProtobufConfigPanelProps {
    className?: string
    /** 当前选中的数据库 ID */
    dbId: string | null
    /** 当前选中的表名 */
    tableName: string | null
    /** 当前表的列列表 */
    columns: Array<{ name: string; type: string | null }>
    /** 关闭面板 */
    onClose: () => void
}

export function ProtobufConfigPanel({
    className,
    dbId,
    tableName,
    columns,
    onClose,
}: ProtobufConfigPanelProps) {
    const {
        descriptorMeta,
        columnConfigs,
        loading,
        error,
        uploadDescriptor,
        removeDescriptor,
        addColumnConfig,
        removeColumnConfig,
        getColumnConfig,
    } = useProtobufStore()

    const fileInputRef = useRef<HTMLInputElement>(null)
    const [activeTab, setActiveTab] = useState<'descriptors' | 'columns'>('descriptors')
    const [selectedColumn, setSelectedColumn] = useState<string | null>(null)
    const [selectedDescriptor, setSelectedDescriptor] = useState<string>('')
    const [selectedMessageType, setSelectedMessageType] = useState<string>('')

    // BLOB 类型列（SQLite 中 BLOB 类型可能显示为 BLOB、blob 或 null）
    const blobColumns = columns.filter(col => {
        const type = col.type?.toLowerCase()
        return type === 'blob' || type === null || type === ''
    })

    const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        await uploadDescriptor(file)

        // 清空 input 以允许重复上传同名文件
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }, [uploadDescriptor])

    const handleAddColumnConfig = useCallback(() => {
        if (!dbId || !tableName || !selectedColumn || !selectedDescriptor || !selectedMessageType) {
            return
        }

        const config: ColumnProtobufConfig = {
            dbId,
            tableName,
            columnName: selectedColumn,
            messageType: selectedMessageType,
            descriptorName: selectedDescriptor,
        }

        addColumnConfig(config)

        // 重置选择
        setSelectedColumn(null)
        setSelectedMessageType('')
    }, [dbId, tableName, selectedColumn, selectedDescriptor, selectedMessageType, addColumnConfig])

    // 获取当前描述符的消息类型
    const currentDescriptorMeta = descriptorMeta.find(d => d.name === selectedDescriptor)
    const availableMessageTypes = currentDescriptorMeta?.messageTypes || []

    // 当前表的已配置列
    const currentTableConfigs = columnConfigs.filter(
        c => c.dbId === dbId && c.tableName === tableName
    )

    return (
        <div className={clsx('bg-bg-dark rounded-lg border border-border shadow-lg', className)}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <span className="text-purple-400">📦</span>
                    <h3 className="font-medium text-text-primary text-sm">Protobuf 配置</h3>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded hover:bg-bg-light text-text-muted hover:text-text-secondary transition-colors"
                >
                    ✕
                </button>
            </div>

            {/* 标签页 */}
            <div className="flex border-b border-border">
                <button
                    onClick={() => setActiveTab('descriptors')}
                    className={clsx(
                        'flex-1 px-4 py-2 text-xs font-medium transition-colors',
                        activeTab === 'descriptors'
                            ? 'text-primary border-b-2 border-primary'
                            : 'text-text-muted hover:text-text-secondary'
                    )}
                >
                    描述符 ({descriptorMeta.length})
                </button>
                <button
                    onClick={() => setActiveTab('columns')}
                    className={clsx(
                        'flex-1 px-4 py-2 text-xs font-medium transition-colors',
                        activeTab === 'columns'
                            ? 'text-primary border-b-2 border-primary'
                            : 'text-text-muted hover:text-text-secondary'
                    )}
                >
                    列映射 ({currentTableConfigs.length})
                </button>
            </div>

            {/* 内容区 */}
            <div className="p-4">
                {activeTab === 'descriptors' ? (
                    // 描述符管理
                    <div className="space-y-4">
                        {/* 上传按钮 */}
                        <div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".desc,.bin"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={loading}
                                className="w-full px-4 py-2 bg-primary/20 text-primary rounded-lg text-sm font-medium hover:bg-primary/30 disabled:opacity-50 transition-colors"
                            >
                                {loading ? '加载中...' : '📁 上传 .desc 文件'}
                            </button>
                            <p className="text-xs text-text-muted mt-2">
                                使用 <code className="bg-bg-light px-1 rounded">protoc --descriptor_set_out</code> 生成
                            </p>
                        </div>

                        {/* 错误提示 */}
                        {error && (
                            <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                                {error}
                            </div>
                        )}

                        {/* 描述符列表 */}
                        {descriptorMeta.length > 0 ? (
                            <div className="space-y-2">
                                {descriptorMeta.map((desc) => (
                                    <div
                                        key={desc.name}
                                        className="p-3 bg-bg-light rounded-lg border border-border"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="font-mono text-sm text-text-primary truncate">
                                                    {desc.name}
                                                </div>
                                                <div className="text-xs text-text-muted mt-1">
                                                    {desc.messageTypes.length} 个消息类型
                                                </div>
                                                <div className="text-2xs text-text-muted/50 mt-0.5">
                                                    {new Date(desc.uploadedAt).toLocaleString()}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => removeDescriptor(desc.name)}
                                                className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                                                title="删除"
                                            >
                                                🗑️
                                            </button>
                                        </div>

                                        {/* 消息类型预览 */}
                                        <div className="mt-2 max-h-24 overflow-auto">
                                            <div className="text-2xs font-mono text-text-muted space-y-0.5">
                                                {desc.messageTypes.slice(0, 10).map((type) => (
                                                    <div key={type} className="truncate">
                                                        {type}
                                                    </div>
                                                ))}
                                                {desc.messageTypes.length > 10 && (
                                                    <div className="text-text-muted/50">
                                                        ... 还有 {desc.messageTypes.length - 10} 个
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-text-muted">
                                <div className="text-3xl mb-2 opacity-50">📭</div>
                                <p className="text-sm">尚未上传描述符文件</p>
                            </div>
                        )}
                    </div>
                ) : (
                    // 列映射配置
                    <div className="space-y-4">
                        {/* 当前表信息 */}
                        {dbId && tableName ? (
                            <>
                                <div className="text-xs text-text-muted">
                                    当前表: <span className="font-mono text-text-secondary">{tableName}</span>
                                </div>

                                {/* 已配置的列 */}
                                {currentTableConfigs.length > 0 && (
                                    <div className="space-y-2">
                                        <div className="text-xs font-medium text-text-muted">已配置的列:</div>
                                        {currentTableConfigs.map((config) => (
                                            <div
                                                key={config.columnName}
                                                className="flex items-center justify-between p-2 bg-bg-light rounded border border-border"
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-mono text-sm text-primary">
                                                        {config.columnName}
                                                    </div>
                                                    <div className="text-xs text-text-muted truncate">
                                                        → {config.messageType}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => removeColumnConfig(config.dbId, config.tableName, config.columnName)}
                                                    className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* 添加新配置 */}
                                {descriptorMeta.length > 0 && blobColumns.length > 0 ? (
                                    <div className="space-y-3 p-3 bg-bg-lighter rounded-lg border border-border">
                                        <div className="text-xs font-medium text-text-muted">添加配置:</div>

                                        {/* 选择列 */}
                                        <div>
                                            <label className="block text-2xs text-text-muted mb-1">BLOB 列</label>
                                            <select
                                                value={selectedColumn || ''}
                                                onChange={(e) => setSelectedColumn(e.target.value || null)}
                                                className="w-full px-2 py-1.5 bg-bg-dark border border-border rounded text-sm text-text-primary focus:outline-none focus:border-primary"
                                            >
                                                <option value="">选择列...</option>
                                                {blobColumns.map((col) => {
                                                    const isConfigured = getColumnConfig(dbId, tableName, col.name)
                                                    return (
                                                        <option key={col.name} value={col.name} disabled={!!isConfigured}>
                                                            {col.name} {isConfigured ? '(已配置)' : ''}
                                                        </option>
                                                    )
                                                })}
                                            </select>
                                        </div>

                                        {/* 选择描述符 */}
                                        <div>
                                            <label className="block text-2xs text-text-muted mb-1">描述符</label>
                                            <select
                                                value={selectedDescriptor}
                                                onChange={(e) => {
                                                    setSelectedDescriptor(e.target.value)
                                                    setSelectedMessageType('')
                                                }}
                                                className="w-full px-2 py-1.5 bg-bg-dark border border-border rounded text-sm text-text-primary focus:outline-none focus:border-primary"
                                            >
                                                <option value="">选择描述符...</option>
                                                {descriptorMeta.map((desc) => (
                                                    <option key={desc.name} value={desc.name}>
                                                        {desc.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* 选择消息类型 */}
                                        <div>
                                            <label className="block text-2xs text-text-muted mb-1">消息类型</label>
                                            <select
                                                value={selectedMessageType}
                                                onChange={(e) => setSelectedMessageType(e.target.value)}
                                                disabled={!selectedDescriptor}
                                                className="w-full px-2 py-1.5 bg-bg-dark border border-border rounded text-sm text-text-primary focus:outline-none focus:border-primary disabled:opacity-50"
                                            >
                                                <option value="">选择消息类型...</option>
                                                {availableMessageTypes.map((type) => (
                                                    <option key={type} value={type}>
                                                        {type}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* 添加按钮 */}
                                        <button
                                            onClick={handleAddColumnConfig}
                                            disabled={!selectedColumn || !selectedDescriptor || !selectedMessageType}
                                            className="w-full px-3 py-1.5 bg-primary text-white rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                        >
                                            添加映射
                                        </button>
                                    </div>
                                ) : descriptorMeta.length === 0 ? (
                                    <div className="text-center py-4 text-text-muted text-xs">
                                        请先上传描述符文件
                                    </div>
                                ) : (
                                    <div className="text-center py-4 text-text-muted text-xs">
                                        当前表没有 BLOB 类型的列
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="text-center py-8 text-text-muted">
                                <div className="text-3xl mb-2 opacity-50">👈</div>
                                <p className="text-sm">请先选择一个表</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
