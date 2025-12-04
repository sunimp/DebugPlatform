import { format, isToday, isYesterday, differenceInSeconds, differenceInMinutes, differenceInHours, parseISO } from 'date-fns'

/**
 * 格式化时间为 HH:mm:ss.SSS
 */
export function formatTime(dateString: string): string {
  try {
    return format(new Date(dateString), 'HH:mm:ss.SSS')
  } catch {
    return dateString
  }
}

/**
 * 格式化日期时间
 */
export function formatDateTime(dateString: string): string {
  try {
    return format(new Date(dateString), 'yyyy-MM-dd HH:mm:ss')
  } catch {
    return dateString
  }
}

/**
 * 人性化时间显示（刚刚、5分钟前等）
 */
export function formatRelativeTime(dateString: string): string {
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString)
    const now = new Date()
    const diffSeconds = differenceInSeconds(now, date)
    const diffMinutes = differenceInMinutes(now, date)
    const diffHours = differenceInHours(now, date)

    // 小于 5 秒
    if (diffSeconds < 5) {
      return '刚刚'
    }

    // 小于 1 分钟
    if (diffSeconds < 60) {
      return `${diffSeconds} 秒前`
    }

    // 小于 1 小时
    if (diffMinutes < 60) {
      return `${diffMinutes} 分钟前`
    }

    // 小于 24 小时
    if (diffHours < 24) {
      return `${diffHours} 小时前`
    }

    // 今天
    if (isToday(date)) {
      return `今天 ${format(date, 'HH:mm')}`
    }

    // 昨天
    if (isYesterday(date)) {
      return `昨天 ${format(date, 'HH:mm')}`
    }

    // 更早的日期
    return format(date, 'MM-dd HH:mm')
  } catch {
    return dateString
  }
}

/**
 * 智能时间显示 - 用于列表中
 * 最近的用相对时间，旧的用绝对时间
 */
export function formatSmartTime(dateString: string): string {
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString)
    const now = new Date()
    const diffMinutes = differenceInMinutes(now, date)

    // 5分钟内显示相对时间
    if (diffMinutes < 5) {
      return formatRelativeTime(dateString)
    }

    // 今天显示时间
    if (isToday(date)) {
      return format(date, 'HH:mm:ss')
    }

    // 昨天
    if (isYesterday(date)) {
      return `昨天 ${format(date, 'HH:mm')}`
    }

    // 更早
    return format(date, 'MM/dd HH:mm')
  } catch {
    return dateString
  }
}

/**
 * 格式化持续时间（带颜色类名）
 */
export function getDurationClass(ms: number | null): string {
  if (ms === null || ms === undefined) return 'text-text-muted'
  const msValue = ms * 1000
  if (msValue < 100) return 'text-green-400'
  if (msValue < 500) return 'text-green-300'
  if (msValue < 1000) return 'text-yellow-400'
  if (msValue < 3000) return 'text-orange-400'
  return 'text-red-400'
}

/**
 * 格式化持续时间
 * 支持两种调用方式：
 * - formatDuration(ms: number) - 毫秒数
 * - formatDuration(start: Date, end: Date) - 两个时间点
 */
export function formatDuration(start: Date, end: Date): string
export function formatDuration(ms: number | null): string
export function formatDuration(startOrMs: Date | number | null, end?: Date): string {
  let diffMs: number

  if (startOrMs instanceof Date && end instanceof Date) {
    diffMs = end.getTime() - startOrMs.getTime()
  } else if (typeof startOrMs === 'number') {
    if (startOrMs === null) return '-'
    diffMs = startOrMs * 1000 // API returns seconds
  } else {
    return '-'
  }

  if (diffMs < 0) return '-'
  // 毫秒和微秒不显示小数
  if (diffMs < 1) return `${Math.round(diffMs * 1000)}µs`
  if (diffMs < 1000) return `${Math.round(diffMs)}ms`
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`
  if (diffMs < 3600000) {
    const mins = Math.floor(diffMs / 60000)
    const secs = Math.floor((diffMs % 60000) / 1000)
    return `${mins}m ${secs}s`
  }
  const hours = Math.floor(diffMs / 3600000)
  const mins = Math.floor((diffMs % 3600000) / 60000)
  return `${hours}h ${mins}m`
}

/**
 * 格式化字节大小
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 0) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 截断 URL，只显示路径
 */
export function truncateUrl(url: string, maxLength = 60): string {
  try {
    const urlObj = new URL(url)
    const path = urlObj.pathname + urlObj.search
    return path.length > maxLength ? path.substring(0, maxLength) + '...' : path
  } catch {
    return url.length > maxLength ? url.substring(0, maxLength) + '...' : url
  }
}

/**
 * 提取 URL 中的域名
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return url
  }
}

/**
 * 获取状态码对应的样式类
 */
export function getStatusClass(statusCode: number | null): string {
  if (!statusCode) return 'bg-red-500/20 text-red-400 border border-red-500/30'
  if (statusCode >= 200 && statusCode < 300) return 'bg-green-500/15 text-green-400 border border-green-500/30'
  if (statusCode >= 300 && statusCode < 400) return 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
  if (statusCode >= 400 && statusCode < 500) return 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
  return 'bg-red-500/15 text-red-400 border border-red-500/30'
}

/**
 * 获取状态码描述
 */
export function getStatusText(statusCode: number | null): string {
  if (!statusCode) return 'Error'
  const texts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Server Error',
    502: 'Bad Gateway',
    503: 'Unavailable',
  }
  return texts[statusCode] || ''
}

/**
 * 获取 HTTP 方法对应的样式类
 */
export function getMethodClass(method: string): string {
  const classes: Record<string, string> = {
    GET: 'bg-method-get/20 text-method-get border border-method-get/30',
    POST: 'bg-method-post/20 text-method-post border border-method-post/30',
    PUT: 'bg-method-put/20 text-method-put border border-method-put/30',
    DELETE: 'bg-method-delete/20 text-method-delete border border-method-delete/30',
    PATCH: 'bg-method-patch/20 text-method-patch border border-method-patch/30',
  }
  return classes[method.toUpperCase()] || 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
}

/**
 * Base64 解码
 */
export function decodeBase64(str: string): string {
  try {
    return atob(str)
  } catch {
    return str
  }
}

/**
 * 格式化 JSON
 */
export function prettyJSON(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

/**
 * 获取日志级别对应的样式
 */
export function getLogLevelClass(level: string): { color: string; bg: string; border: string } {
  const classes: Record<string, { color: string; bg: string; border: string }> = {
    debug: { color: 'text-level-debug', bg: 'bg-level-debug/10', border: 'border-l-level-debug' },
    info: { color: 'text-level-info', bg: 'bg-level-info/10', border: 'border-l-level-info' },
    warning: { color: 'text-level-warning', bg: 'bg-level-warning/10', border: 'border-l-level-warning' },
    error: { color: 'text-level-error', bg: 'bg-level-error/10', border: 'border-l-level-error' },
    fault: { color: 'text-level-fault', bg: 'bg-level-fault/10', border: 'border-l-level-fault' },
  }
  return classes[level.toLowerCase()] || classes.debug
}
