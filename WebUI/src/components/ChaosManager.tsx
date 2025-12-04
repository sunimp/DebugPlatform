import { useState, useEffect, useCallback } from 'react'
import type { ChaosRule, ChaosType } from '@/types'
import {
    getChaosRules,
    createChaosRule,
    updateChaosRule,
    deleteChaosRule,
} from '@/services/api'
import clsx from 'clsx'

interface ChaosManagerProps {
    deviceId: string
}

// ChaosType 的类型标识
type ChaosTypeKind = ChaosType['type']

export function ChaosManager({ deviceId }: ChaosManagerProps) {
    const [rules, setRules] = useState<ChaosRule[]>([])
    const [loading, setLoading] = useState(false)
    const [editingRule, setEditingRule] = useState<Partial<ChaosRule> | null>(null)
    const [showEditor, setShowEditor] = useState(false)

    const fetchRules = useCallback(async () => {
        setLoading(true)
        try {
            const data = await getChaosRules(deviceId)
            setRules(data)
        } catch (error) {
            console.error('Failed to fetch chaos rules:', error)
        } finally {
            setLoading(false)
        }
    }, [deviceId])

    useEffect(() => {
        fetchRules()
    }, [fetchRules])

    const handleCreate = () => {
        setEditingRule({
            name: '',
            urlPattern: '',
            chaos: { type: 'latency', minLatency: 500, maxLatency: 2000 },
            enabled: true,
            priority: 0,
            probability: 1.0,
        })
        setShowEditor(true)
    }

    const handleEdit = (rule: ChaosRule) => {
        setEditingRule({ ...rule })
        setShowEditor(true)
    }

    const handleSave = async () => {
        if (!editingRule) return

        try {
            if (editingRule.id) {
                await updateChaosRule(deviceId, editingRule.id, editingRule)
            } else {
                await createChaosRule(deviceId, editingRule as Omit<ChaosRule, 'id'>)
            }
            setShowEditor(false)
            setEditingRule(null)
            fetchRules()
        } catch (error) {
            console.error('Failed to save chaos rule:', error)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('确定要删除这条混沌规则吗？')) return
        try {
            await deleteChaosRule(deviceId, id)
            fetchRules()
        } catch (error) {
            console.error('Failed to delete chaos rule:', error)
        }
    }

    const handleToggleEnabled = async (rule: ChaosRule) => {
        try {
            await updateChaosRule(deviceId, rule.id, { enabled: !rule.enabled })
            fetchRules()
        } catch (error) {
            console.error('Failed to toggle chaos rule:', error)
        }
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border bg-bg-dark/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="text-xl">🎲</span>
                    <div>
                        <h3 className="font-medium text-text-primary">混沌规则</h3>
                        <p className="text-xs text-text-muted">注入网络故障来测试应用的健壮性</p>
                    </div>
                </div>
                <button onClick={handleCreate} className="btn btn-primary text-sm">
                    + 新建规则
                </button>
            </div>

            {/* Rule List */}
            <div className="flex-1 overflow-auto p-4">
                {loading ? (
                    <div className="flex items-center justify-center h-full text-text-muted">加载中...</div>
                ) : rules.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-text-muted">
                        <span className="text-4xl mb-3 opacity-50">🎲</span>
                        <p className="text-sm mb-3">暂无混沌规则</p>
                        <button onClick={handleCreate} className="btn btn-primary text-sm">
                            + 新建规则
                        </button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {rules.map((rule) => (
                            <ChaosRuleCard
                                key={rule.id}
                                rule={rule}
                                onEdit={() => handleEdit(rule)}
                                onDelete={() => handleDelete(rule.id)}
                                onToggle={() => handleToggleEnabled(rule)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Editor Modal */}
            {showEditor && editingRule && (
                <ChaosRuleEditor
                    rule={editingRule}
                    onChange={setEditingRule}
                    onSave={handleSave}
                    onCancel={() => {
                        setShowEditor(false)
                        setEditingRule(null)
                    }}
                />
            )}
        </div>
    )
}

const chaosTypeConfig: Record<ChaosTypeKind, { label: string; color: string; icon: string; description: string }> = {
    latency: { label: '延迟', color: 'bg-yellow-500/20 text-yellow-400', icon: '⏱️', description: '增加网络延迟' },
    timeout: { label: '超时', color: 'bg-orange-500/20 text-orange-400', icon: '⏰', description: '请求超时' },
    connectionReset: { label: '连接重置', color: 'bg-red-500/20 text-red-400', icon: '🔌', description: '模拟连接重置' },
    randomError: { label: '随机错误', color: 'bg-pink-500/20 text-pink-400', icon: '🎰', description: '返回随机错误码' },
    corruptResponse: { label: '数据损坏', color: 'bg-purple-500/20 text-purple-400', icon: '💥', description: '损坏响应数据' },
    slowNetwork: { label: '慢速网络', color: 'bg-blue-500/20 text-blue-400', icon: '🐌', description: '限制网络带宽' },
    dropRequest: { label: '丢弃请求', color: 'bg-gray-500/20 text-gray-400', icon: '🗑️', description: '直接丢弃请求' },
}

function ChaosRuleCard({
    rule,
    onEdit,
    onDelete,
    onToggle,
}: {
    rule: ChaosRule
    onEdit: () => void
    onDelete: () => void
    onToggle: () => void
}) {
    const typeConfig = chaosTypeConfig[rule.chaos.type]

    const getParamDescription = () => {
        const chaos = rule.chaos
        switch (chaos.type) {
            case 'latency':
                return `延迟: ${chaos.minLatency}-${chaos.maxLatency}ms`
            case 'slowNetwork':
                return `带宽: ${chaos.bytesPerSecond} B/s`
            case 'randomError':
                return `错误码: ${chaos.errorCodes.join(', ')}`
            default:
                return null
        }
    }

    const paramDesc = getParamDescription()

    return (
        <div
            className={clsx(
                'p-4 bg-bg-dark border border-border rounded-xl transition-all',
                !rule.enabled && 'opacity-50'
            )}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {/* Toggle */}
                    <button
                        onClick={onToggle}
                        className={clsx(
                            'w-10 h-6 rounded-full transition-colors relative',
                            rule.enabled ? 'bg-primary' : 'bg-bg-light'
                        )}
                    >
                        <span
                            className={clsx(
                                'absolute top-1 w-4 h-4 bg-white rounded-full transition-transform',
                                rule.enabled ? 'left-5' : 'left-1'
                            )}
                        />
                    </button>

                    <div>
                        <div className="font-medium text-text-primary flex items-center gap-2">
                            <span>{typeConfig.icon}</span>
                            {rule.name || '未命名规则'}
                        </div>
                        <div className="text-xs text-text-muted flex items-center gap-2 mt-1">
                            <span className={clsx('px-1.5 py-0.5 rounded text-2xs', typeConfig.color)}>
                                {typeConfig.label}
                            </span>
                            {rule.probability < 1 && (
                                <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded text-2xs">
                                    {Math.round(rule.probability * 100)}% 概率
                                </span>
                            )}
                            {rule.urlPattern && (
                                <code className="text-text-secondary truncate max-w-[200px]">{rule.urlPattern}</code>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={onEdit}
                        className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-light rounded-lg transition-colors"
                    >
                        ✏️
                    </button>
                    <button
                        onClick={onDelete}
                        className="p-2 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                        🗑️
                    </button>
                </div>
            </div>

            {/* Parameters */}
            {paramDesc && (
                <div className="mt-2 text-xs text-text-muted">
                    {paramDesc}
                </div>
            )}
        </div>
    )
}

function ChaosRuleEditor({
    rule,
    onChange,
    onSave,
    onCancel,
}: {
    rule: Partial<ChaosRule>
    onChange: (rule: Partial<ChaosRule>) => void
    onSave: () => void
    onCancel: () => void
}) {
    const chaosType = rule.chaos?.type || 'latency'

    const handleTypeChange = (newType: ChaosTypeKind) => {
        let newChaos: ChaosType
        switch (newType) {
            case 'latency':
                newChaos = { type: 'latency', minLatency: 500, maxLatency: 2000 }
                break
            case 'timeout':
                newChaos = { type: 'timeout' }
                break
            case 'connectionReset':
                newChaos = { type: 'connectionReset' }
                break
            case 'randomError':
                newChaos = { type: 'randomError', errorCodes: [500, 502, 503] }
                break
            case 'corruptResponse':
                newChaos = { type: 'corruptResponse' }
                break
            case 'slowNetwork':
                newChaos = { type: 'slowNetwork', bytesPerSecond: 1024 }
                break
            case 'dropRequest':
                newChaos = { type: 'dropRequest' }
                break
            default:
                newChaos = { type: 'latency', minLatency: 500, maxLatency: 2000 }
        }
        onChange({ ...rule, chaos: newChaos })
    }

    const updateChaosParams = (updates: Partial<ChaosType>) => {
        if (!rule.chaos) return
        onChange({ ...rule, chaos: { ...rule.chaos, ...updates } as ChaosType })
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-bg-dark border border-border rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-medium text-text-primary mb-4">
                    {rule.id ? '编辑混沌规则' : '新建混沌规则'}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm text-text-muted mb-1">规则名称</label>
                        <input
                            type="text"
                            value={rule.name || ''}
                            onChange={(e) => onChange({ ...rule, name: e.target.value })}
                            placeholder="例如：登录接口延迟"
                            className="input w-full"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-text-muted mb-1">URL 匹配模式</label>
                        <input
                            type="text"
                            value={rule.urlPattern || ''}
                            onChange={(e) => onChange({ ...rule, urlPattern: e.target.value })}
                            placeholder="例如：*/api/login* 或留空匹配所有"
                            className="input w-full font-mono"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-text-muted mb-2">混沌类型</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(Object.entries(chaosTypeConfig) as [ChaosTypeKind, typeof chaosTypeConfig['latency']][]).map(
                                ([type, config]) => (
                                    <button
                                        key={type}
                                        onClick={() => handleTypeChange(type)}
                                        className={clsx(
                                            'p-3 rounded-lg border text-left transition-all',
                                            chaosType === type
                                                ? 'border-primary bg-primary/10'
                                                : 'border-border hover:border-border-hover'
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span>{config.icon}</span>
                                            <span className="font-medium text-text-primary">{config.label}</span>
                                        </div>
                                        <p className="text-xs text-text-muted mt-1">{config.description}</p>
                                    </button>
                                )
                            )}
                        </div>
                    </div>

                    {/* Type-specific parameters */}
                    {rule.chaos?.type === 'latency' && (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-text-muted mb-1">最小延迟 (ms)</label>
                                <input
                                    type="number"
                                    value={rule.chaos.minLatency}
                                    onChange={(e) => updateChaosParams({ minLatency: parseInt(e.target.value) || 0 })}
                                    className="input w-full"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-text-muted mb-1">最大延迟 (ms)</label>
                                <input
                                    type="number"
                                    value={rule.chaos.maxLatency}
                                    onChange={(e) => updateChaosParams({ maxLatency: parseInt(e.target.value) || 0 })}
                                    className="input w-full"
                                />
                            </div>
                        </div>
                    )}

                    {rule.chaos?.type === 'slowNetwork' && (
                        <div>
                            <label className="block text-sm text-text-muted mb-1">带宽限制 (B/s)</label>
                            <input
                                type="number"
                                value={rule.chaos.bytesPerSecond}
                                onChange={(e) => updateChaosParams({ bytesPerSecond: parseInt(e.target.value) || 1024 })}
                                className="input w-full"
                            />
                            <p className="text-xs text-text-muted mt-1">1024 = 1KB/s, 10240 = 10KB/s</p>
                        </div>
                    )}

                    {rule.chaos?.type === 'randomError' && (
                        <div>
                            <label className="block text-sm text-text-muted mb-1">错误状态码 (逗号分隔)</label>
                            <input
                                type="text"
                                value={rule.chaos.errorCodes.join(', ')}
                                onChange={(e) => {
                                    const codes = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
                                    updateChaosParams({ errorCodes: codes.length > 0 ? codes : [500] })
                                }}
                                placeholder="500, 502, 503"
                                className="input w-full"
                            />
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-text-muted mb-1">触发概率</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={(rule.probability || 1) * 100}
                                    onChange={(e) => onChange({ ...rule, probability: parseInt(e.target.value) / 100 })}
                                    className="flex-1"
                                />
                                <span className="text-text-primary w-12 text-right">
                                    {Math.round((rule.probability || 1) * 100)}%
                                </span>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm text-text-muted mb-1">优先级</label>
                            <input
                                type="number"
                                value={rule.priority || 0}
                                onChange={(e) => onChange({ ...rule, priority: parseInt(e.target.value) || 0 })}
                                className="input w-full"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onCancel} className="btn btn-secondary">
                        取消
                    </button>
                    <button onClick={onSave} className="btn btn-primary">
                        保存
                    </button>
                </div>
            </div>
        </div>
    )
}