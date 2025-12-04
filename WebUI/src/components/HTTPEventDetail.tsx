import { useState } from 'react'
import type { HTTPEventDetail as HTTPEventDetailType } from '@/types'
import {
  formatDuration,
  getStatusClass,
  getMethodClass,
  decodeBase64,
} from '@/utils/format'
import { getHTTPEventCurl, replayHTTPEvent, toggleFavorite } from '@/services/api'
import { JSONViewer } from './JSONTree'
import { TimingWaterfall } from './TimingWaterfall'
import { ImagePreview, isImageContentType } from './ImagePreview'
import { ProtobufViewer, isProtobufContentType } from './ProtobufViewer'
import clsx from 'clsx'

interface Props {
  event: HTTPEventDetailType | null
  deviceId: string
  onShowRelatedLogs?: (traceId: string) => void
  onFavoriteChange?: (eventId: string, isFavorite: boolean) => void
}

export function HTTPEventDetail({
  event,
  deviceId,
  onShowRelatedLogs,
  onFavoriteChange,
}: Props) {
  const [activeTab, setActiveTab] = useState<'headers' | 'params' | 'body' | 'timing'>('headers')
  const [curlCommand, setCurlCommand] = useState<string | null>(null)
  const [curlLoading, setCurlLoading] = useState(false)
  const [replayStatus, setReplayStatus] = useState<string | null>(null)
  const [isFavorite, setIsFavorite] = useState(event?.isFavorite ?? false)
  const [favoriteLoading, setFavoriteLoading] = useState(false)

  // 当 event 变化时更新 isFavorite 状态
  if (event && event.isFavorite !== isFavorite && !favoriteLoading) {
    setIsFavorite(event.isFavorite)
  }

  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted">
        <span className="text-4xl mb-3 opacity-50">👈</span>
        <p className="text-sm">选择一个请求查看详情</p>
      </div>
    )
  }

  const requestBody = event.requestBody ? decodeBase64(event.requestBody) : null
  const responseBody = event.responseBody ? decodeBase64(event.responseBody) : null

  // 检查响应内容类型
  const responseContentType = event.responseHeaders?.['Content-Type'] || event.responseHeaders?.['content-type']
  const isImageResponse = isImageContentType(responseContentType)
  const isProtobufResponse = isProtobufContentType(responseContentType)

  // 检查请求内容类型
  const requestContentType = event.requestHeaders?.['Content-Type'] || event.requestHeaders?.['content-type']
  const isProtobufRequest = isProtobufContentType(requestContentType)

  const handleCopyCurl = async () => {
    if (curlCommand) {
      await navigator.clipboard.writeText(curlCommand)
      return
    }

    setCurlLoading(true)
    try {
      const response = await getHTTPEventCurl(deviceId, event.id)
      setCurlCommand(response.curl)
      await navigator.clipboard.writeText(response.curl)
    } catch (error) {
      console.error('Failed to generate cURL:', error)
    } finally {
      setCurlLoading(false)
    }
  }

  const handleReplay = async () => {
    setReplayStatus('sending...')
    try {
      const response = await replayHTTPEvent(deviceId, event.id)
      setReplayStatus(`✓ ${response.status}`)
      setTimeout(() => setReplayStatus(null), 3000)
    } catch {
      setReplayStatus('✗ failed')
      setTimeout(() => setReplayStatus(null), 3000)
    }
  }

  const handleToggleFavorite = async () => {
    setFavoriteLoading(true)
    try {
      const response = await toggleFavorite(deviceId, event.id)
      setIsFavorite(response.isFavorite)
      onFavoriteChange?.(event.id, response.isFavorite)
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
    } finally {
      setFavoriteLoading(false)
    }
  }

  return (
    <div className="h-full overflow-auto">
      {/* Header */}
      <div className="p-4 bg-bg-dark border-b border-border">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm font-medium break-all flex-1">{event.url}</h3>
          <button
            onClick={handleToggleFavorite}
            disabled={favoriteLoading}
            className={clsx(
              'ml-2 p-1.5 rounded transition-colors',
              isFavorite
                ? 'text-yellow-400 hover:text-yellow-300'
                : 'text-text-muted hover:text-yellow-400'
            )}
            title={isFavorite ? '取消收藏' : '收藏'}
          >
            {isFavorite ? (
              <StarFilledIcon className="w-5 h-5" />
            ) : (
              <StarOutlineIcon className="w-5 h-5" />
            )}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs mb-3">
          <span
            className={clsx(
              'px-1.5 py-0.5 rounded font-mono',
              getMethodClass(event.method)
            )}
          >
            {event.method}
          </span>
          <span
            className={clsx(
              'px-1.5 py-0.5 rounded font-mono',
              getStatusClass(event.statusCode)
            )}
          >
            {event.statusCode ?? 'ERR'}
          </span>
          <span className="text-text-muted">{formatDuration(event.duration)}</span>
          {event.isMocked && (
            <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
              🎭 Mocked
            </span>
          )}
          {event.timing?.protocolName && (
            <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary">
              {event.timing.protocolName}
            </span>
          )}
          {event.timing?.connectionReused && (
            <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
              复用连接
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleCopyCurl}
            disabled={curlLoading}
            className="px-3 py-1.5 bg-bg-light border border-border rounded text-xs hover:bg-bg-lighter transition-colors disabled:opacity-50"
          >
            {curlLoading ? '生成中...' : curlCommand ? '✓ 已复制 cURL' : '复制 cURL'}
          </button>
          <button
            onClick={handleReplay}
            disabled={replayStatus !== null}
            className="px-3 py-1.5 bg-primary/20 border border-primary/50 text-primary rounded text-xs hover:bg-primary/30 transition-colors disabled:opacity-50"
          >
            {replayStatus || '🔄 重放请求'}
          </button>
        </div>

        {/* TraceId */}
        {event.traceId && (
          <div className="mt-2 text-xs text-text-muted">
            TraceId: <span className="font-mono text-text-primary">{event.traceId}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-bg-dark">
        <TabButton active={activeTab === 'headers'} onClick={() => setActiveTab('headers')}>
          Headers
        </TabButton>
        <TabButton active={activeTab === 'params'} onClick={() => setActiveTab('params')}>
          Params
        </TabButton>
        <TabButton active={activeTab === 'body'} onClick={() => setActiveTab('body')}>
          Body
        </TabButton>
        {event.timing && (
          <TabButton active={activeTab === 'timing'} onClick={() => setActiveTab('timing')}>
            Timing
          </TabButton>
        )}
      </div>

      {/* Tab Content */}
      <div className="p-4">
        {activeTab === 'headers' && (
          <div className="space-y-6">
            <Section title="请求头">
              <HeadersTable headers={event.requestHeaders} />
            </Section>

            {event.responseHeaders && (
              <Section title="响应头">
                <HeadersTable headers={event.responseHeaders} />
              </Section>
            )}
          </div>
        )}

        {activeTab === 'params' && (
          <div className="space-y-6">
            <Section title="Query Params">
              <HeadersTable headers={event.queryItems || {}} />
            </Section>

            <Section title="Body Params">
              <HeadersTable headers={event.bodyParams || {}} />
              {!event.bodyParams && <div className="text-text-muted text-sm">无解析后的 Body 参数</div>}
            </Section>
          </div>
        )}

        {activeTab === 'body' && (
          <div className="space-y-6">
            {event.requestBody && (
              <Section title="请求体">
                {isProtobufRequest ? (
                  <ProtobufViewer
                    base64Data={event.requestBody}
                    contentType={requestContentType}
                  />
                ) : (
                  <JSONViewer content={requestBody ?? ''} />
                )}
              </Section>
            )}

            {event.responseBody && (
              <Section title="响应体">
                {isImageResponse ? (
                  <ImagePreview
                    base64Data={event.responseBody}
                    contentType={responseContentType ?? null}
                  />
                ) : isProtobufResponse ? (
                  <ProtobufViewer
                    base64Data={event.responseBody}
                    contentType={responseContentType}
                  />
                ) : (
                  <JSONViewer content={responseBody ?? ''} />
                )}
              </Section>
            )}

            {!event.requestBody && !event.responseBody && (
              <div className="text-text-muted text-sm">无请求体或响应体</div>
            )}

            {event.errorDescription && (
              <Section title="错误信息">
                <pre className="text-xs font-mono bg-bg-dark p-3 rounded text-red-400">
                  {event.errorDescription}
                </pre>
              </Section>
            )}
          </div>
        )}

        {activeTab === 'timing' && event.timing && (
          <Section title="性能时间线">
            <TimingWaterfall timing={event.timing} totalDuration={event.duration} />
          </Section>
        )}
      </div>

      {/* Related Logs */}
      {event.traceId && onShowRelatedLogs && (
        <div className="p-4 border-t border-border">
          <button
            onClick={() => onShowRelatedLogs(event.traceId!)}
            className="px-3 py-1.5 bg-bg-light border border-border rounded text-sm hover:bg-bg-lighter transition-colors"
          >
            查看 TraceId 关联日志
          </button>
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-4 py-2 text-xs font-medium transition-colors',
        active ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:text-text-primary'
      )}
    >
      {children}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs uppercase text-text-muted mb-2">{title}</h4>
      {children}
    </div>
  )
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers)

  if (entries.length === 0) {
    return <span className="text-text-muted text-sm">无</span>
  }

  return (
    <table className="w-full text-xs font-mono">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-b border-border/50 last:border-0">
            <td className="py-1.5 pr-4 text-primary align-top whitespace-nowrap">{key}</td>
            <td className="py-1.5 break-all">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Icons
function StarFilledIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  )
}

function StarOutlineIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
      />
    </svg>
  )
}
