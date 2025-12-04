# Debug Platform 开发路线图

本文档规划了 Debug Platform 的后续功能开发计划。

> **当前版本**: v1.2.0 | [更新日志](CHANGELOG.md)
>
> **最后更新**: 2025-12-04

---

## ⚠️ 待修复问题

### P0: 协议层问题

#### 断点恢复消息格式不一致

**iOS SDK 端** (`BridgeMessage.swift`):
```swift
struct BreakpointResumePayload {
    let breakpointId: String
    let requestId: String
    let action: String  // 简单字符串
    let modifiedRequest: ModifiedRequest?
}
```

**DebugHub 端** (`DeviceRegistry.swift`):
```swift
struct BreakpointResumeDTO {
    let requestId: String
    let action: BreakpointActionDTO  // 嵌套对象
}
```

**影响**: 断点恢复消息发送后 iOS 端解码失败

---

### P0: 网络层未集成断点和 Chaos

**文件**: `NetworkInstrumentation.swift`

`CaptureURLProtocol.startLoading()` 方法中：
- ❌ 未调用 `BreakpointEngine.shared.checkRequestBreakpoint()`
- ❌ 未调用 `ChaosEngine.shared.evaluate()`

**影响**: 即使规则同步成功，断点和故障注入也不会生效

---

### P2: breakpointHit 消息未处理

**文件**: `DebugBridgeHandler.swift`

iOS SDK 发送的 `breakpointHit` 消息类型未被处理，WebUI 无法感知断点命中。

---

## 🚧 待开发功能

### Phase 4: 企业级特性

#### 4.1 会话录制与回放

**目标**: 录制完整的调试会话，支持保存、分享和回放。

**用户故事**:
1. 开发者在调试时发现问题
2. 点击「保存会话」，命名并保存到服务器
3. 生成分享链接，其他开发者可回放整个会话过程

**优先级**: P2 | **预估**: 2 周

---

#### 4.2 多设备并排对比

**目标**: 同时监控多台设备，对比相同操作在不同设备上的表现。

```
┌─────────────────────┬───────────────────┬───────────────────┐
│ iPhone 15 Pro       │ iPhone 12         │ iPad Pro          │
├─────────────────────┼───────────────────┼───────────────────┤
│ GET /api/home 200   │ GET /api/home 200 │ GET /api/home 200 │
│ 150ms               │ 320ms             │ 180ms             │
├─────────────────────┼───────────────────┼───────────────────┤
│ GET /api/feed 200   │ GET /api/feed 500 │ GET /api/feed 200 │
│ 280ms               │ Timeout           │ 250ms             │
└─────────────────────┴───────────────────┴───────────────────┘
```

**优先级**: P2 | **预估**: 1.5 周

---

#### 4.3 数据脱敏规则

**目标**: 自动识别和脱敏敏感信息。

**内置规则**:
| 类型 | 匹配 | 替换 |
|------|-----|------|
| 信用卡 | `\d{4}-\d{4}-\d{4}-\d{4}` | `****-****-****-1234` |
| 手机号 | `1[3-9]\d{9}` | `138****5678` |
| Token | `Bearer \w+` | `Bearer [REDACTED]` |

**优先级**: P2 | **预估**: 1 周

---

#### 4.4 设备 SQLite 数据库查看

**目标**: 在 WebUI 中远程查看 iOS 设备上的 SQLite 数据库。

**功能**:
- 列出设备沙盒内的数据库文件
- 浏览表结构和数据
- 执行只读 SQL 查询
- 导出数据为 CSV/JSON

**安全限制**:
- 仅支持只读查询
- 查询超时 5 秒
- 结果集限制 1000 行

**优先级**: P2 | **预估**: 1.5 周

---

#### 4.5 Prometheus Metrics

**目标**: 暴露监控指标，接入现有监控体系。

**指标**:
```prometheus
debug_hub_devices_connected{}
debug_hub_events_received_total{type="http|ws|log"}
debug_hub_database_size_bytes{}
```

**优先级**: P2 | **预估**: 3 天

---

### Phase 5: 高可用与扩展性

#### 5.1 高可用部署

**目标**: 支持多实例部署。

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

**目标**: 支持第三方扩展。

**插件类型**:
- 数据处理插件（自定义解析）
- 导出插件（更多格式）
- UI 插件（自定义面板）

**优先级**: P3 | **预估**: 2 周

---

## 📊 优先级总览

| 优先级 | 功能 | 预估 |
|-------|------|------|
| 🔴 P0 | 断点消息格式统一 | 0.5 天 |
| 🔴 P0 | 网络层集成断点/Chaos | 1 天 |
| 🟢 P2 | breakpointHit 处理 | 0.5 天 |
| 🟢 P2 | 设备数据库查看 | 1.5 周 |
| 🟢 P2 | 会话录制 | 2 周 |
| 🟢 P2 | 多设备对比 | 1.5 周 |
| 🟢 P2 | 数据脱敏 | 1 周 |
| 🟢 P2 | Prometheus Metrics | 3 天 |
| 🔵 P3 | 高可用部署 | 2 周 |
| 🔵 P3 | 插件系统 | 2 周 |
