import { useState, useMemo } from 'react'
import type { BreakpointHit, BreakpointAction, BreakpointRequestSnapshot, BreakpointResponseSnapshot } from '@/types'
import clsx from 'clsx'

interface BreakpointHitPanelProps {
    hits: BreakpointHit[]
    onResume: (requestId: string, action: BreakpointAction) => void
    loading?: boolean
}

export function BreakpointHitPanel({ hits, onResume, loading }: BreakpointHitPanelProps) {
    const [selectedHitId, setSelectedHitId] = useState<string | null>(null)

    const selectedHit = useMemo(() => {
        return hits.find(h => h.requestId === selectedHitId) || hits[0] || null
    }, [hits, selectedHitId])

    if (hits.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-text-muted">
                <span className="text-4xl mb-3 opacity-50">✅</span>
                <p className="text-sm">暂无等待处理的断点</p>
                <p className="text-xs mt-1">当请求命中断点规则时会在这里显示</p>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header with badge */}
            <div className="px-4 py-3 border-b border-border bg-orange-500/10 flex items-center gap-3">
                <span className="text-xl animate-pulse">⏸️</span>
                <div className="flex-1">
                    <h3 className="font-medium text-orange-400">
                        {hits.length} 个断点等待处理
                    </h3>
                    <p className="text-xs text-text-muted">请求已被拦截，等待您的操作</p>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Hit List */}
                <div className="w-1/3 border-r border-border overflow-auto">
                    {hits.map((hit) => (
                        <div
                            key={hit.requestId}
                            onClick={() => setSelectedHitId(hit.requestId)}
                            className={clsx(
                                'p-3 border-b border-border cursor-pointer transition-colors',
                                selectedHit?.requestId === hit.requestId
                                    ? 'bg-primary/10 border-l-2 border-l-primary'
                                    : 'hover:bg-bg-light'
                            )}
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <span className={clsx(
                                    'px-1.5 py-0.5 text-xs rounded font-medium',
                                    hit.phase === 'request' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'
                                )}>
                                    {hit.phase === 'request' ? '请求' : '响应'}
                                </span>
                                <span className="text-xs font-mono text-text-secondary">
                                    {hit.request.method}
                                </span>
                            </div>
                            <div className="text-xs text-text-muted truncate font-mono">
                                {new URL(hit.request.url).pathname}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Hit Detail */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {selectedHit && (
                        <BreakpointHitDetail
                            hit={selectedHit}
                            onResume={onResume}
                            loading={loading}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}

interface BreakpointHitDetailProps {
    hit: BreakpointHit
    onResume: (requestId: string, action: BreakpointAction) => void
    loading?: boolean
}

function BreakpointHitDetail({ hit, onResume, loading }: BreakpointHitDetailProps) {
    const [editMode, setEditMode] = useState(false)
    const [editedRequest, setEditedRequest] = useState<BreakpointRequestSnapshot>(hit.request)
    const [editedResponse, setEditedResponse] = useState<BreakpointResponseSnapshot | null>(hit.response)
    const [activeTab, setActiveTab] = useState<'request' | 'response'>('request')

    // 当 hit 改变时重置编辑状态
    useState(() => {
        setEditedRequest(hit.request)
        setEditedResponse(hit.response)
        setEditMode(false)
    })

    const handleResume = () => {
        onResume(hit.requestId, { type: 'resume' })
    }

    const handleAbort = () => {
        onResume(hit.requestId, { type: 'abort' })
    }

    const handleModify = () => {
        const modification: BreakpointAction = {
            type: 'modify',
            modification: {
                request: hit.phase === 'request' ? editedRequest : undefined,
                response: hit.phase === 'response' ? editedResponse ?? undefined : undefined,
            }
        }
        onResume(hit.requestId, modification)
    }

    const handleMockResponse = () => {
        if (!editedResponse) return
        onResume(hit.requestId, {
            type: 'mockResponse',
            mockResponse: editedResponse
        })
    }

    // 编码 body 为 base64
    const encodeBody = (text: string): string => {
        try {
            return btoa(text)
        } catch {
            return text
        }
    }

    return (
        <div className="flex flex-col h-full">
            {/* URL and Method */}
            <div className="p-4 border-b border-border bg-bg-dark/50">
                <div className="flex items-center gap-2 mb-2">
                    <span className={clsx(
                        'px-2 py-1 text-xs rounded font-bold',
                        {
                            'bg-green-500/20 text-green-400': hit.request.method === 'GET',
                            'bg-blue-500/20 text-blue-400': hit.request.method === 'POST',
                            'bg-yellow-500/20 text-yellow-400': hit.request.method === 'PUT',
                            'bg-red-500/20 text-red-400': hit.request.method === 'DELETE',
                            'bg-purple-500/20 text-purple-400': hit.request.method === 'PATCH',
                        }
                    )}>
                        {hit.request.method}
                    </span>
                    <span className={clsx(
                        'px-2 py-0.5 text-xs rounded',
                        hit.phase === 'request' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'
                    )}>
                        {hit.phase === 'request' ? '请求阶段' : '响应阶段'}
                    </span>
                </div>
                <code className="text-sm text-text-primary break-all">{hit.request.url}</code>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
                <button
                    onClick={() => setActiveTab('request')}
                    className={clsx(
                        'px-4 py-2 text-sm font-medium transition-colors',
                        activeTab === 'request'
                            ? 'text-primary border-b-2 border-primary'
                            : 'text-text-muted hover:text-text-primary'
                    )}
                >
                    请求
                </button>
                {(hit.phase === 'response' || editMode) && (
                    <button
                        onClick={() => setActiveTab('response')}
                        className={clsx(
                            'px-4 py-2 text-sm font-medium transition-colors',
                            activeTab === 'response'
                                ? 'text-primary border-b-2 border-primary'
                                : 'text-text-muted hover:text-text-primary'
                        )}
                    >
                        响应
                    </button>
                )}
                <div className="flex-1" />
                <button
                    onClick={() => setEditMode(!editMode)}
                    className={clsx(
                        'px-4 py-2 text-sm transition-colors',
                        editMode ? 'text-primary' : 'text-text-muted hover:text-text-primary'
                    )}
                >
                    {editMode ? '✏️ 编辑中' : '✏️ 编辑'}
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4">
                {activeTab === 'request' ? (
                    <RequestEditor
                        request={editedRequest}
                        onChange={setEditedRequest}
                        editable={editMode && hit.phase === 'request'}
                    />
                ) : (
                    <ResponseEditor
                        response={editedResponse}
                        onChange={setEditedResponse}
                        editable={editMode}
                        showCreateButton={!editedResponse && editMode}
                        onCreateResponse={() => setEditedResponse({
                            statusCode: 200,
                            headers: { 'Content-Type': 'application/json' },
                            body: encodeBody('{}')
                        })}
                    />
                )}
            </div>

            {/* Action Buttons */}
            <div className="p-4 border-t border-border bg-bg-dark/50 flex items-center gap-3">
                <button
                    onClick={handleResume}
                    disabled={loading}
                    className="btn btn-primary flex-1"
                >
                    ▶️ 继续
                </button>

                {editMode && (
                    <button
                        onClick={handleModify}
                        disabled={loading}
                        className="btn bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 flex-1"
                    >
                        ✏️ 修改后继续
                    </button>
                )}

                {hit.phase === 'request' && editMode && editedResponse && (
                    <button
                        onClick={handleMockResponse}
                        disabled={loading}
                        className="btn bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 flex-1"
                    >
                        🎭 返回 Mock 响应
                    </button>
                )}

                <button
                    onClick={handleAbort}
                    disabled={loading}
                    className="btn btn-danger"
                >
                    ⛔ 中止
                </button>
            </div>
        </div>
    )
}

interface RequestEditorProps {
    request: BreakpointRequestSnapshot
    onChange: (request: BreakpointRequestSnapshot) => void
    editable: boolean
}

function RequestEditor({ request, onChange, editable }: RequestEditorProps) {
    const decodedBody = useMemo(() => {
        if (!request.body) return ''
        try {
            return atob(request.body)
        } catch {
            return request.body
        }
    }, [request.body])

    const formatJson = (str: string): string => {
        try {
            return JSON.stringify(JSON.parse(str), null, 2)
        } catch {
            return str
        }
    }

    return (
        <div className="space-y-4">
            {/* Headers */}
            <div>
                <h4 className="text-sm font-medium text-text-secondary mb-2">Headers</h4>
                <div className="bg-bg-dark rounded-lg border border-border overflow-hidden">
                    {Object.entries(request.headers).map(([key, value]) => (
                        <div key={key} className="flex border-b border-border last:border-b-0">
                            <div className="w-1/3 px-3 py-2 text-xs font-mono text-text-muted bg-bg-medium/50 border-r border-border">
                                {key}
                            </div>
                            <div className="flex-1 px-3 py-2 text-xs font-mono text-text-primary break-all">
                                {editable ? (
                                    <input
                                        type="text"
                                        value={value}
                                        onChange={(e) => onChange({
                                            ...request,
                                            headers: { ...request.headers, [key]: e.target.value }
                                        })}
                                        className="w-full bg-transparent border-none outline-none"
                                    />
                                ) : (
                                    value
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Body */}
            {request.body && (
                <div>
                    <h4 className="text-sm font-medium text-text-secondary mb-2">Body</h4>
                    {editable ? (
                        <textarea
                            value={decodedBody}
                            onChange={(e) => onChange({
                                ...request,
                                body: btoa(e.target.value)
                            })}
                            className="w-full h-64 bg-bg-dark border border-border rounded-lg p-3 font-mono text-xs text-text-primary resize-none"
                            spellCheck={false}
                        />
                    ) : (
                        <pre className="bg-bg-dark border border-border rounded-lg p-3 font-mono text-xs text-text-primary overflow-auto max-h-64">
                            {formatJson(decodedBody)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    )
}

interface ResponseEditorProps {
    response: BreakpointResponseSnapshot | null
    onChange: (response: BreakpointResponseSnapshot | null) => void
    editable: boolean
    showCreateButton?: boolean
    onCreateResponse?: () => void
}

function ResponseEditor({ response, onChange, editable, showCreateButton, onCreateResponse }: ResponseEditorProps) {
    if (!response) {
        if (showCreateButton && onCreateResponse) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-text-muted">
                    <p className="text-sm mb-3">尚无响应数据</p>
                    <button
                        onClick={onCreateResponse}
                        className="btn btn-primary"
                    >
                        创建 Mock 响应
                    </button>
                </div>
            )
        }
        return (
            <div className="flex items-center justify-center h-full text-text-muted">
                <p className="text-sm">请求阶段断点，暂无响应数据</p>
            </div>
        )
    }

    const decodedBody = useMemo(() => {
        if (!response.body) return ''
        try {
            return atob(response.body)
        } catch {
            return response.body
        }
    }, [response.body])

    const formatJson = (str: string): string => {
        try {
            return JSON.stringify(JSON.parse(str), null, 2)
        } catch {
            return str
        }
    }

    return (
        <div className="space-y-4">
            {/* Status Code */}
            <div>
                <h4 className="text-sm font-medium text-text-secondary mb-2">Status Code</h4>
                {editable ? (
                    <input
                        type="number"
                        value={response.statusCode}
                        onChange={(e) => onChange({ ...response, statusCode: parseInt(e.target.value) || 200 })}
                        className="input w-32"
                    />
                ) : (
                    <span className={clsx(
                        'px-2 py-1 rounded text-sm font-medium',
                        response.statusCode >= 200 && response.statusCode < 300
                            ? 'bg-green-500/20 text-green-400'
                            : response.statusCode >= 400
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-yellow-500/20 text-yellow-400'
                    )}>
                        {response.statusCode}
                    </span>
                )}
            </div>

            {/* Headers */}
            <div>
                <h4 className="text-sm font-medium text-text-secondary mb-2">Headers</h4>
                <div className="bg-bg-dark rounded-lg border border-border overflow-hidden">
                    {Object.entries(response.headers).map(([key, value]) => (
                        <div key={key} className="flex border-b border-border last:border-b-0">
                            <div className="w-1/3 px-3 py-2 text-xs font-mono text-text-muted bg-bg-medium/50 border-r border-border">
                                {key}
                            </div>
                            <div className="flex-1 px-3 py-2 text-xs font-mono text-text-primary break-all">
                                {editable ? (
                                    <input
                                        type="text"
                                        value={value}
                                        onChange={(e) => onChange({
                                            ...response,
                                            headers: { ...response.headers, [key]: e.target.value }
                                        })}
                                        className="w-full bg-transparent border-none outline-none"
                                    />
                                ) : (
                                    value
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Body */}
            <div>
                <h4 className="text-sm font-medium text-text-secondary mb-2">Body</h4>
                {editable ? (
                    <textarea
                        value={decodedBody}
                        onChange={(e) => onChange({
                            ...response,
                            body: btoa(e.target.value)
                        })}
                        className="w-full h-64 bg-bg-dark border border-border rounded-lg p-3 font-mono text-xs text-text-primary resize-none"
                        spellCheck={false}
                    />
                ) : (
                    <pre className="bg-bg-dark border border-border rounded-lg p-3 font-mono text-xs text-text-primary overflow-auto max-h-64">
                        {formatJson(decodedBody) || '(empty)'}
                    </pre>
                )}
            </div>
        </div>
    )
}
