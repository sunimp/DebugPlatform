import { useEffect, useRef, memo } from 'react'
import type { WSSessionSummary } from '@/types'
import { formatSmartTime, extractDomain, formatDuration } from '@/utils/format'
import clsx from 'clsx'

interface WSSessionListProps {
  sessions: WSSessionSummary[]
  selectedId: string | null
  onSelect: (sessionId: string) => void
  loading?: boolean
  autoScroll?: boolean
  // 批量选择相关
  isSelectMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}

export function WSSessionList({
  sessions,
  selectedId,
  onSelect,
  loading,
  autoScroll,
  isSelectMode = false,
  selectedIds = new Set(),
  onToggleSelect,
}: WSSessionListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevFirstIdRef = useRef<string | null>(null)

  // 自动滚动逻辑：新会话到达时滚动到顶部
  useEffect(() => {
    if (!autoScroll || sessions.length === 0) return

    const firstId = sessions[0]?.id
    if (firstId && firstId !== prevFirstIdRef.current && containerRef.current) {
      containerRef.current.scrollTop = 0
    }
    prevFirstIdRef.current = firstId
  }, [sessions, autoScroll])

  if (sessions.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted py-12">
        <span className="text-4xl mb-3 opacity-50">🔌</span>
        <p className="text-sm">暂无 WebSocket 会话</p>
        <p className="text-xs mt-1 text-text-muted">当设备建立 WebSocket 连接时会显示在这里</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="overflow-auto h-full">
      {/* 会话列表 */}
      <div className="divide-y divide-border/50">
        {sessions.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            isSelected={selectedId === session.id}
            isChecked={selectedIds.has(session.id)}
            isSelectMode={isSelectMode}
            onSelect={onSelect}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>

      {/* 加载指示器 */}
      {loading && (
        <div className="flex justify-center py-4">
          <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}
    </div>
  )
}

// 使用 memo 优化会话项渲染
const SessionItem = memo(function SessionItem({
  session,
  isSelected,
  isChecked,
  isSelectMode,
  onSelect,
  onToggleSelect,
}: {
  session: WSSessionSummary
  isSelected: boolean
  isChecked: boolean
  isSelectMode: boolean
  onSelect: (sessionId: string) => void
  onToggleSelect?: (id: string) => void
}) {
  const duration = session.disconnectTime
    ? formatDuration(new Date(session.connectTime), new Date(session.disconnectTime))
    : null

  const handleClick = () => {
    if (isSelectMode && onToggleSelect) {
      onToggleSelect(session.id)
    } else {
      onSelect(session.id)
    }
  }

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'px-4 py-3 cursor-pointer transition-all',
        'hover:bg-bg-light/50',
        isSelected && !isSelectMode
          ? 'bg-primary text-white shadow-sm shadow-primary/20'
          : '',
        !isSelected && 'border-l-2 border-l-transparent',
        isSelectMode && isChecked && 'bg-primary/15'
      )}
    >
      {/* 第一行：选择框/状态、域名、时间 */}
      <div className="flex items-center gap-2 mb-1">
        {isSelectMode ? (
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggleSelect?.(session.id)}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-border bg-bg-light text-primary focus:ring-primary/50 cursor-pointer"
          />
        ) : (
          <StatusIndicator isOpen={session.isOpen} isSelectedRow={isSelected && !isSelectMode} />
        )}
        <span className={clsx(
          'font-mono text-sm truncate flex-1',
          isSelected && !isSelectMode ? 'text-inherit' : 'text-text-primary'
        )}>
          {extractDomain(session.url)}
        </span>
        <span className={clsx(
          'text-xs',
          isSelected && !isSelectMode ? 'text-white/70' : 'text-text-muted'
        )}>
          {formatSmartTime(session.connectTime)}
        </span>
      </div>

      {/* 第二行：完整 URL */}
      <div className={clsx(
        'text-xs truncate font-mono ml-5',
        isSelected && !isSelectMode ? 'text-white/70' : 'text-text-muted'
      )}>
        {session.url}
      </div>

      {/* 第三行：状态信息 */}
      <div className="flex items-center gap-3 mt-1.5 ml-5">
        {session.isOpen ? (
          <span className={clsx(
            'inline-flex items-center gap-1 text-xs',
            isSelected && !isSelectMode ? 'text-green-200' : 'text-green-400'
          )}>
            <span className={clsx(
              'w-1.5 h-1.5 rounded-full animate-pulse',
              isSelected && !isSelectMode ? 'bg-green-200' : 'bg-green-400'
            )} />
            连接中
          </span>
        ) : (
          <>
            <span className={clsx(
              'text-xs',
              isSelected && !isSelectMode ? 'text-white/70' : 'text-text-muted'
            )}>
              已关闭{session.closeCode ? ` (${session.closeCode})` : ''}
            </span>
            {duration && (
              <span className={clsx(
                'text-xs',
                isSelected && !isSelectMode ? 'text-white/70' : 'text-text-muted'
              )}>
                持续 {duration}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
})

function StatusIndicator({ isOpen, isSelectedRow }: { isOpen: boolean; isSelectedRow?: boolean }) {
  return (
    <span
      className={clsx(
        'w-3 h-3 rounded-full flex-shrink-0',
        isOpen
          ? isSelectedRow
            ? 'bg-green-300 shadow-green-300/50 shadow-sm'
            : 'bg-green-500 shadow-green-500/50 shadow-sm'
          : isSelectedRow
            ? 'bg-gray-300'
            : 'bg-gray-500'
      )}
    />
  )
}
