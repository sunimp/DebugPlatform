import { create } from 'zustand'
import type { BreakpointHit, BreakpointAction } from '@/types'
import { getPendingBreakpoints, resumeBreakpoint as resumeBreakpointAPI } from '@/services/api'

interface BreakpointStore {
    // State
    pendingHits: BreakpointHit[]
    loading: boolean

    // Actions
    fetchPendingHits: (deviceId: string) => Promise<void>
    addHit: (hit: BreakpointHit) => void
    removeHit: (requestId: string) => void
    resumeBreakpoint: (deviceId: string, requestId: string, action: BreakpointAction) => Promise<void>
    clear: () => void
}

export const useBreakpointStore = create<BreakpointStore>((set, get) => ({
    pendingHits: [],
    loading: false,

    fetchPendingHits: async (deviceId: string) => {
        set({ loading: true })
        try {
            const hits = await getPendingBreakpoints(deviceId)
            set({ pendingHits: hits })
        } catch (error) {
            console.error('Failed to fetch pending breakpoints:', error)
        } finally {
            set({ loading: false })
        }
    },

    addHit: (hit: BreakpointHit) => {
        set((state) => {
            // 避免重复添加
            if (state.pendingHits.some(h => h.requestId === hit.requestId)) {
                return state
            }
            return { pendingHits: [...state.pendingHits, hit] }
        })
    },

    removeHit: (requestId: string) => {
        set((state) => ({
            pendingHits: state.pendingHits.filter(h => h.requestId !== requestId)
        }))
    },

    resumeBreakpoint: async (deviceId: string, requestId: string, action: BreakpointAction) => {
        try {
            await resumeBreakpointAPI(deviceId, requestId, action)
            // 移除已处理的断点
            get().removeHit(requestId)
        } catch (error) {
            console.error('Failed to resume breakpoint:', error)
            throw error
        }
    },

    clear: () => {
        set({ pendingHits: [] })
    },
}))
