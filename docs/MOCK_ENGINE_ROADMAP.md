# Mock Engine 路线图

## 当前状态 (v1.2)

### 已实现
- ✅ HTTP Mock 规则创建和管理
- ✅ WebSocket Mock 规则
- ✅ URL/路径匹配（精确、前缀、正则）
- ✅ HTTP 方法匹配
- ✅ 自定义响应状态码
- ✅ 自定义响应 Headers
- ✅ 自定义响应 Body
- ✅ 响应延迟配置
- ✅ 规则启用/禁用
- ✅ 规则优先级
- ✅ 实时同步到设备

---

## Phase 1: 规则增强 (优先级: 🔴 High)

### 1.1 条件匹配增强

**目标**: 支持更丰富的匹配条件

**匹配条件**:
```typescript
interface MockRuleCondition {
  url: {
    pattern: string
    type: 'exact' | 'prefix' | 'suffix' | 'contains' | 'regex'
  }
  method?: string[]
  headers?: Record<string, string | RegExp>
  query?: Record<string, string | RegExp>
  body?: {
    type: 'json' | 'text' | 'form'
    pattern: object | string | RegExp
  }
}
```

**示例**:
```json
{
  "condition": {
    "url": { "pattern": "/api/users/*", "type": "prefix" },
    "method": ["POST", "PUT"],
    "headers": { "Content-Type": "application/json" },
    "body": { "type": "json", "pattern": { "action": "login" } }
  }
}
```

**预估**: 3 天

---

### 1.2 动态响应

**目标**: 支持基于请求内容生成响应

**模板语法**:
```handlebars
{
  "userId": "{{request.query.id}}",
  "timestamp": "{{now 'ISO'}}",
  "randomId": "{{uuid}}",
  "echo": "{{request.body.message}}"
}
```

**内置函数**:
| 函数 | 说明 | 示例 |
|------|------|------|
| `now` | 当前时间 | `{{now 'ISO'}}` |
| `uuid` | 生成 UUID | `{{uuid}}` |
| `random` | 随机数 | `{{random 1 100}}` |
| `request.*` | 请求属性 | `{{request.path}}` |

**预估**: 4 天

---

### 1.3 序列响应

**目标**: 支持按顺序返回不同响应

**配置**:
```json
{
  "responses": [
    { "statusCode": 200, "body": { "page": 1 } },
    { "statusCode": 200, "body": { "page": 2 } },
    { "statusCode": 200, "body": { "page": 3 } }
  ],
  "loop": true
}
```

**预估**: 2 天

---

### 1.4 条件响应

**目标**: 根据条件返回不同响应

**配置**:
```json
{
  "conditionalResponses": [
    {
      "when": { "request.query.type": "admin" },
      "then": { "statusCode": 200, "body": { "role": "admin" } }
    },
    {
      "when": { "request.query.type": "user" },
      "then": { "statusCode": 200, "body": { "role": "user" } }
    }
  ],
  "default": { "statusCode": 403, "body": { "error": "forbidden" } }
}
```

**预估**: 2 天

---

## Phase 2: 导入导出 (优先级: 🟡 Medium)

### 2.1 规则导入

**目标**: 支持从多种格式导入 Mock 规则

**支持格式**:
- JSON（自定义格式）
- Charles Session
- Postman Mock Collection
- HAR（作为响应模板）

**预估**: 4 天

---

### 2.2 规则导出

**目标**: 导出 Mock 规则供分享

**功能**:
- 导出单个规则
- 批量导出
- 包含/排除响应体

**预估**: 1 天

---

### 2.3 规则模板库

**目标**: 提供常用场景的预设模板

**模板分类**:
- 认证相关（登录成功/失败/Token 过期）
- 分页相关（空列表/有数据/最后一页）
- 错误相关（400/401/403/404/500）
- 网络相关（超时/慢响应）

**预估**: 2 天

---

## Phase 3: 规则管理 (优先级: 🟡 Medium)

### 3.1 规则分组

**目标**: 按功能或场景分组管理规则

**功能**:
- 创建分组
- 拖拽排序
- 批量启用/禁用分组

**UI**:
```
├─ 登录流程
│  ├─ ✓ 登录成功
│  ├─ ✗ Token 过期
│  └─ ✗ 密码错误
├─ 商品列表
│  ├─ ✓ 正常列表
│  └─ ✗ 空列表
└─ 支付流程
   ├─ ✓ 支付成功
   └─ ✗ 余额不足
```

**预估**: 3 天

---

### 3.2 规则版本

**目标**: 支持规则版本管理

**功能**:
- 自动保存历史版本
- 版本对比
- 回滚到历史版本

**预估**: 3 天

---

### 3.3 规则共享

**目标**: 跨设备共享 Mock 规则

**功能**:
- 服务端规则存储
- 设备间同步
- 团队规则共享

**预估**: 4 天

---

## Phase 4: 高级功能 (优先级: 🔵 Low)

### 4.1 代理模式

**目标**: 支持真实请求 + Mock 响应混合

**模式**:
- **Pure Mock**: 完全返回 Mock 响应
- **Proxy + Override**: 转发真实请求，修改响应
- **Fallback**: 无匹配规则时转发真实请求

**实现**:
```typescript
interface MockRuleProxy {
  mode: 'pure' | 'override' | 'fallback'
  overrideFields?: string[]  // 只覆盖指定字段
}
```

**预估**: 4 天

---

### 4.2 Mock 服务器

**目标**: 独立 Mock 服务器，支持非 SDK 场景

**功能**:
- 独立 HTTP 服务
- OpenAPI 规范导入
- Mock 数据生成

**预估**: 5 天

---

### 4.3 GraphQL Mock

**目标**: 支持 GraphQL 请求 Mock

**功能**:
- Query/Mutation 匹配
- 变量匹配
- Schema 感知

**预估**: 4 天

---

## Phase 5: 测试集成 (优先级: 🔵 Low)

### 5.1 场景测试

**目标**: 基于 Mock 规则定义测试场景

**功能**:
- 场景描述
- 步骤定义
- 断言配置

**预估**: 4 天

---

### 5.2 规则覆盖统计

**目标**: 统计 Mock 规则命中情况

**指标**:
- 规则命中次数
- 未命中请求列表
- 覆盖率报告

**预估**: 2 天

---

### 5.3 录制转 Mock

**目标**: 自动将捕获的请求转为 Mock 规则

**功能**:
- 选择请求
- 自动提取模式
- 生成 Mock 规则

**预估**: 3 天

---

## 📊 优先级总览

| 阶段 | 功能 | 预估 | 状态 |
|------|------|------|------|
| **Phase 1** | 条件匹配增强 | 3 天 | 待开发 |
| | 动态响应 | 4 天 | 待开发 |
| | 序列响应 | 2 天 | 待开发 |
| | 条件响应 | 2 天 | 待开发 |
| **Phase 2** | 规则导入 | 4 天 | 待开发 |
| | 规则导出 | 1 天 | 待开发 |
| | 规则模板库 | 2 天 | 待开发 |
| **Phase 3** | 规则分组 | 3 天 | 待开发 |
| | 规则版本 | 3 天 | 待开发 |
| | 规则共享 | 4 天 | 待开发 |
| **Phase 4** | 代理模式 | 4 天 | 待开发 |
| | Mock 服务器 | 5 天 | 待开发 |
| | GraphQL Mock | 4 天 | 待开发 |
| **Phase 5** | 场景测试 | 4 天 | 待开发 |
| | 规则覆盖统计 | 2 天 | 待开发 |
| | 录制转 Mock | 3 天 | 待开发 |
