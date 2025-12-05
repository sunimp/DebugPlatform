/**
 * protobufStore.ts
 * Protobuf 描述符和列映射配置管理
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProtobufDescriptor, ColumnProtobufConfig } from '@/utils/protobufDescriptor'
import { loadDescriptorFromFile, loadDescriptorFromBase64, decodeBlob } from '@/utils/protobufDescriptor'

interface ProtobufState {
    /** 已加载的描述符（不持久化 Root 对象，仅存储名称和消息类型） */
    descriptorMeta: Array<{
        name: string
        messageTypes: string[]
        uploadedAt: string
        /** Base64 编码的原始文件数据 */
        rawData: string
    }>

    /** 当前活动的描述符（包含解析后的 Root 对象，不持久化） */
    activeDescriptors: Map<string, ProtobufDescriptor>

    /** 列到消息类型的映射配置（持久化） */
    columnConfigs: ColumnProtobufConfig[]

    /** 是否正在加载 */
    loading: boolean
    error: string | null

    // Actions
    /** 上传并加载描述符文件 */
    uploadDescriptor: (file: File) => Promise<void>

    /** 从存储的数据恢复描述符 */
    restoreDescriptor: (name: string) => Promise<ProtobufDescriptor | null>

    /** 删除描述符 */
    removeDescriptor: (name: string) => void

    /** 添加列配置 */
    addColumnConfig: (config: ColumnProtobufConfig) => void

    /** 删除列配置 */
    removeColumnConfig: (dbId: string, tableName: string, columnName: string) => void

    /** 获取列的配置 */
    getColumnConfig: (dbId: string, tableName: string, columnName: string) => ColumnProtobufConfig | null

    /** 解码 BLOB 数据 */
    decodeBlobData: (
        dbId: string,
        tableName: string,
        columnName: string,
        blobData: string
    ) => Promise<{ success: true; data: Record<string, unknown> } | { success: false; error: string }>

    /** 获取可用的消息类型 */
    getAvailableMessageTypes: () => string[]

    /** 清空所有配置 */
    clearAll: () => void
}

// 将文件转为 Base64
async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            // 移除 data URL 前缀
            const base64 = result.split(',')[1] || result
            resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

export const useProtobufStore = create<ProtobufState>()(
    persist(
        (set, get) => ({
            descriptorMeta: [],
            activeDescriptors: new Map(),
            columnConfigs: [],
            loading: false,
            error: null,

            uploadDescriptor: async (file: File) => {
                set({ loading: true, error: null })

                try {
                    // 解析描述符
                    const descriptor = await loadDescriptorFromFile(file)

                    // 存储原始数据用于恢复
                    const rawData = await fileToBase64(file)

                    // 检查是否已存在同名描述符
                    const existing = get().descriptorMeta.findIndex(d => d.name === descriptor.name)

                    set(state => {
                        const newMeta = [...state.descriptorMeta]
                        const meta = {
                            name: descriptor.name,
                            messageTypes: descriptor.messageTypes,
                            uploadedAt: descriptor.uploadedAt.toISOString(),
                            rawData,
                        }

                        if (existing >= 0) {
                            newMeta[existing] = meta
                        } else {
                            newMeta.push(meta)
                        }

                        // 更新活动描述符
                        const newActive = new Map(state.activeDescriptors)
                        newActive.set(descriptor.name, descriptor)

                        return {
                            descriptorMeta: newMeta,
                            activeDescriptors: newActive,
                            loading: false,
                        }
                    })
                } catch (error) {
                    set({
                        error: error instanceof Error ? error.message : String(error),
                        loading: false,
                    })
                }
            },

            restoreDescriptor: async (name: string) => {
                const { activeDescriptors, descriptorMeta } = get()

                // 检查是否已加载
                if (activeDescriptors.has(name)) {
                    return activeDescriptors.get(name)!
                }

                // 从存储的数据恢复
                const meta = descriptorMeta.find(d => d.name === name)
                if (!meta) {
                    return null
                }

                try {
                    const descriptor = await loadDescriptorFromBase64(meta.rawData, meta.name)

                    set(state => {
                        const newActive = new Map(state.activeDescriptors)
                        newActive.set(name, descriptor)
                        return { activeDescriptors: newActive }
                    })

                    return descriptor
                } catch (error) {
                    console.error('Failed to restore descriptor:', error)
                    return null
                }
            },

            removeDescriptor: (name: string) => {
                set(state => ({
                    descriptorMeta: state.descriptorMeta.filter(d => d.name !== name),
                    activeDescriptors: new Map([...state.activeDescriptors].filter(([k]) => k !== name)),
                    // 同时删除使用该描述符的列配置
                    columnConfigs: state.columnConfigs.filter(c => c.descriptorName !== name),
                }))
            },

            addColumnConfig: (config: ColumnProtobufConfig) => {
                set(state => {
                    // 检查是否已存在相同配置
                    const existingIdx = state.columnConfigs.findIndex(
                        c => c.dbId === config.dbId &&
                            c.tableName === config.tableName &&
                            c.columnName === config.columnName
                    )

                    const newConfigs = [...state.columnConfigs]
                    if (existingIdx >= 0) {
                        newConfigs[existingIdx] = config
                    } else {
                        newConfigs.push(config)
                    }

                    return { columnConfigs: newConfigs }
                })
            },

            removeColumnConfig: (dbId: string, tableName: string, columnName: string) => {
                set(state => ({
                    columnConfigs: state.columnConfigs.filter(
                        c => !(c.dbId === dbId && c.tableName === tableName && c.columnName === columnName)
                    )
                }))
            },

            getColumnConfig: (dbId: string, tableName: string, columnName: string) => {
                return get().columnConfigs.find(
                    c => c.dbId === dbId && c.tableName === tableName && c.columnName === columnName
                ) || null
            },

            decodeBlobData: async (dbId, tableName, columnName, blobData) => {
                const config = get().getColumnConfig(dbId, tableName, columnName)
                if (!config) {
                    return { success: false, error: '未配置 Protobuf 解析' }
                }

                // 确保描述符已加载
                const descriptor = await get().restoreDescriptor(config.descriptorName)
                if (!descriptor) {
                    return { success: false, error: `描述符 "${config.descriptorName}" 未找到` }
                }

                return decodeBlob(descriptor, config.messageType, blobData)
            },

            getAvailableMessageTypes: () => {
                const { descriptorMeta } = get()
                const allTypes: string[] = []
                for (const meta of descriptorMeta) {
                    allTypes.push(...meta.messageTypes)
                }
                return [...new Set(allTypes)].sort()
            },

            clearAll: () => {
                set({
                    descriptorMeta: [],
                    activeDescriptors: new Map(),
                    columnConfigs: [],
                    error: null,
                })
            },
        }),
        {
            name: 'protobuf-store',
            // 只持久化元数据和配置，不持久化 activeDescriptors
            partialize: (state) => ({
                descriptorMeta: state.descriptorMeta,
                columnConfigs: state.columnConfigs,
            }),
        }
    )
)
