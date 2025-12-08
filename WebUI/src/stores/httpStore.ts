import { create } from 'zustand'
import type { HTTPEventSummary, HTTPEventDetail } from '@/types'
import * as api from '@/services/api'
import { useRuleStore } from './ruleStore'
import { useFavoriteUrlStore } from './favoriteUrlStore'

// 分组模式
export type GroupMode = 'none' | 'domain' | 'path'

// 会话分隔符类型
export interface SessionDivider {
  type: 'session-divider'
  sessionId: string
  timestamp: string
  isConnected: boolean
}

// 列表项类型（请求或分隔符）
export type ListItem = HTTPEventSummary | SessionDivider

export function isSessionDivider(item: ListItem): item is SessionDivider {
  return (item as SessionDivider).type === 'session-divider'
}

interface HTTPState {
  events: HTTPEventSummary[]
  listItems: ListItem[] // 包含会话分隔符的列表
  filteredItems: ListItem[] // 过滤后的列表
  selectedEventId: string | null
  selectedEvent: HTTPEventDetail | null
  total: number
  page: number
  pageSize: number
  isLoading: boolean
  autoScroll: boolean
  currentSessionId: string | null
  currentDeviceId: string | null // 当前设备 ID，用于收藏过滤

  // 分组模式
  groupMode: GroupMode

  // 批量选择
  selectedIds: Set<string>
  isSelectMode: boolean

  // Filters
  filters: {
    method: string
    statusRange: string
    urlContains: string
    mockedOnly: boolean
    favoritesOnly: boolean
    domains: string[] // 支持多选域名，空数组表示"全部"
    showBlacklisted: boolean
  }

  // Actions
  fetchEvents: (deviceId: string) => Promise<void>
  fetchSessionHistory: (deviceId: string) => Promise<void>
  selectEvent: (deviceId: string, eventId: string) => Promise<void>
  clearSelection: () => void
  addRealtimeEvent: (event: HTTPEventSummary) => void
  clearEvents: () => void
  setFilter: (key: string, value: string | boolean | string[]) => void
  toggleDomain: (domain: string) => void  // 切换域名选中状态
  clearDomains: () => void  // 清空域名选择（选择"全部"）
  setAutoScroll: (value: boolean) => void
  setGroupMode: (mode: GroupMode) => void
  applyFilters: () => void

  // 会话管理
  addSessionDivider: (sessionId: string, isConnected: boolean) => void

  // 收藏
  updateEventFavorite: (eventId: string, isFavorite: boolean) => void

  // 批量选择
  toggleSelectMode: () => void
  toggleSelectId: (id: string) => void
  selectAll: () => void
  clearSelectedIds: () => void
  batchDelete: (deviceId: string) => Promise<void>
  batchFavorite: (deviceId: string, isFavorite: boolean) => Promise<number | void>
}

// 过滤逻辑 - 现在只处理 HTTP 事件，不再包含会话分隔符
function filterItems(items: ListItem[], filters: HTTPState['filters'], deviceId?: string): ListItem[] {
  // 获取 URL 级别收藏检查函数
  const isUrlFavorite = useFavoriteUrlStore.getState().isFavorite

  return items.filter((item) => {
    // 跳过会话分隔符（如果有的话，保持向后兼容）
    if (isSessionDivider(item)) {
      return false // 不再在 HTTP 列表中显示会话分隔符
    }

    const event = item as HTTPEventSummary

    // 方法过滤
    if (filters.method && event.method !== filters.method) return false

    // 状态码范围过滤
    if (filters.statusRange && event.statusCode) {
      const [min, max] = filters.statusRange.split('-').map(Number)
      if (event.statusCode < min || event.statusCode > max) return false
    }

    // URL 搜索
    if (filters.urlContains && !event.url.toLowerCase().includes(filters.urlContains.toLowerCase())) {
      return false
    }

    // 仅 Mock
    if (filters.mockedOnly && !event.isMocked) return false

    // 仅收藏 - 使用 URL 级别的收藏状态
    if (filters.favoritesOnly) {
      const isFavorite = deviceId ? isUrlFavorite(deviceId, event.url) : event.isFavorite
      if (!isFavorite) return false
    }

    // 域名过滤（支持多选）
    if (filters.domains && filters.domains.length > 0) {
      try {
        const url = new URL(event.url)
        if (!filters.domains.includes(url.hostname)) return false
      } catch {
        return false
      }
    }

    // 规则引擎过滤 (黑名单/隐藏)
    // 仅当 showBlacklisted 为 false 时执行过滤
    if (!filters.showBlacklisted) {
      // 如果匹配到规则且规则动作为 'hide'，则过滤掉
      const rule = useRuleStore.getState().matchRule(event)
      if (rule && rule.action === 'hide') {
        return false
      }
    }

    return true
  })
}

export const useHTTPStore = create<HTTPState>((set, get) => ({
  events: [],
  listItems: [],
  filteredItems: [],
  selectedEventId: null,
  selectedEvent: null,
  total: 0,
  page: 1,
  pageSize: 100,
  isLoading: false,
  autoScroll: true,
  selectedIds: new Set(),
  isSelectMode: false,
  currentSessionId: null,
  currentDeviceId: null,
  groupMode: 'none' as GroupMode,

  filters: {
    method: '',
    statusRange: '',
    urlContains: '',
    mockedOnly: false,
    favoritesOnly: false,
    domains: [],
    showBlacklisted: false,
  },

  fetchEvents: async (deviceId: string) => {
    const { pageSize, filters } = get()
    set({ isLoading: true, currentDeviceId: deviceId })
    try {
      const response = await api.getHTTPEvents(deviceId, {
        pageSize,
        method: filters.method || undefined,
        urlContains: filters.urlContains || undefined,
        isMocked: filters.mockedOnly ? true : undefined,
      })

      const events = response.items

      const filteredItems = filterItems(events, filters, deviceId)
      set({
        events,
        listItems: events, // 从 API 加载时不包含分隔符
        filteredItems,
        total: response.total,
        page: response.page,
        isLoading: false,
      })

      // 加载完事件后，再加载会话历史来插入分隔符
      get().fetchSessionHistory(deviceId)
    } catch (error) {
      console.error('Failed to fetch HTTP events:', error)
      set({ isLoading: false })
    }
  },

  fetchSessionHistory: async (_deviceId: string) => {
    // 会话历史现在由 SessionActivityStore 管理，不再在 HTTP 列表中显示
    // 保留此函数以保持 API 兼容性
  },

  selectEvent: async (deviceId: string, eventId: string) => {
    // 如果 eventId 为空，清除选中
    if (!eventId) {
      set({ selectedEventId: null, selectedEvent: null })
      return
    }

    set({ selectedEventId: eventId })

    try {
      const detail = await api.getHTTPEventDetail(deviceId, eventId)
      set({ selectedEvent: detail })
    } catch (error) {
      console.error('Failed to fetch HTTP event detail:', error)
    }
  },

  clearSelection: () => {
    set({ selectedEventId: null, selectedEvent: null })
  },

  addRealtimeEvent: (event: HTTPEventSummary) => {
    set((state) => {
      const events = [event, ...state.events].slice(0, 1000)
      const listItems = [event as ListItem, ...state.listItems].slice(0, 1000)
      const filteredItems = filterItems(listItems, state.filters, state.currentDeviceId ?? undefined)
      return { events, listItems, filteredItems, total: state.total + 1 }
    })
  },

  clearEvents: () => {
    set({
      events: [],
      listItems: [],
      filteredItems: [],
      total: 0,
      selectedEventId: null,
      selectedEvent: null,
      selectedIds: new Set(),
      currentSessionId: null,
    })
  },

  addSessionDivider: (_sessionId: string, _isConnected: boolean) => {
    // 会话分隔符现在由 SessionActivityStore 管理
    // 保留此函数以保持 API 兼容性
  },

  setFilter: (key: string, value: string | boolean | string[]) => {
    set((state) => {
      const newFilters = { ...state.filters, [key]: value }
      const filteredItems = filterItems(state.listItems, newFilters, state.currentDeviceId ?? undefined)
      return { filters: newFilters, filteredItems }
    })
  },

  toggleDomain: (domain: string) => {
    set((state) => {
      const currentDomains = state.filters.domains
      const newDomains = currentDomains.includes(domain)
        ? currentDomains.filter((d) => d !== domain)
        : [...currentDomains, domain]
      const newFilters = { ...state.filters, domains: newDomains }
      const filteredItems = filterItems(state.listItems, newFilters, state.currentDeviceId ?? undefined)
      return { filters: newFilters, filteredItems }
    })
  },

  clearDomains: () => {
    set((state) => {
      const newFilters = { ...state.filters, domains: [] }
      const filteredItems = filterItems(state.listItems, newFilters, state.currentDeviceId ?? undefined)
      return { filters: newFilters, filteredItems }
    })
  },

  applyFilters: () => {
    set((state) => ({
      filteredItems: filterItems(state.listItems, state.filters, state.currentDeviceId ?? undefined),
    }))
  },

  setAutoScroll: (value: boolean) => {
    set({ autoScroll: value })
  },

  setGroupMode: (mode: GroupMode) => {
    set({ groupMode: mode })
  },

  updateEventFavorite: (eventId: string, isFavorite: boolean) => {
    set((state) => {
      const events = state.events.map((e) => (e.id === eventId ? { ...e, isFavorite } : e))
      const listItems = state.listItems.map((item) =>
        !isSessionDivider(item) && item.id === eventId ? { ...item, isFavorite } : item
      )
      const filteredItems = filterItems(listItems, state.filters, state.currentDeviceId ?? undefined)
      return {
        events,
        listItems,
        filteredItems,
        selectedEvent:
          state.selectedEvent?.id === eventId
            ? { ...state.selectedEvent, isFavorite }
            : state.selectedEvent,
      }
    })
  },

  // 批量选择
  toggleSelectMode: () => {
    set((state) => ({
      isSelectMode: !state.isSelectMode,
      selectedIds: state.isSelectMode ? new Set() : state.selectedIds,
    }))
  },

  toggleSelectId: (id: string) => {
    set((state) => {
      const newSelectedIds = new Set(state.selectedIds)
      if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id)
      } else {
        newSelectedIds.add(id)
      }
      return { selectedIds: newSelectedIds }
    })
  },

  selectAll: () => {
    set((state) => {
      // 使用过滤后的列表，而不是全部事件
      const filteredEvents = state.filteredItems.filter((item) => !isSessionDivider(item)) as HTTPEventSummary[]
      const filteredIds = new Set(filteredEvents.map((e) => e.id))
      const allSelected = state.selectedIds.size === filteredIds.size &&
        [...state.selectedIds].every(id => filteredIds.has(id))
      return { selectedIds: allSelected ? new Set() : filteredIds }
    })
  },

  clearSelectedIds: () => {
    set({ selectedIds: new Set() })
  },

  batchDelete: async (deviceId: string) => {
    const { selectedIds, events } = get()
    if (selectedIds.size === 0) return

    try {
      await api.batchDeleteHTTPEvents(deviceId, Array.from(selectedIds))
      set({
        events: events.filter((e) => !selectedIds.has(e.id)),
        selectedIds: new Set(),
        total: get().total - selectedIds.size,
      })
    } catch (error) {
      console.error('Failed to batch delete:', error)
    }
  },

  batchFavorite: async (deviceId: string, isFavorite: boolean) => {
    const { selectedIds, events, listItems, filters, currentDeviceId } = get()
    if (selectedIds.size === 0) return

    try {
      // 使用 URL 级别的收藏，批量更新
      const { addFavorite, removeFavorite } = useFavoriteUrlStore.getState()

      // 获取选中事件的 URL 列表
      const selectedEvents = events.filter(e => selectedIds.has(e.id))
      for (const event of selectedEvents) {
        if (isFavorite) {
          addFavorite(deviceId, event.url)
        } else {
          removeFavorite(deviceId, event.url)
        }
      }

      // 重新过滤
      const filteredItems = filterItems(listItems, filters, currentDeviceId ?? undefined)
      set({ filteredItems })

      // 返回成功数量供调用方使用
      return selectedIds.size
    } catch (error) {
      console.error('Failed to batch favorite:', error)
      throw error
    }
  },
}))
