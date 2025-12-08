// favoriteUrlStore.ts
// 管理 URL 级别的收藏状态
// 使用 localStorage 持久化，按设备隔离
//
// Created by Sun on 2025/12/15.
// Copyright © 2025 Sun. All rights reserved.
//

import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

interface FavoriteUrlStoreState {
    // 按设备 ID 存储收藏的 URL 数组（用于序列化）
    favoriteUrlsMap: Record<string, string[]>
}

interface FavoriteUrlStoreActions {
    isFavorite: (deviceId: string, url: string) => boolean
    toggleFavorite: (deviceId: string, url: string) => boolean // 返回新状态
    addFavorite: (deviceId: string, url: string) => void
    removeFavorite: (deviceId: string, url: string) => void
    clearFavorites: (deviceId: string) => void
    getFavoriteUrls: (deviceId: string) => string[]
}

type FavoriteUrlStore = FavoriteUrlStoreState & FavoriteUrlStoreActions

// 自定义 storage 实现
const storage: StateStorage = {
    getItem: (name: string): string | null => {
        return localStorage.getItem(name)
    },
    setItem: (name: string, value: string): void => {
        localStorage.setItem(name, value)
    },
    removeItem: (name: string): void => {
        localStorage.removeItem(name)
    },
}

export const useFavoriteUrlStore = create<FavoriteUrlStore>()(
    persist(
        (set, get) => ({
            favoriteUrlsMap: {},

            isFavorite: (deviceId: string, url: string) => {
                const urls = get().favoriteUrlsMap[deviceId]
                if (!urls || !Array.isArray(urls)) return false
                const normalizedUrl = normalizeUrl(url)
                return urls.includes(normalizedUrl)
            },

            toggleFavorite: (deviceId: string, url: string) => {
                const normalizedUrl = normalizeUrl(url)
                const currentUrls = get().favoriteUrlsMap[deviceId] || []

                let newUrls: string[]
                let newState: boolean

                const index = currentUrls.indexOf(normalizedUrl)
                if (index >= 0) {
                    newUrls = [...currentUrls.slice(0, index), ...currentUrls.slice(index + 1)]
                    newState = false
                } else {
                    newUrls = [...currentUrls, normalizedUrl]
                    newState = true
                }

                set((state) => ({
                    favoriteUrlsMap: {
                        ...state.favoriteUrlsMap,
                        [deviceId]: newUrls,
                    },
                }))

                return newState
            },

            addFavorite: (deviceId: string, url: string) => {
                const normalizedUrl = normalizeUrl(url)
                set((state) => {
                    const currentUrls = state.favoriteUrlsMap[deviceId] || []
                    if (currentUrls.includes(normalizedUrl)) {
                        return state // 已存在，不重复添加
                    }
                    return {
                        favoriteUrlsMap: {
                            ...state.favoriteUrlsMap,
                            [deviceId]: [...currentUrls, normalizedUrl],
                        },
                    }
                })
            },

            removeFavorite: (deviceId: string, url: string) => {
                const normalizedUrl = normalizeUrl(url)
                set((state) => {
                    const currentUrls = state.favoriteUrlsMap[deviceId] || []
                    const index = currentUrls.indexOf(normalizedUrl)
                    if (index < 0) return state // 不存在，无需删除
                    return {
                        favoriteUrlsMap: {
                            ...state.favoriteUrlsMap,
                            [deviceId]: [...currentUrls.slice(0, index), ...currentUrls.slice(index + 1)],
                        },
                    }
                })
            },

            clearFavorites: (deviceId: string) => {
                set((state) => ({
                    favoriteUrlsMap: {
                        ...state.favoriteUrlsMap,
                        [deviceId]: [],
                    },
                }))
            },

            getFavoriteUrls: (deviceId: string) => {
                const urls = get().favoriteUrlsMap[deviceId]
                return Array.isArray(urls) ? [...urls] : []
            },
        }),
        {
            name: 'debug-hub-favorite-urls',
            storage: createJSONStorage(() => storage),
        }
    )
)

/**
 * 标准化 URL，去除 query 参数中可能变化的部分
 * 只保留 path 部分用于匹配
 */
function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url)
        // 保留协议、主机、路径，忽略查询参数
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
    } catch {
        // 无法解析的 URL 原样返回
        return url
    }
}
