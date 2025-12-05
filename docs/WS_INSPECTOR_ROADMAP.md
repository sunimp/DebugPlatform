# WebSocket Inspector 路线图

## 当前状态 (v1.2)

### 已实现
- ✅ WebSocket 连接捕获（URLSessionWebSocketTask Swizzling）
- ✅ 消息帧完整内容（Text/Binary）
- ✅ 消息格式切换器（AUTO/TEXT/JSON/HEX/BASE64）
- ✅ 连接状态实时更新
- ✅ 会话列表和详情分离
- ✅ 帧内容按需加载（避免大 payload 影响列表性能）
- ✅ **选中样式优化** - 实色主题块高亮

---

## Phase 1: 核心增强 (优先级: 🔴 High)

### 1.1 消息搜索

**目标**: 在消息内容中搜索关键词

**功能**:
- 文本搜索（支持正则）
- 搜索结果高亮
- 跨帧搜索

**实现**:
```typescript
interface WSSearchOptions {
  query: string
  isRegex: boolean
  caseSensitive: boolean
  direction: 'inbound' | 'outbound' | 'both'
}
```

**预估**: 2 天

---

### 1.2 消息过滤

**目标**: 按类型、方向、内容过滤消息

**过滤条件**:
- 消息类型：Text / Binary / Ping / Pong / Close
- 方向：发送 / 接收
- 大小范围：`size:>1KB`

**UI**:
```
[发送 ✓] [接收 ✓] [Text ✓] [Binary] | size:>1KB
```

**预估**: 2 天

---

### 1.3 消息统计

**目标**: 显示会话级别的消息统计

**指标**:
```typescript
interface WSSessionStats {
  totalFrames: number
  sentFrames: number
  receivedFrames: number
  totalBytes: number
  sentBytes: number
  receivedBytes: number
  avgFrameSize: number
  duration: number  // 会话持续时间
}
```

**UI**:
```
┌─ 会话统计 ─────────────────────────────────────┐
│  总消息: 1,234   发送: 567   接收: 667         │
│  总流量: 2.3MB   发送: 1.1MB  接收: 1.2MB      │
│  平均大小: 1.9KB  持续时间: 15:32              │
└─────────────────────────────────────────────────┘
```

**预估**: 1 天

---

## Phase 2: 协议支持 (优先级: 🟡 Medium)

### 2.1 Socket.IO 解析

**目标**: 自动识别和解析 Socket.IO 协议

**协议格式**:
```
<packet type>[<namespace>,][<acknowledgment id>][<JSON data>]

例如: 42["chat",{"msg":"hello"}]
     2/admin,["join",{"room":"lobby"}]
```

**实现**:
```typescript
interface SocketIOPacket {
  type: 'connect' | 'disconnect' | 'event' | 'ack' | 'error' | 'binary'
  namespace: string
  ackId?: number
  data: unknown
}

function parseSocketIO(payload: string): SocketIOPacket {
  const typeCode = parseInt(payload[0])
  // ...解析逻辑
}
```

**预估**: 2 天

---

### 2.2 STOMP 解析

**目标**: 支持 STOMP 消息协议解析

**协议格式**:
```
SEND
destination:/queue/test
content-type:application/json

{"hello":"world"}
```

**预估**: 2 天

---

### 2.3 自定义协议解析

**目标**: 支持用户定义自定义协议解析规则

**配置格式**:
```json
{
  "name": "MyProtocol",
  "pattern": "^MP:",
  "parser": {
    "type": "json",
    "offset": 3
  }
}
```

**预估**: 3 天

---

## Phase 3: 交互增强 (优先级: 🟡 Medium)

### 3.1 消息发送

**目标**: 手动发送 WebSocket 消息

**功能**:
- 发送 Text/Binary 消息
- 消息模板
- 发送历史

**UI**:
```
┌─ 发送消息 ─────────────────────────────────────┐
│  [Text ▼] ┌────────────────────────────────┐   │
│           │{"type":"ping"}                  │   │
│           └────────────────────────────────┘   │
│  [发送] [模板 ▼] [历史 ▼]                      │
└─────────────────────────────────────────────────┘
```

**预估**: 3 天

---

### 3.2 消息重放

**目标**: 重放历史消息

**功能**:
- 选择消息重放
- 批量重放
- 修改后重放

**预估**: 2 天

---

### 3.3 会话录制

**目标**: 录制完整的 WebSocket 会话

**功能**:
- 开始/停止录制
- 保存录制文件
- 回放录制

**文件格式**:
```json
{
  "version": "1.0",
  "session": {
    "url": "wss://api.example.com/ws",
    "connectedAt": "2025-12-05T10:00:00Z"
  },
  "frames": [
    {
      "timestamp": "2025-12-05T10:00:01Z",
      "direction": "sent",
      "type": "text",
      "payload": "{...}"
    }
  ]
}
```

**预估**: 4 天

---

## Phase 4: 可视化 (优先级: 🔵 Low)

### 4.1 消息时间线

**目标**: 可视化消息发送/接收时间线

**UI**:
```
时间 ─────────────────────────────────────────────>
        ↑        ↓           ↑    ↓       ↓
     发送#1   接收#1      发送#2  接收#2  接收#3
      10ms    25ms        50ms   80ms    120ms
```

**预估**: 3 天

---

### 4.2 消息流量图

**目标**: 显示消息流量趋势

**UI**:
```
msg/s
  20│    ╭──╮
    │   ╭╯  ╰╮    ╭─╮
  10│ ╭─╯    ╰────╯ ╰──
    │╭╯
   0└─────────────────────> time
```

**预估**: 2 天

---

### 4.3 Protobuf 消息树

**目标**: 对 Protobuf 编码的消息提供树形展示

**功能**:
- 自动检测 Protobuf 格式
- Wire Format 解析
- 字段类型识别

**预估**: 3 天

---

## Phase 5: 导出功能 (优先级: 🔵 Low)

### 5.1 HAR 导出

**目标**: 导出 WebSocket 会话为 HAR 格式

**格式扩展**:
```json
{
  "log": {
    "entries": [{
      "_webSocketMessages": [
        {
          "type": "send",
          "time": 1.234,
          "opcode": 1,
          "data": "..."
        }
      ]
    }]
  }
}
```

**预估**: 1 天

---

### 5.2 Wireshark 导出

**目标**: 导出为 pcapng 格式

**预估**: 3 天

---

## 📊 优先级总览

| 阶段 | 功能 | 预估 | 状态 |
|------|------|------|------|
| **Phase 1** | 消息搜索 | 2 天 | 待开发 |
| | 消息过滤 | 2 天 | 待开发 |
| | 消息统计 | 1 天 | 待开发 |
| **Phase 2** | Socket.IO 解析 | 2 天 | 待开发 |
| | STOMP 解析 | 2 天 | 待开发 |
| | 自定义协议解析 | 3 天 | 待开发 |
| **Phase 3** | 消息发送 | 3 天 | 待开发 |
| | 消息重放 | 2 天 | 待开发 |
| | 会话录制 | 4 天 | 待开发 |
| **Phase 4** | 消息时间线 | 3 天 | 待开发 |
| | 消息流量图 | 2 天 | 待开发 |
| | Protobuf 消息树 | 3 天 | 待开发 |
| **Phase 5** | HAR 导出 | 1 天 | 待开发 |
| | Wireshark 导出 | 3 天 | 待开发 |
