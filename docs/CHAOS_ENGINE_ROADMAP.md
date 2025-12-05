# Chaos Engine 故障注入路线图

## 当前状态 (v1.2)

### 已实现
- ✅ 故障注入规则创建和管理
- ✅ URL 匹配（精确、前缀、正则）
- ✅ HTTP 方法匹配
- ✅ 延迟注入（固定延迟）
- ✅ 错误码注入
- ✅ 规则启用/禁用
- ✅ 实时同步到设备

### ⚠️ 待修复问题
- 🔴 **P0: 网络层未集成 Chaos**
  - `CaptureURLProtocol.startLoading()` 未调用 `ChaosEngine.shared.evaluate()`
  - 即使规则同步成功，故障注入也不会生效

---

## Phase 0: Bug 修复 (优先级: 🔴 Critical)

### 0.1 网络层集成

**修复位置**: `iOSProbe/Sources/Network/CaptureURLProtocol.swift`

```swift
override func startLoading() {
    // 评估 Chaos 规则
    if let rule = ChaosEngine.shared.evaluate(request: request) {
        applyChaosRule(rule)
        return
    }
    
    // 继续正常请求
    executeRequest()
}

private func applyChaosRule(_ rule: ChaosRule) {
    switch rule.action {
    case .delay(let seconds):
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
            self.executeRequest()
        }
    case .error(let statusCode):
        self.respondWithError(statusCode: statusCode)
    case .timeout:
        // 不响应，等待超时
        break
    }
}
```

**预估**: 1 天

---

## Phase 1: 故障类型扩展 (优先级: 🔴 High)

### 1.1 随机延迟

**目标**: 支持随机延迟范围

**配置**:
```typescript
interface RandomDelay {
  type: 'random'
  min: number  // 最小延迟（毫秒）
  max: number  // 最大延迟（毫秒）
  distribution: 'uniform' | 'normal' | 'exponential'
}
```

**预估**: 1 天

---

### 1.2 连接超时

**目标**: 模拟 TCP 连接超时

**实现**:
```swift
case .connectionTimeout:
    // 模拟 TCP 连接失败
    let error = NSError(
        domain: NSURLErrorDomain,
        code: NSURLErrorCannotConnectToHost,
        userInfo: nil
    )
    client?.urlProtocol(self, didFailWithError: error)
```

**预估**: 0.5 天

---

### 1.3 DNS 失败

**目标**: 模拟 DNS 解析失败

**实现**:
```swift
case .dnsFailure:
    let error = NSError(
        domain: NSURLErrorDomain,
        code: NSURLErrorCannotFindHost,
        userInfo: nil
    )
    client?.urlProtocol(self, didFailWithError: error)
```

**预估**: 0.5 天

---

### 1.4 网络中断

**目标**: 模拟传输过程中网络中断

**实现**:
```swift
case .networkInterrupted(let percentage):
    // 在响应传输到指定百分比时中断
    let partialData = responseData.prefix(Int(responseData.count * percentage))
    client?.urlProtocol(self, didLoad: partialData)
    
    let error = NSError(
        domain: NSURLErrorDomain,
        code: NSURLErrorNetworkConnectionLost,
        userInfo: nil
    )
    client?.urlProtocol(self, didFailWithError: error)
```

**预估**: 1 天

---

### 1.5 慢速响应

**目标**: 模拟带宽限制

**配置**:
```typescript
interface SlowResponse {
  type: 'slowResponse'
  bytesPerSecond: number  // 每秒字节数
}
```

**实现**: 分块发送响应数据，控制发送速率

**预估**: 2 天

---

### 1.6 SSL/TLS 错误

**目标**: 模拟证书相关错误

**错误类型**:
- 证书过期
- 证书不信任
- 主机名不匹配

**预估**: 1 天

---

## Phase 2: 规则增强 (优先级: 🟡 Medium)

### 2.1 概率触发

**目标**: 按概率触发故障

**配置**:
```typescript
interface ChaosRuleProbability {
  enabled: boolean
  percentage: number  // 0-100
}
```

**预估**: 1 天

---

### 2.2 时间窗口

**目标**: 在指定时间窗口内触发故障

**配置**:
```typescript
interface ChaosRuleSchedule {
  startTime: string  // "09:00"
  endTime: string    // "18:00"
  days: number[]     // [1,2,3,4,5] 周一到周五
}
```

**预估**: 1 天

---

### 2.3 请求计数

**目标**: 第 N 次请求触发故障

**配置**:
```typescript
interface ChaosRuleCounter {
  every: number      // 每 N 次触发
  // 或
  after: number      // 第 N 次后触发
  // 或
  first: number      // 前 N 次触发
}
```

**预估**: 1 天

---

### 2.4 条件触发

**目标**: 满足条件时触发故障

**配置**:
```typescript
interface ChaosRuleCondition {
  headers?: Record<string, string>
  query?: Record<string, string>
  body?: {
    path: string
    value: string
  }
}
```

**预估**: 2 天

---

## Phase 3: 场景模拟 (优先级: 🟡 Medium)

### 3.1 网络环境预设

**目标**: 一键切换网络环境

**预设**:
| 预设名 | 延迟 | 带宽 | 丢包率 |
|--------|------|------|--------|
| 4G | 50-100ms | 10MB/s | 0.1% |
| 3G | 100-300ms | 1MB/s | 1% |
| 2G | 300-500ms | 100KB/s | 3% |
| WiFi 弱信号 | 100-200ms | 5MB/s | 2% |
| 地铁 | 200-1000ms | 500KB/s | 10% |

**预估**: 2 天

---

### 3.2 服务降级模拟

**目标**: 模拟后端服务降级

**场景**:
- 服务 A 正常，服务 B 超时
- 主服务正常，缓存服务不可用
- 50% 请求成功，50% 失败

**预估**: 2 天

---

### 3.3 渐进式故障

**目标**: 模拟故障逐渐恶化

**配置**:
```typescript
interface ProgressiveChaos {
  startErrorRate: number  // 初始错误率
  endErrorRate: number    // 最终错误率
  duration: number        // 持续时间（秒）
  pattern: 'linear' | 'exponential'
}
```

**预估**: 2 天

---

### 3.4 故障恢复模拟

**目标**: 模拟故障恢复过程

**配置**:
```typescript
interface FaultRecovery {
  faultDuration: number     // 故障持续时间
  recoveryDuration: number  // 恢复过程时间
  recoveryPattern: 'gradual' | 'instant'
}
```

**预估**: 2 天

---

## Phase 4: 监控与分析 (优先级: 🔵 Low)

### 4.1 故障注入统计

**目标**: 统计故障注入效果

**指标**:
- 注入次数
- 影响请求数
- 应用崩溃率
- 用户行为变化

**预估**: 2 天

---

### 4.2 应用影响分析

**目标**: 分析故障对应用的影响

**分析维度**:
- 请求成功率变化
- 响应时间变化
- 重试次数
- 错误处理覆盖

**预估**: 3 天

---

### 4.3 报告生成

**目标**: 生成故障注入测试报告

**报告内容**:
- 测试场景描述
- 故障类型统计
- 应用表现分析
- 问题发现

**预估**: 2 天

---

## Phase 5: 高级功能 (优先级: 🔵 Low)

### 5.1 Chaos 脚本

**目标**: 使用脚本定义复杂故障场景

**脚本示例**:
```javascript
// 模拟高峰期服务不稳定
function chaos(request, context) {
  const hour = new Date().getHours()
  
  // 高峰期（10-12点）
  if (hour >= 10 && hour <= 12) {
    // 30% 概率延迟
    if (Math.random() < 0.3) {
      return { type: 'delay', ms: 2000 }
    }
    // 10% 概率超时
    if (Math.random() < 0.1) {
      return { type: 'timeout' }
    }
  }
  
  return null  // 正常请求
}
```

**预估**: 4 天

---

### 5.2 分布式 Chaos

**目标**: 跨多设备协调故障注入

**功能**:
- 设备分组
- 同步触发
- 结果汇总

**预估**: 5 天

---

### 5.3 A/B 测试集成

**目标**: 结合 A/B 测试进行故障注入

**功能**:
- 用户分组
- 差异化故障
- 对比分析

**预估**: 3 天

---

## 📊 优先级总览

| 阶段 | 功能 | 预估 | 状态 |
|------|------|------|------|
| **Phase 0** | 网络层集成 | 1 天 | 🔴 待修复 |
| **Phase 1** | 随机延迟 | 1 天 | 待开发 |
| | 连接超时 | 0.5 天 | 待开发 |
| | DNS 失败 | 0.5 天 | 待开发 |
| | 网络中断 | 1 天 | 待开发 |
| | 慢速响应 | 2 天 | 待开发 |
| | SSL/TLS 错误 | 1 天 | 待开发 |
| **Phase 2** | 概率触发 | 1 天 | 待开发 |
| | 时间窗口 | 1 天 | 待开发 |
| | 请求计数 | 1 天 | 待开发 |
| | 条件触发 | 2 天 | 待开发 |
| **Phase 3** | 网络环境预设 | 2 天 | 待开发 |
| | 服务降级模拟 | 2 天 | 待开发 |
| | 渐进式故障 | 2 天 | 待开发 |
| | 故障恢复模拟 | 2 天 | 待开发 |
| **Phase 4** | 故障注入统计 | 2 天 | 待开发 |
| | 应用影响分析 | 3 天 | 待开发 |
| | 报告生成 | 2 天 | 待开发 |
| **Phase 5** | Chaos 脚本 | 4 天 | 待开发 |
| | 分布式 Chaos | 5 天 | 待开发 |
| | A/B 测试集成 | 3 天 | 待开发 |
