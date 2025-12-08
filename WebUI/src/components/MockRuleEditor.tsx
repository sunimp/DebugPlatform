import { useState, useEffect } from 'react'
import type { MockRule, MockTargetType, MockRuleCondition, MockRuleAction } from '@/types'
import { createEmptyRule } from '@/stores/mockStore'

interface MockRuleEditorProps {
  rule: MockRule | null
  isOpen: boolean
  onClose: () => void
  onSave: (rule: Omit<MockRule, 'id' | 'deviceId' | 'createdAt' | 'updatedAt'>) => void
  loading?: boolean
  /** 是否仅显示 HTTP 相关选项，默认 false */
  httpOnly?: boolean
}

const allTargetTypeOptions: { value: MockTargetType; label: string; description: string }[] = [
  { value: 'httpRequest', label: 'HTTP 请求', description: '修改发出的请求' },
  { value: 'httpResponse', label: 'HTTP 响应', description: '模拟或修改响应' },
  { value: 'wsOutgoing', label: 'WebSocket 发送', description: '修改发送的 WS 消息' },
  { value: 'wsIncoming', label: 'WebSocket 接收', description: '修改接收的 WS 消息' },
]

const httpTargetTypeOptions: { value: MockTargetType; label: string; description: string }[] = [
  { value: 'httpRequest', label: 'HTTP 请求', description: '修改发出的请求' },
  { value: 'httpResponse', label: 'HTTP 响应', description: '模拟或修改响应' },
]

export function MockRuleEditor({ rule, isOpen, onClose, onSave, loading, httpOnly = false }: MockRuleEditorProps) {
  const targetTypeOptions = httpOnly ? httpTargetTypeOptions : allTargetTypeOptions
  const isEdit = !!rule
  const initialData = rule || createEmptyRule()

  const [name, setName] = useState(initialData.name)
  const [targetType, setTargetType] = useState<MockTargetType>(initialData.targetType)
  const [priority, setPriority] = useState(initialData.priority)
  const [enabled, setEnabled] = useState(initialData.enabled)

  // Condition
  const [urlPattern, setUrlPattern] = useState(initialData.condition.urlPattern || '')
  const [method, setMethod] = useState(initialData.condition.method || '')
  const [statusCode, setStatusCode] = useState(initialData.condition.statusCode?.toString() || '')
  const [bodyContains, setBodyContains] = useState(initialData.condition.bodyContains || '')
  const [wsPayloadContains, setWsPayloadContains] = useState(
    initialData.condition.wsPayloadContains || ''
  )

  // Action
  const [mockStatusCode, setMockStatusCode] = useState(
    initialData.action.mockResponseStatusCode?.toString() || '200'
  )
  const [mockResponseBody, setMockResponseBody] = useState(
    initialData.action.mockResponseBody ? atob(initialData.action.mockResponseBody) : ''
  )
  const [mockHeaders, setMockHeaders] = useState(
    JSON.stringify(initialData.action.mockResponseHeaders || {}, null, 2)
  )
  const [mockWsPayload, setMockWsPayload] = useState(
    initialData.action.mockWebSocketPayload ? atob(initialData.action.mockWebSocketPayload) : ''
  )
  const [delayMs, setDelayMs] = useState(initialData.action.delayMilliseconds?.toString() || '')

  // 重置表单
  useEffect(() => {
    if (isOpen) {
      const data = rule || createEmptyRule()
      setName(data.name)
      setTargetType(data.targetType)
      setPriority(data.priority)
      setEnabled(data.enabled)
      setUrlPattern(data.condition.urlPattern || '')
      setMethod(data.condition.method || '')
      setStatusCode(data.condition.statusCode?.toString() || '')
      setBodyContains(data.condition.bodyContains || '')
      setWsPayloadContains(data.condition.wsPayloadContains || '')
      setMockStatusCode(data.action.mockResponseStatusCode?.toString() || '200')
      setMockResponseBody(data.action.mockResponseBody ? atob(data.action.mockResponseBody) : '')
      setMockHeaders(JSON.stringify(data.action.mockResponseHeaders || {}, null, 2))
      setMockWsPayload(data.action.mockWebSocketPayload ? atob(data.action.mockWebSocketPayload) : '')
      setDelayMs(data.action.delayMilliseconds?.toString() || '')
    }
  }, [isOpen, rule])

  const handleSubmit = () => {
    // 构建 condition
    const condition: MockRuleCondition = {
      urlPattern: urlPattern || null,
      method: method || null,
      statusCode: statusCode ? parseInt(statusCode) : null,
      headerContains: null,
      bodyContains: bodyContains || null,
      wsPayloadContains: wsPayloadContains || null,
      enabled: true,
    }

    // 构建 action
    let parsedHeaders: Record<string, string> | null = null
    try {
      parsedHeaders = mockHeaders ? JSON.parse(mockHeaders) : null
    } catch {
      // Invalid JSON, keep null
    }

    const action: MockRuleAction = {
      modifyRequestHeaders: null,
      modifyRequestBody: null,
      mockResponseStatusCode: mockStatusCode ? parseInt(mockStatusCode) : null,
      mockResponseHeaders: parsedHeaders,
      mockResponseBody: mockResponseBody ? btoa(mockResponseBody) : null,
      mockWebSocketPayload: mockWsPayload ? btoa(mockWsPayload) : null,
      delayMilliseconds: delayMs ? parseInt(delayMs) : null,
    }

    onSave({
      name,
      targetType,
      condition,
      action,
      priority,
      enabled,
    })
  }

  if (!isOpen) return null

  const isHttp = targetType === 'httpRequest' || targetType === 'httpResponse'
  const isWs = targetType === 'wsOutgoing' || targetType === 'wsIncoming'
  const isResponse = targetType === 'httpResponse'

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-bg-dark border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">
            {isEdit ? '编辑规则' : '创建 Mock 规则'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-bg-light text-text-muted hover:text-text-primary transition-all"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* 基本信息 */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider">基本信息</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-1.5">规则名称 *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：Mock 用户信息接口"
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-xs text-text-muted mb-1.5">目标类型 *</label>
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value as MockTargetType)}
                  className="select w-full"
                >
                  {targetTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-1.5">优先级</label>
                <input
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                  className="input w-full"
                />
              </div>

              <div className="flex items-center gap-3 pt-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="accent-primary w-4 h-4"
                  />
                  <span className="text-sm text-text-secondary">启用规则</span>
                </label>
              </div>
            </div>
          </div>

          {/* 匹配条件 */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider">匹配条件</h3>

            <div>
              <label className="block text-xs text-text-muted mb-1.5">
                URL 模式（支持 * 通配符和正则）
              </label>
              <input
                type="text"
                value={urlPattern}
                onChange={(e) => setUrlPattern(e.target.value)}
                placeholder="例如：*/api/user/* 或 ^https://api\\.example\\.com"
                className="input w-full font-mono text-sm"
              />
            </div>

            {isHttp && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">HTTP 方法</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="select w-full"
                  >
                    <option value="">任意方法</option>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                </div>

                {isResponse && (
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">原始状态码</label>
                    <input
                      type="number"
                      value={statusCode}
                      onChange={(e) => setStatusCode(e.target.value)}
                      placeholder="仅匹配指定状态码的响应"
                      className="input w-full"
                    />
                  </div>
                )}
              </div>
            )}

            {isHttp && (
              <div>
                <label className="block text-xs text-text-muted mb-1.5">请求体包含</label>
                <input
                  type="text"
                  value={bodyContains}
                  onChange={(e) => setBodyContains(e.target.value)}
                  placeholder="匹配请求体中包含的内容"
                  className="input w-full font-mono text-sm"
                />
              </div>
            )}

            {isWs && (
              <div>
                <label className="block text-xs text-text-muted mb-1.5">消息包含</label>
                <input
                  type="text"
                  value={wsPayloadContains}
                  onChange={(e) => setWsPayloadContains(e.target.value)}
                  placeholder="匹配 WebSocket 消息中包含的内容"
                  className="input w-full font-mono text-sm"
                />
              </div>
            )}
          </div>

          {/* 响应配置 */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider">响应配置</h3>

            {isHttp && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">Mock 状态码</label>
                    <input
                      type="number"
                      value={mockStatusCode}
                      onChange={(e) => setMockStatusCode(e.target.value)}
                      placeholder="200"
                      className="input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">延迟 (ms)</label>
                    <input
                      type="number"
                      value={delayMs}
                      onChange={(e) => setDelayMs(e.target.value)}
                      placeholder="0"
                      className="input w-full"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-text-muted mb-1.5">响应头 (JSON)</label>
                  <textarea
                    value={mockHeaders}
                    onChange={(e) => setMockHeaders(e.target.value)}
                    placeholder='{"Content-Type": "application/json"}'
                    rows={3}
                    className="input w-full font-mono text-sm resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-text-muted mb-1.5">响应体</label>
                  <textarea
                    value={mockResponseBody}
                    onChange={(e) => setMockResponseBody(e.target.value)}
                    placeholder='{"success": true, "data": {...}}'
                    rows={6}
                    className="input w-full font-mono text-sm resize-none"
                  />
                </div>
              </>
            )}

            {isWs && (
              <>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">延迟 (ms)</label>
                  <input
                    type="number"
                    value={delayMs}
                    onChange={(e) => setDelayMs(e.target.value)}
                    placeholder="0"
                    className="input w-32"
                  />
                </div>

                <div>
                  <label className="block text-xs text-text-muted mb-1.5">替换消息内容</label>
                  <textarea
                    value={mockWsPayload}
                    onChange={(e) => setMockWsPayload(e.target.value)}
                    placeholder='{"type": "mock", "data": {...}}'
                    rows={6}
                    className="input w-full font-mono text-sm resize-none"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn btn-secondary">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !name.trim()}
            className="btn bg-primary text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {loading ? '保存中...' : isEdit ? '保存修改' : '创建规则'}
          </button>
        </div>
      </div>
    </div>
  )
}
