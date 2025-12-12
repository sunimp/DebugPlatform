// VirtualLogList.tsx
// 使用虚拟滚动优化的日志事件列表（支持动态行高）
//
// Created by Sun on 2025/12/06.
// Copyright © 2025 Sun. All rights reserved.
//

import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { LogEvent, LogLevel } from '@/types'
import { formatSmartTime, getLogLevelClass } from '@/utils/format'
import clsx from 'clsx'
import { LogIcon } from './icons'
import { Checkbox } from './Checkbox'
import { LoadMoreButton } from './LoadMoreButton'

// 最小行高度（像素）
const MIN_ROW_HEIGHT = 44

// 滚动控制回调接口
export interface LogScrollControls {
  scrollToTop: () => void
  scrollToBottom: () => void
  isAtTop: boolean
  isAtBottom: boolean
}

interface Props {
  events: LogEvent[]
  autoScroll: boolean
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  isSelectMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  // 加载更多
  onLoadMore?: () => void
  hasMore?: boolean
  isLoading?: boolean
  loadedCount?: number
  totalCount?: number
  /** 滚动控制回调，用于暴露滚动功能给父组件 */
  onScrollControlsReady?: (controls: LogScrollControls) => void
}

const levelLabels: Record<LogLevel, string> = {
  verbose: 'VERBOSE',
  debug: 'DEBUG',
  info: 'INFO',
  warning: 'WARN',
  error: 'ERROR',
}

export function VirtualLogList({
  events,
  autoScroll,
  selectedId,
  onSelect,
  isSelectMode = false,
  selectedIds = new Set(),
  onToggleSelect,
  onLoadMore,
  hasMore = false,
  isLoading = false,
  loadedCount = 0,
  totalCount = 0,
  onScrollControlsReady,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const lastFirstItemRef = useRef<string | null>(null)
  const [isAtTop, setIsAtTop] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(false)

  // 生成稳定的 key
  const virtualizerKey = useMemo(() => {
    const firstId = events[0]?.id || 'empty'
    return `${firstId}-${events.length}`
  }, [events])

  // 虚拟滚动器 - 使用动态大小
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => MIN_ROW_HEIGHT, // 预估大小
    overscan: 5,
    getItemKey: useCallback((index: number) => events[index]?.id ?? `item-${index}`, [events]),
  })

  const virtualItems = virtualizer.getVirtualItems()

  // 滚动位置监听
  useEffect(() => {
    const scrollElement = parentRef.current
    if (!scrollElement) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement
      const atTop = scrollTop <= 10
      const atBottom = scrollTop + clientHeight >= scrollHeight - 10
      setIsAtTop(atTop)
      setIsAtBottom(atBottom)
    }

    // 初始状态
    handleScroll()

    scrollElement.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollElement.removeEventListener('scroll', handleScroll)
  }, [])

  // 滚动控制函数
  const scrollToTop = useCallback(() => {
    virtualizer.scrollToIndex(0, { align: 'start', behavior: 'smooth' })
  }, [virtualizer])

  const scrollToBottom = useCallback(() => {
    if (events.length > 0) {
      virtualizer.scrollToIndex(events.length - 1, { align: 'end', behavior: 'smooth' })
    }
  }, [virtualizer, events.length])

  // 暴露滚动控制给父组件
  useEffect(() => {
    if (onScrollControlsReady) {
      onScrollControlsReady({
        scrollToTop,
        scrollToBottom,
        isAtTop,
        isAtBottom,
      })
    }
  }, [onScrollControlsReady, scrollToTop, scrollToBottom, isAtTop, isAtBottom])

  // 当数据变化时强制重新计算
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizerKey, virtualizer])

  // 当有新事件添加到列表头部时自动滚动到顶部
  useEffect(() => {
    const firstEvent = events[0]
    const firstId = firstEvent?.id ?? null
    const hasNewItem = firstId !== null && firstId !== lastFirstItemRef.current

    if (autoScroll && hasNewItem) {
      virtualizer.scrollToIndex(0, { align: 'start', behavior: 'smooth' })
    }

    lastFirstItemRef.current = firstId
  }, [events, autoScroll, virtualizer])

  // 渲染行内容
  const renderRowContent = useCallback((event: LogEvent, index: number) => {
    const levelStyle = getLogLevelClass(event.level)
    const isChecked = selectedIds.has(event.id)
    const isSelected = !isSelectMode && selectedId === event.id
    // 使用后端返回的序号，保证删除数据后原有序号不变
    const rowNumber = event.seqNum

    const handleClick = () => {
      if (isSelectMode) {
        onToggleSelect?.(event.id)
      } else {
        onSelect?.(event.id)
      }
    }

    return (
      <div
        onClick={handleClick}
        className={clsx(
          'flex border-b border-border transition-all duration-150 cursor-pointer py-2 min-h-[44px]',
          // 选中状态（非批量选择模式）
          isSelected && 'bg-selected',
          // 批量选中
          !isSelected && isChecked && 'bg-primary/15',
          // 默认状态
          !isSelected && !isChecked && (index % 2 === 0 ? 'bg-bg-dark/20' : 'bg-transparent'),
          !isSelected && !isChecked && 'hover:bg-bg-light/60'
        )}
      >
        {/* Level indicator bar */}
        <div className={clsx('w-1 self-stretch flex-shrink-0', levelStyle.bg)} />

        {/* 序号列 */}
        <div className={clsx(
          'w-12 px-2 whitespace-nowrap flex-shrink-0 text-xs font-mono text-center pt-0.5',
          isSelected ? 'text-white/80' : 'text-text-muted'
        )}>
          {rowNumber}
        </div>

        {/* Checkbox */}
        {isSelectMode && (
          <div className="w-10 px-3 flex-shrink-0 flex items-start pt-0.5" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isChecked}
              onChange={() => onToggleSelect?.(event.id)}
            />
          </div>
        )}

        {/* Time */}
        <div className={clsx(
          'w-28 px-3 whitespace-nowrap flex-shrink-0 text-xs pt-0.5',
          isSelected ? 'text-white' : 'text-text-muted'
        )}>
          {formatSmartTime(event.timestamp)}
        </div>

        {/* Level Badge */}
        <div className="w-20 px-2 flex-shrink-0 pt-0.5">
          <span
            className={clsx(
              'inline-flex items-center justify-center px-2 py-0.5 rounded text-2xs font-bold',
              levelStyle.bg,
              levelStyle.color
            )}
          >
            {levelLabels[event.level]}
          </span>
        </div>

        {/* Category */}
        <div className={clsx(
          'w-32 px-3 truncate flex-shrink-0 text-xs font-medium pt-0.5',
          isSelected ? 'text-white' : 'text-primary'
        )} title={event.category || event.subsystem || '-'}>
          {event.category || event.subsystem || '-'}
        </div>

        {/* Message - 完整显示，支持换行 */}
        <div className={clsx(
          'flex-1 px-3 text-xs whitespace-pre-wrap break-words',
          isSelected ? 'text-white' : 'text-text-primary'
        )}>
          {event.message}
        </div>
      </div>
    )
  }, [selectedId, isSelectMode, selectedIds, onSelect, onToggleSelect])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Table Header */}
      <div className="flex-shrink-0 bg-bg-medium border-b border-border">
        <div className="flex items-center text-xs font-semibold text-text-secondary uppercase tracking-wider">
          {/* Level indicator placeholder */}
          <div className="w-1 flex-shrink-0" />
          {/* 序号列 */}
          <div className="w-12 px-2 py-2 text-center">#</div>
          {isSelectMode && (
            <div className="w-10 px-3 py-2 flex-shrink-0">
              <span className="sr-only">选择</span>
            </div>
          )}
          <div className="w-28 px-3 py-2">时间</div>
          <div className="w-20 px-2 py-2">级别</div>
          <div className="w-32 px-3 py-2">分类</div>
          <div className="flex-1 px-3 py-2">消息内容</div>
        </div>
      </div>

      {/* Virtual List */}
      <div ref={parentRef} className="flex-1 overflow-auto font-mono text-sm">
        {events.length > 0 ? (
          <div
            key={virtualizerKey}
            style={{
              height: `${virtualizer.getTotalSize() + (onLoadMore ? 60 : 0)}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.map((virtualItem) => {
              const event = events[virtualItem.index]
              const rowKey = `${event.id}-${virtualItem.index}`
              return (
                <div
                  key={rowKey}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {renderRowContent(event, virtualItem.index)}
                </div>
              )
            })}

            {/* 加载更多按钮 - 定位在虚拟列表内容底部 */}
            {onLoadMore && (
              <div
                style={{
                  position: 'absolute',
                  top: `${virtualizer.getTotalSize()}px`,
                  left: 0,
                  width: '100%',
                }}
              >
                <LoadMoreButton
                  onClick={onLoadMore}
                  hasMore={hasMore}
                  isLoading={isLoading}
                  loadedCount={loadedCount}
                  totalCount={totalCount}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted py-20">
            <div className="w-16 h-16 rounded-2xl bg-bg-light/50 flex items-center justify-center mb-4">
              <LogIcon size={32} className="opacity-60" />
            </div>
            <p className="text-sm font-medium text-text-secondary mb-1">暂无日志</p>
            <p className="text-xs text-text-muted">等待日志事件到达...</p>
          </div>
        )}
      </div>
    </div>
  )
}
