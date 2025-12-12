// dbStore.ts
// Database Inspector State Management
//
// Created by Sun on 2025/12/05.
// Copyright © 2025 Sun. All rights reserved.
//

import { create } from 'zustand'
import type { DBInfo, DBTableInfo, DBColumnInfo, DBTablePageResult, DBQueryResponse } from '@/types'
import * as api from '@/services/api'

// 数据库排序方式
export type DBSortOrder = 'name' | 'size' | 'tableCount'

interface DBState {
    // 数据库列表
    databases: DBInfo[]
    dbLoading: boolean
    dbError: string | null

    // 数据库排序
    dbSortOrder: DBSortOrder
    dbSortAscending: boolean

    // 当前选中
    selectedDb: string | null
    selectedTable: string | null

    // 表列表
    tables: DBTableInfo[]
    tablesLoading: boolean

    // 表结构
    schema: DBColumnInfo[]
    showSchema: boolean

    // 表数据
    tableData: DBTablePageResult | null
    dataLoading: boolean
    dataError: string | null
    page: number
    pageSize: number
    orderBy: string | null
    ascending: boolean

    // SQL 查询
    queryMode: boolean
    queryInput: string
    queryResult: DBQueryResponse | null
    queryLoading: boolean
    queryError: string | null

    // Actions
    loadDatabases: (deviceId: string) => Promise<void>
    loadTables: (deviceId: string, dbId: string) => Promise<void>
    loadSchema: (deviceId: string, dbId: string, table: string) => Promise<void>
    loadTableData: (deviceId: string, dbId: string, table: string) => Promise<void>

    selectDb: (dbId: string | null) => void
    selectTable: (table: string | null) => void
    setShowSchema: (show: boolean) => void
    setPage: (page: number) => void
    setSort: (column: string) => void
    setSortAndReload: (deviceId: string, column: string) => Promise<void>
    setPageAndReload: (deviceId: string, page: number) => Promise<void>

    // 数据库排序 Actions
    setDbSortOrder: (order: DBSortOrder) => void
    toggleDbSortDirection: () => void

    // SQL 查询 Actions
    setQueryMode: (mode: boolean) => void
    setQueryInput: (input: string) => void
    executeQuery: (deviceId: string) => Promise<void>
    clearQueryResult: () => void

    // 重置状态（切换设备时调用）
    reset: () => void

    // 获取排序后的数据库列表
    getSortedDatabases: () => DBInfo[]
}

const initialState = {
    databases: [],
    dbLoading: false,
    dbError: null,
    dbSortOrder: 'name' as DBSortOrder,
    dbSortAscending: true,
    selectedDb: null,
    selectedTable: null,
    tables: [],
    tablesLoading: false,
    schema: [],
    showSchema: false,
    tableData: null,
    dataLoading: false,
    dataError: null,
    page: 1,
    pageSize: 100,
    orderBy: null,
    ascending: true,
    // SQL 查询
    queryMode: false,
    queryInput: '',
    queryResult: null,
    queryLoading: false,
    queryError: null,
}

export const useDBStore = create<DBState>((set, get) => ({
    ...initialState,

    loadDatabases: async (deviceId: string) => {
        // 刷新时清除当前选择和缓存数据
        set({
            dbLoading: true,
            dbError: null,
            selectedDb: null,
            selectedTable: null,
            tables: [],
            schema: [],
            tableData: null,
        })
        try {
            const response = await api.listDatabases(deviceId)
            set({ databases: response.databases, dbLoading: false })
        } catch (error) {
            let errorMessage = 'Failed to load databases'
            if (error instanceof Error) {
                // 针对常见错误提供友好提示
                if (error.message.includes('504') || error.message.includes('timeout')) {
                    errorMessage = '设备连接超时，请确保设备已连接且 DebugProbe SDK 已启用数据库功能'
                } else {
                    errorMessage = error.message
                }
            }
            set({
                dbError: errorMessage,
                dbLoading: false,
            })
        }
    },

    loadTables: async (deviceId: string, dbId: string) => {
        set({ tablesLoading: true, tables: [] })
        try {
            const response = await api.listTables(deviceId, dbId)
            set({ tables: response.tables, tablesLoading: false })
        } catch (error) {
            console.error('Failed to load tables:', error)
            set({ tablesLoading: false })
        }
    },

    loadSchema: async (deviceId: string, dbId: string, table: string) => {
        try {
            const response = await api.describeTable(deviceId, dbId, table)
            set({ schema: response.columns })
        } catch (error) {
            console.error('Failed to load schema:', error)
            set({ schema: [] })
        }
    },

    loadTableData: async (deviceId: string, dbId: string, table: string) => {
        const { page, pageSize, orderBy, ascending, tables } = get()
        set({ dataLoading: true, dataError: null })
        try {
            const result = await api.fetchTablePage(deviceId, dbId, table, {
                page,
                pageSize,
                orderBy: orderBy ?? undefined,
                ascending,
            })
            // 同时更新 tables 列表中对应表的 rowCount
            const updatedTables = tables.map(t =>
                t.name === table && result.totalRows !== null
                    ? { ...t, rowCount: result.totalRows }
                    : t
            )
            set({ tableData: result, dataLoading: false, tables: updatedTables })
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to load table data'
            console.error('Failed to load table data:', error)
            set({ tableData: null, dataLoading: false, dataError: errorMsg })
        }
    },

    selectDb: (dbId: string | null) => {
        const current = get().selectedDb
        if (current !== dbId) {
            set({
                selectedDb: dbId,
                selectedTable: null,
                tables: [],
                schema: [],
                tableData: null,
                page: 1,
                orderBy: null,
            })
        }
    },

    selectTable: (table: string | null) => {
        const current = get().selectedTable
        if (current !== table) {
            set({
                selectedTable: table,
                schema: [],
                tableData: null,
                page: 1,
                orderBy: null,
            })
        }
    },

    setShowSchema: (show: boolean) => {
        set({ showSchema: show })
    },

    setPage: (page: number) => {
        set({ page })
    },

    setSort: (column: string) => {
        const { orderBy, ascending } = get()
        if (orderBy === column) {
            // 三态循环：升序 → 降序 → 默认
            if (ascending) {
                // 当前是升序，切换到降序
                set({ ascending: false, page: 1 })
            } else {
                // 当前是降序，切换到默认（无排序）
                set({ orderBy: null, ascending: true, page: 1 })
            }
        } else {
            // 点击新列，设置为升序
            set({ orderBy: column, ascending: true, page: 1 })
        }
    },

    // 带自动重载的排序
    setSortAndReload: async (deviceId: string, column: string) => {
        const { orderBy, ascending, selectedDb, selectedTable, pageSize } = get()

        let newOrderBy: string | null = column
        let newAscending = true

        if (orderBy === column) {
            // 三态循环：升序 → 降序 → 默认
            if (ascending) {
                // 当前是升序，切换到降序
                newAscending = false
            } else {
                // 当前是降序，切换到默认（无排序）
                newOrderBy = null
                newAscending = true
            }
        }

        set({
            orderBy: newOrderBy,
            ascending: newAscending,
            page: 1,
            dataLoading: true
        })

        if (selectedDb && selectedTable) {
            try {
                const result = await api.fetchTablePage(deviceId, selectedDb, selectedTable, {
                    page: 1,
                    pageSize: pageSize,
                    orderBy: newOrderBy ?? undefined,
                    ascending: newAscending,
                })
                set({ tableData: result, dataLoading: false })
            } catch (error) {
                console.error('Failed to load table data:', error)
                set({ dataLoading: false })
            }
        }
    },

    // 带自动重载的分页
    setPageAndReload: async (deviceId: string, newPage: number) => {
        const { selectedDb, selectedTable, pageSize, orderBy, ascending } = get()
        set({ page: newPage, dataLoading: true })

        if (selectedDb && selectedTable) {
            try {
                const result = await api.fetchTablePage(deviceId, selectedDb, selectedTable, {
                    page: newPage,
                    pageSize,
                    orderBy: orderBy ?? undefined,
                    ascending,
                })
                set({ tableData: result, dataLoading: false })
            } catch (error) {
                console.error('Failed to load table data:', error)
                set({ dataLoading: false })
            }
        }
    },

    // SQL 查询 Actions
    setQueryMode: (mode: boolean) => {
        set({ queryMode: mode, queryError: null })
        if (!mode) {
            // 退出查询模式时清除结果
            set({ queryResult: null })
        }
    },

    setQueryInput: (input: string) => {
        set({ queryInput: input })
    },

    executeQuery: async (deviceId: string) => {
        const { selectedDb, queryInput } = get()
        if (!selectedDb || !queryInput.trim()) {
            set({ queryError: '请选择数据库并输入 SQL 查询语句' })
            return
        }

        set({ queryLoading: true, queryError: null, queryResult: null })
        try {
            const result = await api.executeQuery(deviceId, selectedDb, queryInput)
            set({ queryResult: result, queryLoading: false })
        } catch (error) {
            set({
                queryError: error instanceof Error ? error.message : 'Query execution failed',
                queryLoading: false,
            })
        }
    },

    clearQueryResult: () => {
        set({ queryResult: null, queryError: null })
    },

    // 数据库排序 Actions
    setDbSortOrder: (order: DBSortOrder) => {
        set({ dbSortOrder: order })
    },

    toggleDbSortDirection: () => {
        set((state) => ({ dbSortAscending: !state.dbSortAscending }))
    },

    // 获取排序后的数据库列表
    getSortedDatabases: () => {
        const { databases, dbSortOrder, dbSortAscending } = get()
        const sorted = [...databases].sort((a, b) => {
            let comparison = 0
            switch (dbSortOrder) {
                case 'name':
                    comparison = a.descriptor.name.localeCompare(b.descriptor.name)
                    break
                case 'size':
                    comparison = (a.fileSizeBytes ?? 0) - (b.fileSizeBytes ?? 0)
                    break
                case 'tableCount':
                    comparison = (a.tableCount ?? 0) - (b.tableCount ?? 0)
                    break
            }
            return dbSortAscending ? comparison : -comparison
        })
        return sorted
    },

    reset: () => {
        set(initialState)
    },
}))
