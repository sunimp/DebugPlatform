# Breakpoint 断点调试路线图

## 当前状态 (v1.3)

### 已实现
- ✅ 断点规则创建和管理
- ✅ 请求/响应断点类型
- ✅ URL 匹配（精确、前缀、正则）
- ✅ HTTP 方法匹配
- ✅ 规则启用/禁用
- ✅ 实时同步到设备
- ✅ **网络层集成** - `CaptureURLProtocol.startLoading()` 调用断点检查
- ✅ **消息格式统一** - BreakpointResumeDTO 添加 modifiedResponse 支持
- ✅ **breakpointHit 处理** - DebugHub 处理并广播到 WebUI

---

## Phase 1: 核心功能完善 (优先级: 🔴 High)

### 1.1 请求修改

**目标**: 在断点命中时修改请求内容

**可修改项**:
- URL / Path / Query
- Headers
- Body
- Method

**UI**:
```
┌─ 断点命中: POST /api/login ─────────────────────┐
│  [Headers] [Body] [Query]                       │
│  ┌────────────────────────────────────────────┐ │
│  │ {                                          │ │
│  │   "username": "test",                      │ │
│  │   "password": "modified_password"  ← 修改  │ │
│  │ }                                          │ │
│  └────────────────────────────────────────────┘ │
│  [继续] [丢弃] [修改后继续]                     │
└─────────────────────────────────────────────────┘
```

**预估**: 3 天

---

### 1.2 响应修改

**目标**: 在响应断点命中时修改响应内容

**可修改项**:
- Status Code
- Headers
- Body

**预估**: 2 天

---

### 1.3 条件断点

**目标**: 只在满足条件时触发断点

**条件配置**:
```typescript
interface BreakpointCondition {
  // 请求条件
  headers?: Record<string, string | RegExp>
  query?: Record<string, string | RegExp>
  body?: {
    path: string  // JSONPath
    value: string | RegExp
  }
  
  // 执行条件
  hitCount?: number  // 命中次数后触发
  timeRange?: [string, string]  // 时间范围内触发
}
```

**预估**: 3 天

---

### 1.4 断点命中通知

**目标**: 断点命中时即时通知

**通知方式**:
- WebUI 弹窗
- 声音提示
- 桌面通知

**预估**: 1 天

---

## Phase 2: 调试增强 (优先级: 🟡 Medium)

### 2.1 断点暂停队列

**目标**: 管理多个暂停的请求

**功能**:
- 查看所有暂停的请求
- 批量恢复
- 超时自动放行

**UI**:
```
┌─ 暂停的请求 (3) ──────────────────────────────┐
│  1. POST /api/login        命中 1 分钟        │
│  2. GET /api/user          命中 30 秒         │
│  3. POST /api/order        命中 5 秒          │
│  [全部放行] [全部丢弃]                        │
└─────────────────────────────────────────────────┘
```

**预估**: 2 天

---

### 2.2 请求重试

**目标**: 断点命中后可重新发起请求

**功能**:
- 修改后重试
- 重试次数限制
- 重试间隔配置

**预估**: 2 天

---

### 2.3 断点链

**目标**: 支持请求→响应断点链式调试

**流程**:
```
请求发出 → 请求断点（可修改）→ 发送到服务器
    ↓
响应返回 ← 响应断点（可修改）← 服务器响应
```

**预估**: 2 天

---

### 2.4 断点脚本

**目标**: 使用脚本自动处理断点

**脚本示例**:
```javascript
// 自动添加 Header
function onRequestBreakpoint(request) {
  request.headers['X-Debug'] = 'true'
  return 'continue'  // 或 'drop'
}

// 自动修改响应
function onResponseBreakpoint(response) {
  if (response.statusCode === 401) {
    response.body = { "error": "mock_auth_error" }
  }
  return 'continue'
}
```

**预估**: 4 天

---

## Phase 3: 高级功能 (优先级: 🔵 Low)

### 3.1 断点录制

**目标**: 录制断点调试过程

**功能**:
- 录制修改操作
- 回放调试过程
- 生成测试用例

**预估**: 4 天

---

### 3.2 远程调试

**目标**: 多人协同调试

**功能**:
- 分享断点状态
- 多人同时查看
- 聊天功能

**预估**: 5 天

---

### 3.3 断点模板

**目标**: 保存常用断点配置

**功能**:
- 保存当前断点配置
- 快速应用模板
- 模板分享

**预估**: 2 天

---

## Phase 4: 性能保护 (优先级: 🟡 Medium)

### 4.1 断点超时

**目标**: 防止断点长时间阻塞请求

**配置**:
```typescript
interface BreakpointTimeout {
  requestTimeout: number  // 请求断点超时（秒）
  responseTimeout: number  // 响应断点超时（秒）
  defaultAction: 'continue' | 'drop'  // 超时后默认动作
}
```

**预估**: 1 天

---

### 4.2 断点限流

**目标**: 限制同时暂停的请求数量

**配置**:
```typescript
interface BreakpointRateLimit {
  maxPausedRequests: number  // 最大暂停数
  overflowAction: 'drop' | 'continue' | 'queue'
}
```

**预估**: 1 天

---

### 4.3 自动跳过

**目标**: 智能跳过不重要的断点

**规则**:
- 静态资源自动跳过
- 重复请求自动跳过
- 高频请求采样

**预估**: 2 天

---

## 📊 优先级总览

| 阶段 | 功能 | 预估 | 状态 |
|------|------|------|------|
| **Phase 0** | 消息格式统一 | 0.5 天 | 🔴 待修复 |
| | 网络层集成 | 1 天 | 🔴 待修复 |
| | breakpointHit 处理 | 0.5 天 | 🔴 待修复 |
| **Phase 1** | 请求修改 | 3 天 | 待开发 |
| | 响应修改 | 2 天 | 待开发 |
| | 条件断点 | 3 天 | 待开发 |
| | 断点命中通知 | 1 天 | 待开发 |
| **Phase 2** | 断点暂停队列 | 2 天 | 待开发 |
| | 请求重试 | 2 天 | 待开发 |
| | 断点链 | 2 天 | 待开发 |
| | 断点脚本 | 4 天 | 待开发 |
| **Phase 3** | 断点录制 | 4 天 | 待开发 |
| | 远程调试 | 5 天 | 待开发 |
| | 断点模板 | 2 天 | 待开发 |
| **Phase 4** | 断点超时 | 1 天 | 待开发 |
| | 断点限流 | 1 天 | 待开发 |
| | 自动跳过 | 2 天 | 待开发 |
