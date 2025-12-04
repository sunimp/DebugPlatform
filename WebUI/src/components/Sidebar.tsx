import { useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { useConnectionStore } from '@/stores/connectionStore'
import { useDeviceStore } from '@/stores/deviceStore'
import { useHTTPStore } from '@/stores/httpStore'
import { useWSStore } from '@/stores/wsStore'
import { useRuleStore } from '@/stores/ruleStore'
import clsx from 'clsx'

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isServerOnline } = useConnectionStore()

  // Device Store
  const { devices, fetchDevices, currentDeviceId, selectDevice } = useDeviceStore()

  // HTTP Store (for Domain List)
  const { events, setFilter: setHttpFilter, filters: httpFilters } = useHTTPStore()

  // WebSocket Store (for Host List)
  const { sessions: wsSessions, setFilter: setWsFilter, filters: wsFilters } = useWSStore()

  // Rule Store
  const { getDomainRule, createOrUpdateRule, deleteRule } = useRuleStore()

  // Get current tab from URL
  const currentTab = useMemo(() => {
    const searchParams = new URLSearchParams(location.search)
    return searchParams.get('tab') || 'http'
  }, [location.search])

  // Domain search filter
  const [domainSearch, setDomainSearch] = useState('')

  // Track recently updated domains for highlight effect
  const [highlightedDomains, setHighlightedDomains] = useState<Set<string>>(new Set())
  const prevEventsCountRef = useRef<Record<string, number>>({})

  useEffect(() => {
    fetchDevices()
    // Note: fetchRules() disabled - traffic rules API not implemented
  }, [])

  // Extract Domains/Hosts from Events based on current tab
  const domainStats = useMemo(() => {
    if (currentTab === 'websocket') {
      // Extract hosts from WebSocket sessions
      const stats: Record<string, number> = {}
      wsSessions.forEach(session => {
        try {
          const url = new URL(session.url)
          const host = url.hostname
          stats[host] = (stats[host] || 0) + 1
        } catch { }
      })
      return Object.entries(stats)
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count)
    } else {
      // Extract domains from HTTP events (default)
      const stats: Record<string, number> = {}
      events.forEach(e => {
        try {
          const hostname = new URL(e.url).hostname
          stats[hostname] = (stats[hostname] || 0) + 1
        } catch { }
      })
      return Object.entries(stats)
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count)
    }
  }, [events, wsSessions, currentTab])

  // Detect new requests and highlight domains
  useEffect(() => {
    const currentCounts: Record<string, number> = {}
    domainStats.forEach(({ domain, count }) => {
      currentCounts[domain] = count
    })

    const newHighlights = new Set<string>()
    for (const [domain, count] of Object.entries(currentCounts)) {
      const prevCount = prevEventsCountRef.current[domain] || 0
      if (count > prevCount) {
        newHighlights.add(domain)
      }
    }

    if (newHighlights.size > 0) {
      setHighlightedDomains(prev => new Set([...prev, ...newHighlights]))

      // Remove highlights after animation
      setTimeout(() => {
        setHighlightedDomains(prev => {
          const next = new Set(prev)
          newHighlights.forEach(d => next.delete(d))
          return next
        })
      }, 1500)
    }

    prevEventsCountRef.current = currentCounts
  }, [domainStats])

  // Filter domains by search
  const filteredDomainStats = useMemo(() => {
    if (!domainSearch.trim()) return domainStats
    const searchLower = domainSearch.toLowerCase()
    return domainStats.filter(({ domain }) =>
      domain.toLowerCase().includes(searchLower)
    )
  }, [domainStats, domainSearch])

  const handleDeviceClick = (deviceId: string) => {
    selectDevice(deviceId)
    navigate(`/device/${deviceId}`)
  }

  const handleDomainClick = (domain: string) => {
    if (currentTab === 'websocket') {
      // Toggle WebSocket host filter
      if (wsFilters.host === domain) {
        setWsFilter('host', '')
      } else {
        setWsFilter('host', domain)
      }
    } else {
      // Toggle HTTP domain filter
      if (httpFilters.domain === domain) {
        setHttpFilter('domain', '')
      } else {
        setHttpFilter('domain', domain)
      }
    }
  }

  // Check if domain is currently selected as filter
  const isDomainSelected = (domain: string) => {
    if (currentTab === 'websocket') {
      return wsFilters.host === domain
    }
    return httpFilters.domain === domain
  }

  // Cycle: None -> Whitelist (Highlight) -> Blacklist (Hide) -> None
  const cycleDomainRule = async (e: React.MouseEvent, domain: string) => {
    e.stopPropagation()
    const current = getDomainRule(domain)

    if (!current) {
      // Create Highlight Rule
      await createOrUpdateRule({
        name: domain,
        matchType: 'domain',
        matchValue: domain,
        action: 'highlight',
        isEnabled: true,
        priority: 0
      })
    } else if (current.action === 'highlight') {
      // Update to Hide Rule
      await createOrUpdateRule({ ...current, action: 'hide' })
    } else {
      // Delete Rule
      if (current.id) await deleteRule(current.id)
    }
  }

  return (
    <aside className="w-72 bg-bg-dark border-r border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-5 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="text-xl">🔍</span>
          </div>
          <div>
            <h1 className="font-semibold text-text-primary text-lg">Debug Hub</h1>
            <p className="text-2xs text-text-muted">Network Inspector</p>
          </div>
        </div>
        {/* Rules Management Link */}
        <Link
          to="/rules"
          className="text-xs text-text-muted hover:text-primary transition-colors px-2 py-1 rounded hover:bg-bg-light"
          title="管理流量规则"
        >
          Rules
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Device List Section */}
        <div className="px-3 py-4">
          <div className="px-2 mb-3 text-xs font-semibold text-text-secondary uppercase tracking-wider flex justify-between items-center">
            <span className="flex items-center gap-2">
              <span className="text-sm">📱</span>
              Devices
            </span>
            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-2xs font-bold">{devices.length}</span>
          </div>

          <div className="space-y-1.5">
            {devices.map(device => (
              <div
                key={device.deviceId}
                onClick={() => handleDeviceClick(device.deviceId)}
                className={clsx(
                  "group flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors",
                  currentDeviceId === device.deviceId
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-text-secondary hover:bg-bg-light hover:text-text-primary border border-transparent"
                )}
              >
                <div className="relative flex-shrink-0">
                  <div className={clsx(
                    "w-10 h-10 rounded-lg flex items-center justify-center",
                    currentDeviceId === device.deviceId
                      ? "bg-primary/20"
                      : "bg-bg-medium"
                  )}>
                    <span className="text-xl">📱</span>
                  </div>
                  {device.isOnline && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-bg-dark rounded-full" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate text-sm">{device.deviceName}</div>
                  <div className="text-2xs text-text-muted truncate mt-0.5">
                    {device.appName} <span className="opacity-60">{device.appVersion} ({device.buildNumber})</span>
                  </div>
                  <div className="text-2xs text-text-muted truncate mt-0.5">
                    {device.platform} <span className="opacity-60">{device.systemVersion}</span>
                  </div>
                </div>
                <span className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity text-sm">→</span>
              </div>
            ))}

            {devices.length === 0 && !isServerOnline && (
              <div className="px-4 py-6 text-center text-xs text-text-muted bg-bg-light/20 rounded-lg border border-dashed border-border">
                <span className="text-2xl block mb-2 opacity-50">📡</span>
                等待服务连接...
              </div>
            )}
          </div>
        </div>

        {/* Separator */}
        {currentDeviceId && (currentTab === 'http' || currentTab === 'websocket') && (
          <div className="divider mx-5 my-2" />
        )}

        {/* Domain/Host List Section (Only for HTTP/WebSocket tabs) */}
        {currentDeviceId && (currentTab === 'http' || currentTab === 'websocket') && (
          <div className="px-3 py-3">
            <div className="px-2 mb-3 text-xs font-semibold text-text-secondary uppercase tracking-wider flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="text-sm">{currentTab === 'websocket' ? '🔌' : '🌐'}</span>
                {currentTab === 'websocket' ? 'WS Hosts' : 'Domains'}
              </span>
              <span className="bg-accent-blue/10 text-accent-blue px-2 py-0.5 rounded-full text-2xs font-bold">{domainStats.length}</span>
            </div>

            {/* Domain Search */}
            <div className="px-1 mb-3">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">🔍</span>
                <input
                  type="text"
                  value={domainSearch}
                  onChange={(e) => setDomainSearch(e.target.value)}
                  placeholder={currentTab === 'websocket' ? '搜索主机...' : '搜索域名...'}
                  className="w-full pl-8 pr-3 py-2 text-xs bg-bg-medium border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>

            <div className="space-y-0.5 max-h-[400px] overflow-y-auto pr-1">
              {filteredDomainStats.map(({ domain, count }) => {
                const rule = getDomainRule(domain)
                const isWhitelist = rule?.action === 'highlight'
                const isBlacklist = rule?.action === 'hide'
                const isSelected = isDomainSelected(domain)
                const isHighlighted = highlightedDomains.has(domain)

                return (
                  <div
                    key={domain}
                    onClick={() => handleDomainClick(domain)}
                    className={clsx(
                      "flex items-center justify-between px-3 py-2 rounded cursor-pointer text-xs transition-colors group",
                      isSelected
                        ? "bg-accent-blue/15 text-accent-blue font-medium border border-accent-blue/20"
                        : "text-text-secondary hover:bg-bg-light border border-transparent",
                      isHighlighted && "animate-domain-highlight"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isWhitelist && <span className="text-yellow-500 text-xs" title="Highlighted">★</span>}
                      {isBlacklist && <span className="text-red-400 text-xs" title="Hidden">⛔</span>}
                      <span className={clsx(
                        "truncate font-mono",
                        isBlacklist && "opacity-50 line-through"
                      )}>
                        {domain}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={clsx(
                        "font-mono text-2xs px-1.5 py-0.5 rounded",
                        isHighlighted
                          ? "text-primary font-bold bg-primary/10"
                          : "opacity-60 bg-bg-medium"
                      )}>{count}</span>

                      {/* Quick Action on Hover */}
                      <button
                        onClick={(e) => cycleDomainRule(e, domain)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-bg-medium rounded transition-colors text-text-muted hover:text-text-primary"
                        title="Toggle Rule (None -> Highlight -> Hide)"
                      >
                        ⋮
                      </button>
                    </div>
                  </div>
                )
              })}

              {filteredDomainStats.length === 0 && domainSearch && (
                <div className="px-4 py-4 text-center text-xs text-text-muted bg-bg-light/20 rounded border border-dashed border-border">
                  <span className="text-lg block mb-1 opacity-50">🔍</span>
                  {currentTab === 'websocket' ? '未找到匹配的主机' : '未找到匹配的域名'}
                </div>
              )}

              {domainStats.length === 0 && !domainSearch && (
                <div className="px-4 py-4 text-center text-xs text-text-muted bg-bg-light/20 rounded border border-dashed border-border">
                  <span className="text-lg block mb-1 opacity-50">{currentTab === 'websocket' ? '🔌' : '🌐'}</span>
                  {currentTab === 'websocket' ? '暂无 WebSocket 主机' : '暂无域名记录'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer Status */}
      <div className="p-4 bg-bg-darker border-t border-border text-xs text-text-muted flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className={clsx(
            "w-2 h-2 rounded-full",
            isServerOnline ? "bg-green-500" : "bg-red-500"
          )} />
          <span className="font-medium">{isServerOnline ? "Online" : "Offline"}</span>
        </div>
        <span className="text-text-muted/50">v1.0</span>
      </div>
    </aside>
  )
}
