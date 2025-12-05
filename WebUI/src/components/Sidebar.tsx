import { useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { useConnectionStore } from '@/stores/connectionStore'
import { useDeviceStore } from '@/stores/deviceStore'
import { useHTTPStore } from '@/stores/httpStore'
import { useWSStore } from '@/stores/wsStore'
import { useRuleStore } from '@/stores/ruleStore'
import { getPlatformIcon, SIMULATOR_ICON } from '@/utils/deviceIcons'
import clsx from 'clsx'

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isServerOnline } = useConnectionStore()

  // Device Store
  const { devices, fetchDevices, currentDeviceId, selectDevice, favoriteDeviceIds, toggleFavorite } = useDeviceStore()

  // HTTP Store (for Domain List) - 支持多选
  const { events, toggleDomain, clearDomains, filters: httpFilters } = useHTTPStore()

  // WebSocket Store (for Host List) - 保持单选
  const { sessions: wsSessions, setFilter: setWsFilter, filters: wsFilters } = useWSStore()

  // Rule Store
  const { getDomainRule, createOrUpdateRule, deleteRule } = useRuleStore()

  // Show all devices toggle
  const [showAllDevices, setShowAllDevices] = useState(false)

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

  // Track previous tab to detect tab switches
  const prevTabRef = useRef<string>(currentTab)

  // Detect new requests and highlight domains
  useEffect(() => {
    // If tab changed, just update the ref without highlighting
    if (prevTabRef.current !== currentTab) {
      prevTabRef.current = currentTab
      // Reset the counts for the new tab context
      const currentCounts: Record<string, number> = {}
      domainStats.forEach(({ domain, count }) => {
        currentCounts[domain] = count
      })
      prevEventsCountRef.current = currentCounts
      return
    }

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
  }, [domainStats, currentTab])

  // Filter domains by search
  const filteredDomainStats = useMemo(() => {
    if (!domainSearch.trim()) return domainStats
    const searchLower = domainSearch.toLowerCase()
    return domainStats.filter(({ domain }) =>
      domain.toLowerCase().includes(searchLower)
    )
  }, [domainStats, domainSearch])

  // Filter devices: show current device + favorites, or all if toggled
  const displayedDevices = useMemo(() => {
    if (showAllDevices) return devices
    return devices.filter(d =>
      d.deviceId === currentDeviceId || favoriteDeviceIds.has(d.deviceId)
    )
  }, [devices, currentDeviceId, favoriteDeviceIds, showAllDevices])

  // Count of hidden devices
  const hiddenDevicesCount = devices.length - displayedDevices.length

  const handleDeviceClick = (deviceId: string) => {
    selectDevice(deviceId)
    navigate(`/device/${deviceId}`)
  }

  const handleToggleFavorite = (e: React.MouseEvent, deviceId: string) => {
    e.stopPropagation()
    toggleFavorite(deviceId)
  }

  const handleDomainClick = (domain: string) => {
    if (currentTab === 'websocket') {
      // Toggle WebSocket host filter (单选)
      if (wsFilters.host === domain) {
        setWsFilter('host', '')
      } else {
        setWsFilter('host', domain)
      }
    } else {
      // Toggle HTTP domain filter (多选)
      toggleDomain(domain)
    }
  }

  // Handle "All Domains" click
  const handleAllDomainsClick = () => {
    if (currentTab === 'websocket') {
      setWsFilter('host', '')
    } else {
      clearDomains()
    }
  }

  // Check if domain is currently selected as filter
  const isDomainSelected = (domain: string) => {
    if (currentTab === 'websocket') {
      return wsFilters.host === domain
    }
    return httpFilters.domains.includes(domain)
  }

  // Check if "All Domains" is selected
  const isAllDomainsSelected = () => {
    if (currentTab === 'websocket') {
      return !wsFilters.host
    }
    return httpFilters.domains.length === 0
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
            <div className="flex items-center gap-2">
              {hiddenDevicesCount > 0 && !showAllDevices && (
                <button
                  onClick={() => setShowAllDevices(true)}
                  className="text-2xs text-text-muted hover:text-primary transition-colors"
                  title="显示所有设备"
                >
                  +{hiddenDevicesCount} 更多
                </button>
              )}
              {showAllDevices && (
                <button
                  onClick={() => setShowAllDevices(false)}
                  className="text-2xs text-text-muted hover:text-primary transition-colors"
                  title="只显示收藏设备"
                >
                  收起
                </button>
              )}
              <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-2xs font-bold">{devices.length}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            {displayedDevices.map(device => {
              const isFavorite = favoriteDeviceIds.has(device.deviceId)
              const isSelected = currentDeviceId === device.deviceId
              return (
                <div
                  key={device.deviceId}
                  onClick={() => handleDeviceClick(device.deviceId)}
                  className={clsx(
                    "group flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors",
                    isSelected
                      ? "bg-primary text-bg-darkest"
                      : "text-text-secondary hover:bg-bg-light hover:text-text-primary"
                  )}
                >
                  <div className="relative flex-shrink-0">
                    <div className={clsx(
                      "w-10 h-10 rounded-lg flex items-center justify-center",
                      isSelected
                        ? "bg-bg-darkest/20"
                        : "bg-bg-medium"
                    )}>
                      <span className="text-xl">{getPlatformIcon(device.platform)}</span>
                    </div>
                    {device.isOnline && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-bg-dark rounded-full" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate text-sm flex items-center gap-1.5">
                      {device.deviceName}
                      {device.isSimulator && (
                        <span className={clsx(
                          "text-2xs px-1.5 py-0.5 rounded",
                          isSelected
                            ? "bg-bg-darkest/20 text-bg-darkest"
                            : "bg-purple-500/20 text-purple-400"
                        )} title="模拟器">
                          {SIMULATOR_ICON}
                        </span>
                      )}
                    </div>
                    <div className={clsx(
                      "text-2xs truncate mt-0.5",
                      isSelected ? "text-bg-darkest/80" : "text-text-muted"
                    )}>
                      {device.appName} <span className={isSelected ? "text-bg-darkest/60" : "opacity-60"}>{device.appVersion} ({device.buildNumber})</span>
                    </div>
                    <div className={clsx(
                      "text-2xs truncate mt-0.5",
                      isSelected ? "text-bg-darkest/80" : "text-text-muted"
                    )}>
                      {device.platform} <span className={isSelected ? "text-bg-darkest/60" : "opacity-60"}>{device.systemVersion}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => handleToggleFavorite(e, device.deviceId)}
                      className={clsx(
                        "p-1.5 rounded transition-all",
                        isFavorite
                          ? "text-yellow-400 hover:text-yellow-300"
                          : isSelected
                            ? "text-bg-darkest/50 opacity-0 group-hover:opacity-100 hover:text-yellow-400"
                            : "text-text-muted opacity-0 group-hover:opacity-100 hover:text-yellow-400"
                      )}
                      title={isFavorite ? "取消收藏" : "收藏设备"}
                    >
                      {isFavorite ? "⭐" : "☆"}
                    </button>
                    <span className={clsx(
                      "opacity-0 group-hover:opacity-100 transition-opacity text-sm",
                      isSelected ? "text-bg-darkest/70" : "text-text-muted"
                    )}>→</span>
                  </div>
                </div>
              )
            })}

            {displayedDevices.length === 0 && devices.length > 0 && (
              <div className="px-4 py-4 text-center text-xs text-text-muted">
                <button
                  onClick={() => setShowAllDevices(true)}
                  className="text-primary hover:underline"
                >
                  显示全部 {devices.length} 个设备
                </button>
              </div>
            )}

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
              {/* "All Domains" Option */}
              <div
                onClick={handleAllDomainsClick}
                className={clsx(
                  "flex items-center justify-between px-3 py-2 rounded cursor-pointer text-xs transition-colors group",
                  isAllDomainsSelected()
                    ? "bg-primary text-bg-darkest font-medium"
                    : "text-text-secondary hover:bg-bg-light"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm">📋</span>
                  <span className="font-medium">
                    {currentTab === 'websocket' ? '全部主机' : '全部域名'}
                  </span>
                </div>
                <span className={clsx(
                  "font-mono text-2xs px-1.5 py-0.5 rounded",
                  isAllDomainsSelected()
                    ? "text-bg-darkest font-bold bg-bg-darkest/20"
                    : "opacity-60 bg-bg-medium"
                )}>
                  {domainStats.reduce((sum, { count }) => sum + count, 0)}
                </span>
              </div>

              {/* Divider */}
              {domainStats.length > 0 && (
                <div className="border-t border-border-subtle my-1" />
              )}

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
                        ? "bg-accent-blue text-white font-medium"
                        : "text-text-secondary hover:bg-bg-light",
                      isHighlighted && "animate-domain-highlight"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Checkbox indicator for multi-select (HTTP only) */}
                      {currentTab === 'http' && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleDomainClick(domain)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 min-w-4 min-h-4 flex-shrink-0 rounded border-border cursor-pointer accent-primary"
                        />
                      )}
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
