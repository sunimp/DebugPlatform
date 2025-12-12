// DBInspector.tsx
// Database Inspector Component
//
// Created by Sun on 2025/12/05.
// Copyright © 2025 Sun. All rights reserved.
//

import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import clsx from 'clsx'
import { useDBStore } from '@/stores/dbStore'
import { useProtobufStore } from '@/stores/protobufStore'
import { ProtobufConfigPanel } from './ProtobufConfigPanel'
import { BlobCell, isBase64Blob } from './BlobCell'
import { ListLoadingOverlay } from './ListLoadingOverlay'
import { LogIcon, LightningIcon, DatabaseIcon, WarningIcon, LockIcon, ArrowUpIcon, ArrowDownIcon, EditIcon, ClipboardIcon, PackageIcon, SearchIcon, XIcon } from './icons'

interface DBInspectorProps {
    deviceId: string
}

export function DBInspector({ deviceId }: DBInspectorProps) {
    const {
        // State
        databases,
        dbLoading,
        dbError,
        selectedDb,
        selectedTable,
        tables,
        tablesLoading,
        schema,
        showSchema,
        tableData,
        dataLoading,
        dataError,
        page,
        pageSize,
        orderBy,
        ascending,
        // SQL 查询状态
        queryMode,
        queryInput,
        queryResult,
        queryLoading,
        queryError,
        // 数据库排序状态
        dbSortOrder,
        dbSortAscending,
        // Actions
        loadDatabases,
        loadTables,
        loadSchema,
        loadTableData,
        selectDb,
        selectTable,
        setShowSchema,
        setSortAndReload,
        setPageAndReload,
        // SQL 查询 Actions
        setQueryMode,
        setQueryInput,
        executeQuery,
        // 数据库排序 Actions
        setDbSortOrder,
        toggleDbSortDirection,
        getSortedDatabases,
        // 重置 Action
        reset,
    } = useDBStore()

    // Protobuf 配置
    const { descriptorMeta, getColumnConfig } = useProtobufStore()
    const [showProtobufConfig, setShowProtobufConfig] = useState(false)

    // 列筛选状态：columnName -> filterValue
    const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
    // 展开的筛选列
    const [expandedFilterColumn, setExpandedFilterColumn] = useState<string | null>(null)

    // 双击单元格弹出框状态
    const [cellDetailPopup, setCellDetailPopup] = useState<{
        value: string
        columnName: string
        position: { x: number; y: number }
    } | null>(null)

    // 跟踪 deviceId 变化
    const prevDeviceIdRef = useRef(deviceId)

    // 切换表时清空筛选
    const prevTableRef = useRef(selectedTable)
    useEffect(() => {
        if (prevTableRef.current !== selectedTable) {
            setColumnFilters({})
            setExpandedFilterColumn(null)
            prevTableRef.current = selectedTable
        }
    }, [selectedTable])

    // 设备切换时重置状态并重新加载
    useEffect(() => {
        if (prevDeviceIdRef.current !== deviceId) {
            // 设备切换，重置所有状态
            reset()
            prevDeviceIdRef.current = deviceId
        }
        // 加载数据库列表
        loadDatabases(deviceId)
    }, [deviceId, reset, loadDatabases])

    // 选中数据库后加载表（仅当表列表为空时）
    useEffect(() => {
        if (selectedDb && tables.length === 0) {
            loadTables(deviceId, selectedDb)
        }
    }, [deviceId, selectedDb, tables.length, loadTables])

    // 选中表后加载数据和结构
    useEffect(() => {
        if (selectedDb && selectedTable && !tableData) {
            loadSchema(deviceId, selectedDb, selectedTable)
            loadTableData(deviceId, selectedDb, selectedTable)
        }
    }, [deviceId, selectedDb, selectedTable, tableData, loadSchema, loadTableData])

    // 处理选择数据库
    const handleSelectDb = useCallback((dbId: string) => {
        selectDb(dbId)
        // 选择后立即加载表
        loadTables(deviceId, dbId)
    }, [selectDb, loadTables, deviceId])

    // 处理选择表
    const handleSelectTable = useCallback((table: string) => {
        selectTable(table)
        // 选择后立即加载数据和 schema
        if (selectedDb) {
            loadSchema(deviceId, selectedDb, table)
            loadTableData(deviceId, selectedDb, table)
        }
    }, [selectTable, selectedDb, deviceId, loadSchema, loadTableData])

    // 处理排序
    const handleSort = useCallback((column: string) => {
        setSortAndReload(deviceId, column)
    }, [setSortAndReload, deviceId])

    // 处理分页
    const handlePageChange = useCallback((newPage: number) => {
        setPageAndReload(deviceId, newPage)
    }, [setPageAndReload, deviceId])

    // 处理列筛选
    const handleColumnFilter = useCallback((column: string, value: string) => {
        setColumnFilters(prev => {
            if (value === '') {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { [column]: _, ...rest } = prev
                return rest
            }
            return { ...prev, [column]: value }
        })
    }, [])

    // 清除单列筛选
    const clearColumnFilter = useCallback((column: string) => {
        setColumnFilters(prev => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [column]: _, ...rest } = prev
            return rest
        })
        setExpandedFilterColumn(null)
    }, [])

    // 清除所有筛选
    const clearAllFilters = useCallback(() => {
        setColumnFilters({})
        setExpandedFilterColumn(null)
    }, [])

    // 处理双击单元格显示完整数据
    const handleCellDoubleClick = useCallback((
        e: React.MouseEvent,
        value: string | null,
        columnName: string
    ) => {
        if (value === null) return
        const rect = (e.target as HTMLElement).getBoundingClientRect()
        setCellDetailPopup({
            value,
            columnName,
            position: {
                x: Math.min(rect.left, window.innerWidth - 400),
                y: Math.min(rect.bottom + 5, window.innerHeight - 300)
            }
        })
    }, [])

    // 复制文本到剪贴板
    const copyToClipboard = useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }, [])

    // 根据筛选条件过滤数据（客户端筛选）
    const filteredRows = useMemo(() => {
        if (!tableData?.rows) return []
        const filterEntries = Object.entries(columnFilters)
        if (filterEntries.length === 0) return tableData.rows

        return tableData.rows.filter(row => {
            return filterEntries.every(([column, filterValue]) => {
                const cellValue = row.values[column]
                if (cellValue === null || cellValue === undefined) {
                    return filterValue.toLowerCase() === 'null'
                }
                return String(cellValue).toLowerCase().includes(filterValue.toLowerCase())
            })
        })
    }, [tableData?.rows, columnFilters])

    // 格式化文件大小
    const formatBytes = (bytes: number | null) => {
        if (bytes === null) return '-'
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    // 获取数据库类型图标
    const getDbKindIcon = (kind: string) => {
        switch (kind) {
            case 'log': return <LogIcon size={16} />
            case 'cache': return <LightningIcon size={16} />
            default: return <DatabaseIcon size={16} />
        }
    }

    if (dbLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        )
    }

    if (dbError) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
                <WarningIcon size={36} className="mb-3 opacity-50" />
                <p className="text-sm mb-3">{dbError}</p>
                <button
                    onClick={() => loadDatabases(deviceId)}
                    className="px-4 py-2 bg-primary/20 text-primary rounded-lg hover:bg-primary/30 transition-colors"
                >
                    重试
                </button>
            </div>
        )
    }

    if (databases.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
                <DatabaseIcon size={36} className="mb-3 opacity-50" />
                <p className="text-sm">没有注册的数据库</p>
                <p className="text-xs mt-2 text-text-muted">
                    在 App 中使用 DatabaseRegistry.shared.register() 注册数据库
                </p>
            </div>
        )
    }

    return (
        <div className="flex h-full">
            {/* 左侧 - 数据库和表列表 */}
            <div className="w-64 flex-shrink-0 border-r border-border bg-bg-dark flex flex-col">
                {/* 数据库列表 */}
                <div className="p-3 border-b border-border">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
                            数据库
                        </h3>
                        {/* 刷新和排序控件 */}
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => loadDatabases(deviceId)}
                                disabled={dbLoading}
                                className="px-2 py-1 bg-bg-light text-text-secondary rounded text-xs hover:bg-bg-lighter transition-colors disabled:opacity-50"
                                title="刷新所有数据库"
                            >
                                刷新
                            </button>
                            <select
                                value={dbSortOrder}
                                onChange={(e) => setDbSortOrder(e.target.value as 'name' | 'size' | 'tableCount')}
                                className="text-2xs bg-bg-light border border-border rounded px-1.5 py-0.5 text-text-secondary focus:outline-none focus:border-primary"
                                title="排序方式"
                            >
                                <option value="name">名称</option>
                                <option value="size">大小</option>
                                <option value="tableCount">表数</option>
                            </select>
                            <button
                                onClick={toggleDbSortDirection}
                                className="p-1 rounded hover:bg-bg-light text-text-muted hover:text-text-secondary transition-colors"
                                title={dbSortAscending ? '升序' : '降序'}
                            >
                                {dbSortAscending ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />}
                            </button>
                        </div>
                    </div>
                    <div className="space-y-1">
                        {getSortedDatabases().map((db) => (
                            <button
                                key={db.descriptor.id}
                                onClick={() => handleSelectDb(db.descriptor.id)}
                                className={clsx(
                                    'w-full px-3 py-2 rounded-lg text-left text-xs transition-all',
                                    selectedDb === db.descriptor.id
                                        ? 'bg-primary text-white shadow-sm shadow-primary/30'
                                        : 'text-text-secondary hover:bg-bg-light'
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <span>{getDbKindIcon(db.descriptor.kind)}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium truncate">{db.descriptor.name}</div>
                                        <div className={clsx(
                                            'text-2xs',
                                            selectedDb === db.descriptor.id ? 'text-white/70' : 'text-text-muted'
                                        )}>
                                            {db.tableCount} 表 • {formatBytes(db.fileSizeBytes)}
                                        </div>
                                    </div>
                                    {db.descriptor.isSensitive && (
                                        <span className="text-yellow-500" title="敏感数据"><LockIcon size={12} /></span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 表列表 */}
                <div className="flex-1 overflow-auto p-3">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
                            表 {tables.length > 0 && `(${tables.length})`}
                        </h3>
                        <div className="flex items-center gap-1">
                            {selectedDb && (
                                <>
                                    <button
                                        onClick={() => selectedDb && loadTables(deviceId, selectedDb)}
                                        disabled={tablesLoading}
                                        className="px-2 py-1 bg-bg-light text-text-secondary rounded text-xs hover:bg-bg-lighter transition-colors disabled:opacity-50"
                                        title="刷新当前数据库的所有表"
                                    >
                                        刷新
                                    </button>
                                    <button
                                        onClick={() => setQueryMode(!queryMode)}
                                        className={clsx(
                                            'px-2 py-1 bg-bg-light rounded text-xs transition-colors',
                                            queryMode
                                                ? 'bg-accent-blue/20 text-accent-blue'
                                                : 'text-text-secondary hover:bg-bg-lighter'
                                        )}
                                        title="SQL 查询"
                                    >
                                        {'SQL 查询'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    {tablesLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
                        </div>
                    ) : selectedDb ? (
                        <div className="space-y-1">
                            {tables.map((table) => (
                                <button
                                    key={table.name}
                                    onClick={() => handleSelectTable(table.name)}
                                    className={clsx(
                                        'w-full px-3 py-2 rounded-lg text-left text-xs transition-all',
                                        selectedTable === table.name
                                            ? 'bg-accent-blue text-white shadow-sm shadow-accent-blue/30'
                                            : 'text-text-secondary hover:bg-bg-light'
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono truncate">{table.name}</span>
                                        <span className={clsx(
                                            'tabular-nums',
                                            selectedTable === table.name ? 'text-white/70' : 'text-text-muted'
                                        )}>
                                            {table.rowCount !== null ? table.rowCount.toLocaleString() : '?'}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-text-muted text-center py-4">
                            请先选择数据库
                        </p>
                    )}
                </div>
            </div>

            {/* 右侧 - 表数据或 SQL 查询 */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {queryMode ? (
                    // SQL 查询模式
                    <>
                        {/* 查询输入区 */}
                        <div className="p-4 border-b border-border bg-bg-dark/50">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-text-muted">SQL 查询</span>
                                    <span className="text-xs text-text-muted/50">（仅支持 SELECT）</span>
                                </div>
                                <button
                                    onClick={() => setQueryMode(false)}
                                    className="px-2 py-1 bg-bg-light text-text-secondary rounded text-xs hover:bg-bg-lighter transition-colors"
                                    title="关闭 SQL 查询"
                                >
                                    关闭
                                </button>
                            </div>
                            <textarea
                                value={queryInput}
                                onChange={(e) => setQueryInput(e.target.value)}
                                placeholder="SELECT * FROM table_name LIMIT 100"
                                className="w-full h-24 px-3 py-2 bg-bg-light border border-border rounded-lg text-sm font-mono text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-primary/50"
                                onKeyDown={(e) => {
                                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                        executeQuery(deviceId)
                                    }
                                }}
                            />
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-text-muted">
                                    {queryResult && (
                                        <>
                                            {queryResult.rowCount} 行 • {queryResult.executionTimeMs.toFixed(2)} ms
                                        </>
                                    )}
                                </span>
                                <button
                                    onClick={() => executeQuery(deviceId)}
                                    disabled={queryLoading || !queryInput.trim()}
                                    className="px-4 py-1.5 bg-primary text-white rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                >
                                    {queryLoading ? '执行中...' : '执行 (⌘↵)'}
                                </button>
                            </div>
                            {queryError && (
                                <div className="mt-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                                    {queryError}
                                </div>
                            )}
                        </div>

                        {/* 查询结果 */}
                        <div className="flex-1 overflow-auto">
                            {queryLoading ? (
                                <div className="flex items-center justify-center h-full">
                                    <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                                </div>
                            ) : queryResult ? (
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-bg-dark">
                                        <tr>
                                            {queryResult.columns.map((col) => (
                                                <th
                                                    key={col.name}
                                                    className="px-3 py-2 text-left font-medium text-text-muted border-b border-border"
                                                >
                                                    {col.name}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="font-mono">
                                        {queryResult.rows.map((row, idx) => (
                                            <tr
                                                key={idx}
                                                className="border-b border-border hover:bg-bg-light/30 transition-colors"
                                            >
                                                {queryResult.columns.map((col) => (
                                                    <td
                                                        key={col.name}
                                                        className="px-3 py-2 text-text-secondary max-w-xs truncate"
                                                        title={row.values[col.name] ?? ''}
                                                    >
                                                        {row.values[col.name] === null ? (
                                                            <span className="text-text-muted italic">NULL</span>
                                                        ) : (
                                                            row.values[col.name]
                                                        )}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="flex items-center justify-center h-full text-text-muted">
                                    <div className="text-center flex flex-col items-center">
                                        <EditIcon size={36} className="mb-3 opacity-50" />
                                        <p className="text-sm">输入 SQL 查询语句并执行</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                ) : selectedTable ? (
                    <>
                        {/* 工具栏 */}
                        <div className="px-4 py-2 border-b border-border bg-bg-dark/50 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <h3 className="font-mono text-sm text-text-primary">{selectedTable}</h3>
                                {tableData && (
                                    <span className="text-xs text-text-muted">
                                        {tableData.totalRows?.toLocaleString() ?? '?'} 行
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowProtobufConfig(!showProtobufConfig)}
                                    className={clsx(
                                        'px-3 py-1.5 rounded text-xs transition-colors flex items-center gap-1 whitespace-nowrap',
                                        showProtobufConfig
                                            ? 'bg-purple-500/20 text-purple-400'
                                            : descriptorMeta.length > 0
                                                ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20'
                                                : 'bg-bg-light text-text-secondary hover:bg-bg-lighter'
                                    )}
                                    title="Protobuf 配置"
                                >
                                    <PackageIcon size={12} /> Protobuf {descriptorMeta.length > 0 && `(${descriptorMeta.length})`}
                                </button>
                                <button
                                    onClick={() => setShowSchema(!showSchema)}
                                    className={clsx(
                                        'px-3 py-1.5 rounded text-xs transition-colors flex items-center gap-1',
                                        showSchema
                                            ? 'bg-primary/20 text-primary'
                                            : 'bg-bg-light text-text-secondary hover:bg-bg-lighter'
                                    )}
                                >
                                    <ClipboardIcon size={12} /> Schema
                                </button>
                                <button
                                    onClick={() => {
                                        setQueryInput(`SELECT * FROM ${selectedTable} LIMIT 100`)
                                        setQueryMode(true)
                                    }}
                                    className="px-3 py-1.5 bg-bg-light text-text-secondary rounded text-xs hover:bg-bg-lighter transition-colors flex items-center gap-1"
                                    title="查询当前表"
                                >
                                    SQL 查询
                                </button>
                                <button
                                    onClick={() => selectedDb && selectedTable && loadTableData(deviceId, selectedDb, selectedTable)}
                                    disabled={dataLoading}
                                    className="px-3 py-1.5 bg-bg-light text-text-secondary rounded text-xs hover:bg-bg-lighter transition-colors disabled:opacity-50"
                                >
                                    刷新
                                </button>
                            </div>
                        </div>

                        {/* Protobuf 配置面板 */}
                        {showProtobufConfig && (
                            <div className="px-4 py-3 border-b border-border bg-bg-dark/30">
                                <ProtobufConfigPanel
                                    dbId={selectedDb}
                                    tableName={selectedTable}
                                    columns={schema.map(col => ({ name: col.name, type: col.type }))}
                                    onClose={() => setShowProtobufConfig(false)}
                                />
                            </div>
                        )}

                        {/* Schema 面板 */}
                        {showSchema && schema.length > 0 && (
                            <div className="px-4 py-3 border-b border-border bg-bg-dark/30">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-left text-text-muted">
                                            <th className="pb-2 font-medium">列名</th>
                                            <th className="pb-2 font-medium">类型</th>
                                            <th className="pb-2 font-medium">主键</th>
                                            <th className="pb-2 font-medium">非空</th>
                                            <th className="pb-2 font-medium">默认值</th>
                                        </tr>
                                    </thead>
                                    <tbody className="font-mono">
                                        {schema.map((col) => (
                                            <tr key={col.name} className="border-t border-border">
                                                <td className="py-1.5 text-primary">{col.name}</td>
                                                <td className="py-1.5 text-text-secondary">{col.type || '-'}</td>
                                                <td className="py-1.5">{col.primaryKey ? '✓' : ''}</td>
                                                <td className="py-1.5">{col.notNull ? '✓' : ''}</td>
                                                <td className="py-1.5 text-text-muted">{col.defaultValue || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* 筛选状态提示 */}
                        {Object.keys(columnFilters).length > 0 && (
                            <div className="px-4 py-2 border-b border-border bg-primary/10 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs text-primary">
                                    <SearchIcon size={14} />
                                    <span>
                                        已筛选 {Object.keys(columnFilters).length} 列，
                                        显示 {filteredRows.length} / {tableData?.rows.length ?? 0} 行
                                    </span>
                                </div>
                                <button
                                    onClick={clearAllFilters}
                                    className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                                >
                                    <XIcon size={12} />
                                    清除筛选
                                </button>
                            </div>
                        )}

                        {/* 表数据 */}
                        <div className="flex-1 overflow-auto relative">
                            {/* 刷新加载覆盖层 */}
                            <ListLoadingOverlay isLoading={dataLoading} text="刷新表数据..." />

                            {tableData ? (
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-bg-dark z-10">
                                        {/* 列名行 */}
                                        <tr>
                                            {tableData.columns.map((col) => {
                                                const isFiltered = columnFilters[col.name] !== undefined
                                                const isExpanded = expandedFilterColumn === col.name

                                                return (
                                                    <th
                                                        key={col.name}
                                                        className="px-3 py-2 text-left font-medium text-text-muted border-b border-border"
                                                    >
                                                        <div className="flex items-center gap-1">
                                                            {/* 列名（点击排序） */}
                                                            <span
                                                                onClick={() => handleSort(col.name)}
                                                                className={clsx(
                                                                    'cursor-pointer hover:text-text-secondary transition-colors',
                                                                    col.primaryKey ? 'text-primary' : ''
                                                                )}
                                                            >
                                                                {col.name}
                                                            </span>

                                                            {/* 排序图标 */}
                                                            {orderBy === col.name && (
                                                                <span className="text-primary">
                                                                    {ascending ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />}
                                                                </span>
                                                            )}

                                                            {/* 筛选按钮 */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    setExpandedFilterColumn(isExpanded ? null : col.name)
                                                                }}
                                                                className={clsx(
                                                                    'ml-auto p-0.5 rounded hover:bg-bg-light/50 transition-colors',
                                                                    isFiltered ? 'text-primary' : 'text-text-muted opacity-50 hover:opacity-100'
                                                                )}
                                                                title="筛选"
                                                            >
                                                                <SearchIcon size={12} />
                                                            </button>
                                                        </div>

                                                        {/* 筛选输入框（展开时显示） */}
                                                        {isExpanded && (
                                                            <div className="mt-2 flex items-center gap-1">
                                                                <input
                                                                    type="text"
                                                                    value={columnFilters[col.name] ?? ''}
                                                                    onChange={(e) => handleColumnFilter(col.name, e.target.value)}
                                                                    placeholder={`筛选 ${col.name}...`}
                                                                    className="flex-1 px-2 py-1 text-xs bg-bg-light border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary text-text-secondary"
                                                                    autoFocus
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter' || e.key === 'Escape') {
                                                                            setExpandedFilterColumn(null)
                                                                        }
                                                                    }}
                                                                />
                                                                {isFiltered && (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            clearColumnFilter(col.name)
                                                                        }}
                                                                        className="p-1 text-text-muted hover:text-red-400 transition-colors"
                                                                        title="清除筛选"
                                                                    >
                                                                        <XIcon size={12} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </th>
                                                )
                                            })}
                                        </tr>
                                    </thead>
                                    <tbody className="font-mono">
                                        {filteredRows.map((row, idx) => (
                                            <tr
                                                key={idx}
                                                className="border-b border-border hover:bg-bg-light/30 transition-colors"
                                            >
                                                {tableData.columns.map((col) => {
                                                    const cellValue = row.values[col.name]
                                                    const isBlobColumn = col.type?.toLowerCase() === 'blob'
                                                    const hasProtobufConfig = selectedDb && selectedTable && getColumnConfig(selectedDb, selectedTable, col.name)
                                                    const shouldTreatAsBlob = isBlobColumn || (cellValue && isBase64Blob(cellValue) && hasProtobufConfig)

                                                    return (
                                                        <td
                                                            key={col.name}
                                                            className="px-3 py-2 text-text-secondary max-w-xs cursor-pointer"
                                                            onDoubleClick={(e) => handleCellDoubleClick(e, cellValue, col.name)}
                                                            title="双击查看完整内容"
                                                        >
                                                            {cellValue === null ? (
                                                                <span className="text-text-muted italic">NULL</span>
                                                            ) : shouldTreatAsBlob && selectedDb && selectedTable ? (
                                                                <BlobCell
                                                                    value={cellValue}
                                                                    dbId={selectedDb}
                                                                    tableName={selectedTable}
                                                                    columnName={col.name}
                                                                />
                                                            ) : (
                                                                <span className="truncate block">
                                                                    {cellValue}
                                                                </span>
                                                            )}
                                                        </td>
                                                    )
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : dataError ? (
                                <div className="flex flex-col items-center justify-center h-full text-text-muted">
                                    <WarningIcon size={36} className="mb-3 opacity-50" />
                                    <p className="text-sm text-red-400 mb-2">{dataError}</p>
                                    <button
                                        onClick={() => selectedDb && selectedTable && loadTableData(deviceId, selectedDb, selectedTable)}
                                        className="px-4 py-2 bg-primary/20 text-primary rounded-lg hover:bg-primary/30 transition-colors text-xs"
                                    >
                                        重试
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full text-text-muted">
                                    无数据
                                </div>
                            )}
                        </div>

                        {/* 分页 */}
                        {tableData && tableData.totalRows !== null && tableData.totalRows > pageSize && (
                            <div className="px-4 py-2 border-t border-border bg-bg-dark/50 flex items-center justify-between">
                                <span className="text-xs text-text-muted">
                                    第 {page} 页 / 共 {Math.ceil(tableData.totalRows / pageSize)} 页
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handlePageChange(Math.max(1, page - 1))}
                                        disabled={page <= 1}
                                        className="px-3 py-1 bg-bg-light text-text-secondary rounded text-xs hover:bg-bg-lighter disabled:opacity-50 transition-colors"
                                    >
                                        上一页
                                    </button>
                                    <button
                                        onClick={() => handlePageChange(page + 1)}
                                        disabled={page >= Math.ceil(tableData.totalRows / pageSize)}
                                        className="px-3 py-1 bg-bg-light text-text-secondary rounded text-xs hover:bg-bg-lighter disabled:opacity-50 transition-colors"
                                    >
                                        下一页
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex items-center justify-center h-full text-text-muted">
                        <div className="text-center flex flex-col items-center">
                            <span className="text-4xl mb-3 opacity-50">👈</span>
                            <p className="text-sm">
                                {selectedDb ? '选择一个表查看数据' : '选择一个数据库'}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* 单元格详情弹出框 */}
            {cellDetailPopup && (
                <div
                    className="fixed inset-0 z-50"
                    onClick={() => setCellDetailPopup(null)}
                >
                    <div
                        className="absolute bg-bg-dark border border-border rounded-lg shadow-xl max-w-md max-h-80 overflow-hidden flex flex-col"
                        style={{
                            left: cellDetailPopup.position.x,
                            top: cellDetailPopup.position.y,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 标题栏 */}
                        <div className="px-3 py-2 border-b border-border bg-bg-light/50 flex items-center justify-between">
                            <span className="text-xs font-medium text-text-muted">
                                {cellDetailPopup.columnName}
                            </span>
                            <button
                                onClick={() => setCellDetailPopup(null)}
                                className="p-1 text-text-muted hover:text-red-400 transition-colors"
                                title="关闭"
                            >
                                <XIcon size={14} />
                            </button>
                        </div>
                        {/* 内容区域 */}
                        <div className="p-3 overflow-auto flex-1 flex gap-2">
                            <pre className="flex-1 text-xs text-text-secondary whitespace-pre-wrap break-all font-mono select-text">
                                {cellDetailPopup.value}
                            </pre>
                            <button
                                onClick={() => {
                                    copyToClipboard(cellDetailPopup.value)
                                }}
                                className="flex-shrink-0 self-start p-1.5 text-text-muted hover:text-primary hover:bg-bg-light/50 rounded transition-colors"
                                title="复制内容"
                            >
                                <ClipboardIcon size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
