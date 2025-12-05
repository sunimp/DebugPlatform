# Debug Platform 开发路线图

本文档是 Debug Platform 的总体规划。各功能模块的详细路线图请参阅对应文档。

> **当前版本**: v1.3.0 | [更新日志](CHANGELOG.md)
>
> **最后更新**: 2025-12-06

---

## 📚 功能模块路线图

| 模块 | 文档 | 当前状态 | 下一步 |
|------|------|----------|--------|
| **HTTP Inspector** | [HTTP_INSPECTOR_ROADMAP.md](HTTP_INSPECTOR_ROADMAP.md) | v1.2 稳定 | 虚拟滚动优化 |
| **WebSocket Inspector** | [WS_INSPECTOR_ROADMAP.md](WS_INSPECTOR_ROADMAP.md) | v1.2 稳定 | 消息搜索/过滤 |
| **Log Viewer** | [LOG_VIEWER_ROADMAP.md](LOG_VIEWER_ROADMAP.md) | v1.3 增强 | 高级搜索语法 |
| **DB Inspector** | [DB_INSPECTOR_ROADMAP.md](DB_INSPECTOR_ROADMAP.md) | v0.2 稳定 | 数据编辑 |
| **Mock Engine** | [MOCK_ENGINE_ROADMAP.md](MOCK_ENGINE_ROADMAP.md) | v1.0 基础 | 动态响应模板 |
| **Breakpoint** | [BREAKPOINT_ROADMAP.md](BREAKPOINT_ROADMAP.md) | ⚠️ 待修复 | 协议统一 |
| **Chaos Engine** | [CHAOS_ENGINE_ROADMAP.md](CHAOS_ENGINE_ROADMAP.md) | ⚠️ 待修复 | 网络层集成 |

---

## ⚠️ 待修复问题 (P0)

### 1. 断点/Chaos 未生效

**问题**: iOS SDK 网络层未集成断点和故障注入

**影响**: 即使规则同步成功，断点和故障注入也不会生效

**修复位置**: `iOSProbe/Sources/Network/CaptureURLProtocol.swift`

**详情**: [BREAKPOINT_ROADMAP.md](BREAKPOINT_ROADMAP.md#phase-0-bug-修复-优先级-critical) | [CHAOS_ENGINE_ROADMAP.md](CHAOS_ENGINE_ROADMAP.md#phase-0-bug-修复-优先级-critical)

---

### 2. 断点消息格式不一致

**问题**: iOS SDK 和 DebugHub 的 `BreakpointResume` 消息格式不匹配

**影响**: 断点恢复消息解码失败

**详情**: [BREAKPOINT_ROADMAP.md](BREAKPOINT_ROADMAP.md#01-消息格式统一)

---

### 3. breakpointHit 消息未处理

**问题**: DebugHub 未处理 iOS SDK 发送的 `breakpointHit` 消息

**影响**: WebUI 无法感知断点命中

**详情**: [BREAKPOINT_ROADMAP.md](BREAKPOINT_ROADMAP.md#03-breakpointhit-处理)

---

## 🚧 跨模块功能

### 1. 会话录制与回放

**目标**: 录制完整的调试会话，支持保存、分享和回放

**用户故事**:
1. 开发者在调试时发现问题
2. 点击「保存会话」，命名并保存到服务器
3. 生成分享链接，其他开发者可回放整个会话过程

**涉及模块**: HTTP + WebSocket + Log

**优先级**: P2 | **预估**: 2 周

---

### 2. 多设备并排对比

**目标**: 同时监控多台设备，对比相同操作在不同设备上的表现

```
┌─────────────────────┬───────────────────┬───────────────────┐
│ iPhone 15 Pro       │ iPhone 12         │ iPad Pro          │
├─────────────────────┼───────────────────┼───────────────────┤
│ GET /api/home 200   │ GET /api/home 200 │ GET /api/home 200 │
│ 150ms               │ 320ms             │ 180ms             │
└─────────────────────┴───────────────────┴───────────────────┘
```

**涉及模块**: 全局

**优先级**: P2 | **预估**: 1.5 周

---

### 3. 数据脱敏规则

**目标**: 自动识别和脱敏敏感信息

**内置规则**:
| 类型 | 匹配 | 替换 |
|------|-----|------|
| 信用卡 | `\d{4}-\d{4}-\d{4}-\d{4}` | `****-****-****-1234` |
| 手机号 | `1[3-9]\d{9}` | `138****5678` |
| Token | `Bearer \w+` | `Bearer [REDACTED]` |

**涉及模块**: HTTP + WebSocket + Log

**优先级**: P2 | **预估**: 1 周

---

### 4. Prometheus Metrics

**目标**: 暴露监控指标，接入现有监控体系

**指标**:
```prometheus
debug_hub_devices_connected{}
debug_hub_events_received_total{type="http|ws|log"}
debug_hub_database_size_bytes{}
```

**涉及模块**: DebugHub

**优先级**: P2 | **预估**: 3 天

---

## 🏗️ 架构演进

### Phase 5: 高可用与扩展性

#### 5.1 高可用部署

**目标**: 支持多实例部署

**架构**:
```
Load Balancer → Hub #1, #2, #3 → Redis (Session) → PostgreSQL
```

**剩余工作**:
- Redis 设备粘性会话
- 跨实例 Pub/Sub 广播

**优先级**: P3 | **预估**: 2 周

---

#### 5.2 插件系统

**目标**: 支持第三方扩展

**插件类型**:
- 数据处理插件（自定义解析）
- 导出插件（更多格式）
- UI 插件（自定义面板）

**优先级**: P3 | **预估**: 2 周

---

## 📊 优先级总览

| 优先级 | 功能 | 预估 | 详情 |
|-------|------|------|------|
| 🔴 P0 | 断点/Chaos 网络层集成 | 2 天 | [Breakpoint](BREAKPOINT_ROADMAP.md) / [Chaos](CHAOS_ENGINE_ROADMAP.md) |
| 🔴 P0 | 断点消息格式统一 | 0.5 天 | [Breakpoint](BREAKPOINT_ROADMAP.md) |
| 🔴 P0 | breakpointHit 处理 | 0.5 天 | [Breakpoint](BREAKPOINT_ROADMAP.md) |
| 🟢 P2 | 会话录制 | 2 周 | 跨模块 |
| 🟢 P2 | 多设备对比 | 1.5 周 | 跨模块 |
| 🟢 P2 | 数据脱敏 | 1 周 | 跨模块 |
| 🟢 P2 | Prometheus Metrics | 3 天 | DebugHub |
| 🔵 P3 | 高可用部署 | 2 周 | 架构 |
| 🔵 P3 | 插件系统 | 2 周 | 架构 |

---

## 📝 更新记录

### 2025-12-06
- 拆分功能模块路线图为独立文档
- 新增: HTTP_INSPECTOR_ROADMAP.md
- 新增: WS_INSPECTOR_ROADMAP.md
- 新增: LOG_VIEWER_ROADMAP.md
- 新增: MOCK_ENGINE_ROADMAP.md
- 新增: BREAKPOINT_ROADMAP.md
- 新增: CHAOS_ENGINE_ROADMAP.md
- 已有: DB_INSPECTOR_ROADMAP.md

### 2025-12-05
- 初始版本
