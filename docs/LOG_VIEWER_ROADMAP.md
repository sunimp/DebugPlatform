# Log Viewer 路线图

## 当前状态 (v1.2)

### 已实现
- ✅ CocoaLumberjack 日志捕获
- ✅ os_log 日志捕获（OSLogStore）
- ✅ 实时日志流
- ✅ 日志级别筛选（单选层级模式：error > warning > info > debug > verbose）
- ✅ Subsystem/Category 筛选
- ✅ 文本搜索
- ✅ TraceId 关联
- ✅ 自动滚动
- ✅ 日志级别颜色标记
- ✅ **日志级别筛选优化** - 从多选改为单选层级模式

---

## Phase 1: 搜索增强 (优先级: 🔴 High)

### 1.1 高级搜索语法

**目标**: 支持类 Splunk 的搜索语法

**语法示例**:
```
level:error subsystem:Network category:API
message:"timeout" | "connection refused"
timestamp:>2025-12-05T10:00:00
```

**实现**:
```typescript
interface LogSearchQuery {
  level?: LogLevel
  subsystem?: string
  category?: string
  message?: string | RegExp
  timestampRange?: [Date, Date]
  traceId?: string
  file?: string
  function?: string
}

function parseSearchQuery(query: string): LogSearchQuery {
  // 解析语法
}
```

**预估**: 3 天

---

### 1.2 搜索历史

**目标**: 保存和快速访问搜索历史

**功能**:
- 最近 20 条搜索记录
- 保存常用搜索
- 快捷键调用

**预估**: 1 天

---

### 1.3 正则搜索

**目标**: 支持正则表达式搜索

**UI**:
```
[🔍 搜索] [.*] (正则模式切换)
```

**预估**: 1 天

---

## Phase 2: 可视化 (优先级: 🟡 Medium)

### 2.1 日志统计面板

**目标**: 显示日志级别分布和趋势

**UI**:
```
┌─ 日志统计 ─────────────────────────────────────┐
│  总数: 12,345                                  │
│  ████████████████ Error: 123 (1.0%)            │
│  ██████████ Warning: 456 (3.7%)                │
│  ████████████████████████ Info: 5,678 (46%)    │
│  ██████████████████ Debug: 6,088 (49.3%)       │
└─────────────────────────────────────────────────┘
```

**预估**: 2 天

---

### 2.2 日志时间线

**目标**: 可视化日志时间分布

**功能**:
- 时间轴选择器
- 点击跳转
- 缩放支持

**UI**:
```
日志量
  100│   ╭──╮
     │  ╭╯  ╰╮  ╭─╮     ╭───╮
   50│╭─╯    ╰──╯ ╰─────╯   ╰─
     │
    0└─────────────────────────> 时间
      10:00  10:30  11:00  11:30
```

**预估**: 3 天

---

### 2.3 日志热力图

**目标**: 按小时/分钟显示日志热力图

**功能**:
- 颜色表示日志量
- 点击查看详情
- 异常时段高亮

**预估**: 2 天

---

## Phase 3: 上下文关联 (优先级: 🟡 Medium)

### 3.1 TraceId 增强

**目标**: 完善请求链路追踪

**功能**:
- 自动注入 TraceId
- HTTP 请求关联
- 调用链可视化

**实现**:
```swift
// 自动在网络请求前设置 TraceId
Thread.current.threadDictionary["debugProbeTraceId"] = request.traceId
```

**预估**: 2 天

---

### 3.2 日志与 HTTP 关联

**目标**: 点击日志跳转到关联的 HTTP 请求

**功能**:
- TraceId 关联
- 时间范围关联
- 一键跳转

**预估**: 2 天

---

### 3.3 堆栈追踪

**目标**: 显示日志调用堆栈

**功能**:
- 展开/折叠堆栈
- 点击跳转源码位置
- 符号化支持

**预估**: 3 天

---

## Phase 4: 告警功能 (优先级: 🔵 Low)

### 4.1 关键词告警

**目标**: 当日志包含特定关键词时弹窗提醒

**配置**:
```typescript
interface LogAlert {
  id: string
  name: string
  condition: {
    level?: LogLevel
    keywords?: string[]
    regex?: string
  }
  action: 'popup' | 'sound' | 'highlight'
}
```

**预估**: 2 天

---

### 4.2 错误率告警

**目标**: 当错误日志超过阈值时告警

**配置**:
```typescript
interface ErrorRateAlert {
  threshold: number  // 百分比
  windowSeconds: number  // 时间窗口
  minSamples: number  // 最小样本数
}
```

**预估**: 2 天

---

### 4.3 异常模式检测

**目标**: 自动识别异常日志模式

**检测项**:
- 重复错误
- 错误突增
- 新错误类型

**预估**: 3 天

---

## Phase 5: 导出功能 (优先级: 🔵 Low)

### 5.1 日志导出

**目标**: 导出日志为多种格式

**格式**:
- Plain Text
- JSON Lines (JSONL)
- CSV

**预估**: 1 天

---

### 5.2 日志分享

**目标**: 生成日志分享链接

**功能**:
- 选择日志范围
- 生成临时链接
- 设置过期时间

**预估**: 2 天

---

### 5.3 日志归档

**目标**: 自动归档历史日志

**功能**:
- 按日期归档
- 压缩存储
- 归档日志查看

**预估**: 3 天

---

## Phase 6: 性能优化 (优先级: 🔵 Low)

### 6.1 虚拟滚动

**目标**: 支持百万级日志流畅浏览

**实现**:
```tsx
import { useVirtualizer } from '@tanstack/react-virtual'

function LogList({ logs }) {
  const virtualizer = useVirtualizer({
    count: logs.length,
    estimateSize: () => 32,
  })
}
```

**预估**: 2 天

---

### 6.2 日志压缩

**目标**: 减少内存占用

**策略**:
- 相同日志去重
- 内容压缩
- LRU 缓存

**预估**: 2 天

---

### 6.3 流式加载

**目标**: 大日志量时流式加载

**实现**:
- WebSocket 流式推送
- 分片加载
- 无限滚动

**预估**: 2 天

---

## 📊 优先级总览

| 阶段 | 功能 | 预估 | 状态 |
|------|------|------|------|
| **Phase 1** | 高级搜索语法 | 3 天 | 待开发 |
| | 搜索历史 | 1 天 | 待开发 |
| | 正则搜索 | 1 天 | 待开发 |
| **Phase 2** | 日志统计面板 | 2 天 | 待开发 |
| | 日志时间线 | 3 天 | 待开发 |
| | 日志热力图 | 2 天 | 待开发 |
| **Phase 3** | TraceId 增强 | 2 天 | 待开发 |
| | 日志与 HTTP 关联 | 2 天 | 待开发 |
| | 堆栈追踪 | 3 天 | 待开发 |
| **Phase 4** | 关键词告警 | 2 天 | 待开发 |
| | 错误率告警 | 2 天 | 待开发 |
| | 异常模式检测 | 3 天 | 待开发 |
| **Phase 5** | 日志导出 | 1 天 | 待开发 |
| | 日志分享 | 2 天 | 待开发 |
| | 日志归档 | 3 天 | 待开发 |
| **Phase 6** | 虚拟滚动 | 2 天 | 待开发 |
| | 日志压缩 | 2 天 | 待开发 |
| | 流式加载 | 2 天 | 待开发 |
