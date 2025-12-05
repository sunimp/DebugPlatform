# Debug Platform 更新日志

所有显著更改都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.3.0] - 2025-12-06

### 新增

#### DB Inspector SQL 查询功能
- 支持自定义 SQL 查询（仅 SELECT）
- 查询超时保护（5 秒自动中断）
- 结果集大小限制（最多 1000 行）
- 并发查询限制（串行队列）
- 完整错误信息显示

#### 功能模块路线图
- 新增 7 个独立功能模块路线图文档
- HTTP_INSPECTOR_ROADMAP.md
- WS_INSPECTOR_ROADMAP.md
- LOG_VIEWER_ROADMAP.md
- MOCK_ENGINE_ROADMAP.md
- BREAKPOINT_ROADMAP.md
- CHAOS_ENGINE_ROADMAP.md
- 更新 ROADMAP.md 整合所有模块

### 改进

#### UI 选中样式优化
- **DB Inspector**: 数据库和表选中改为实色主题块（`bg-primary`/`bg-accent-blue`）
- **HTTP 列表**: 选中行改为实色主题块，内部元素颜色自适应
- **WebSocket 列表**: 选中行改为实色主题块，状态指示器颜色自适应
- 所有选中样式添加阴影效果，更突出

#### 日志级别筛选优化
- 筛选模式从多选改为单选层级模式
- 选择某个级别后，显示该级别及更高级别的日志
- 日志级别调整为 CocoaLumberjack 标准：error > warning > info > debug > verbose
- 移除 `fault` 级别，新增 `verbose` 级别

### 修复

#### SQLite 内存安全
- 修复 `tableExists()` 方法的内存 bug
- 使用 `SQLITE_TRANSIENT` 确保字符串正确绑定
- 防止 C 字符串在 `sqlite3_step()` 执行前被释放

### 改进文件

| 文件 | 变更类型 |
|------|----------|
| `WebUI/src/components/DBInspector.tsx` | SQL 查询 UI、选中样式 |
| `WebUI/src/components/HTTPEventTable.tsx` | 选中样式优化 |
| `WebUI/src/components/WSSessionList.tsx` | 选中样式优化 |
| `WebUI/src/components/LogFilters.tsx` | 单选层级模式 |
| `WebUI/src/components/LogList.tsx` | 日志级别标签 |
| `WebUI/src/stores/dbStore.ts` | SQL 查询状态 |
| `WebUI/src/stores/logStore.ts` | 层级筛选逻辑 |
| `WebUI/src/types/index.ts` | LogLevel 类型 |
| `WebUI/src/utils/format.ts` | 日志级别样式 |
| `WebUI/tailwind.config.js` | 颜色配置 |
| `iOSProbe/Sources/Database/SQLiteInspector.swift` | 超时保护、内存修复 |
| `iOSProbe/Sources/Models/DebugEvent.swift` | Level 枚举 |
| `iOSProbe/Sources/Log/AppLogger.swift` | verbose 方法 |
| `iOSProbe/Sources/Log/DebugProbeDDLogger.swift` | DDLogFlag 映射 |
| `DebugHub/Sources/Controllers/DatabaseController.swift` | executeQuery 端点 |
| `docs/*.md` | 路线图文档 |

---

## [1.2.0] - 2025-12-4

### 新增

#### WebSocket 消息完整内容查看

- **后端 API**: `GET /api/devices/{deviceId}/ws-sessions/{sessionId}/frames/{frameId}`
  - 返回 `payloadText`: UTF-8 解码的文本（如果可解码）
  - 返回 `payloadBase64`: Base64 编码的完整 payload
- **前端格式切换器**: 支持 AUTO / TEXT / JSON / HEX / BASE64 五种格式
  - AUTO 模式智能检测最佳显示格式
  - HEX 格式专业 hex dump 显示（带偏移量和 ASCII）
  - JSON 格式使用 JSONTree 组件展示

#### 请求重放功能实现
- iOS SDK 完整实现 `replayRequest` 消息处理
- 使用 `.ephemeral` URLSession 执行重放，避免重放请求被重复记录
- 日志记录请求执行状态

### 修复

#### 协议兼容性
- **payloadSize 解码错误**: `WSEventDTO.Frame` 中 `payloadSize` 改为可选字段
- **replayRequest 消息类型**: iOS SDK 添加缺失的消息类型 (`replayRequest`, `updateBreakpointRules`, `breakpointResume`, `updateChaosRules`)
- **ReplayRequestPayload 字段同步**: iOS SDK 字段名从 `requestId` 改为 `id`，`body` 类型从 `Data?` 改为 `String?` (base64)

#### WebSocket Session URL

- 修复帧事件先于 session 事件到达时，session URL 显示为 "(unknown - session created from frame)" 的问题
- 添加异步 session 信息获取机制

### 变更

#### 视觉风格简化

- 移除所有发光效果 (`shadow-glow-*`, `shadow-neon-*`)
- 移除背景渐变效果
- 边框颜色改为纯色 (`#1e293b`, `#2a3441`)
- 字体改为 Inter

### 改进文件

| 文件 | 变更类型 |
|------|----------|
| `DebugHub/Sources/Controllers/WSEventController.swift` | 新增 frame payload API |
| `DebugHub/Sources/Services/EventDTOs.swift` | payloadSize 可选 |
| `iOSProbe/Sources/Models/BridgeMessage.swift` | 新增消息类型，修复 payload 结构 |
| `iOSProbe/Sources/Core/DebugBridgeClient.swift` | 实现 replayRequest 处理 |
| `WebUI/src/components/WSSessionDetail.tsx` | 完整重写，支持格式切换 |
| `WebUI/src/pages/DeviceDetailPage.tsx` | 异步 session 信息获取 |
| `WebUI/src/stores/wsStore.ts` | 添加 updateSessionUrl 方法 |
| `WebUI/src/services/api.ts` | 添加 getWSFrameDetail 函数 |
| `WebUI/src/types/index.ts` | 添加 WSFrameDetail 类型 |
| `WebUI/src/index.css` | 移除渐变和发光效果 |
| `WebUI/tailwind.config.js` | 字体改为 Inter |
| 多个组件文件 | 边框和背景样式简化 |

---

## [1.1.0] - 2025-12-3

### 新增

#### 工程化增强 (Phase 3.6)
- React WebUI 完整实现（React + TypeScript + Vite + Tailwind CSS）
- API 文档页 (`/api-docs`) - 内置交互式 API 文档
- 健康检查页 (`/health`) - 服务状态监控
- 一键部署脚本 (`deploy.sh`) - 自动安装依赖、配置数据库
- Swift 6 兼容 - Actor-based 并发、@unchecked Sendable
- SPA 路由支持 - 服务端 Fallback 支持前端路由刷新

#### 配置与日志增强 (Phase 3.7)
- 运行时配置管理 (`DebugProbeSettings`)
- 内部日志开关 (`DebugLog` 分级日志)
- 配置 UI 界面 (`DebugProbeSettingsController`)
- 配置持久化 (UserDefaults + Info.plist)
- HTTP 自动拦截 (`URLSessionConfigurationSwizzle`)
- WebSocket 连接级 Swizzle + 消息级 Hook

#### 可靠性与协议增强 (Phase 3.5)
- Protobuf Wire Format 解析 + 嵌套消息 + Hex 视图
- 事件持久化队列 (SQLite 本地队列)
- 断线重连恢复 - 自动恢复发送持久化事件
- PostgreSQL 支持 - 默认数据库，支持高并发

### 变更

- 数据库默认从 SQLite 改为 PostgreSQL
- 部署方式改为脚本化一键部署

---

## [1.0.0] - 2025-12-2

### 新增

#### 核心调试能力 (Phase 1)
- iOS Probe 网络捕获 (URLProtocol + URLSessionTaskMetrics)
- iOS Probe 日志捕获 (CocoaLumberjack + os_log)
- Debug Hub 后端服务 (Vapor + PostgreSQL/SQLite + WebSocket)
- Web UI 基础框架 (React + TypeScript + Vite + Tailwind)
- 实时数据流 (WebSocket 双向通信)
- Mock 规则引擎 (HTTP/WS 请求拦截与响应模拟)
- 请求重放 (通过 WebSocket 指令重放请求)
- cURL 导出 (生成可复制的 cURL 命令)
- JSON 响应树形展示 (可折叠的 JSON 树形视图)
- 性能时间线 (DNS/TCP/TLS/TTFB 时间瀑布图)

#### 高级调试能力 (Phase 2)
- 高级搜索语法 (`method:POST status:4xx duration:>500ms`)
- HAR 导出 (HTTP Archive 1.2 格式)
- 断点调试 (请求/响应拦截与修改)
- 故障注入 (延迟、超时、错误码注入)
- 请求 Diff 对比 (并排对比两个请求差异)

#### 用户体验增强 (Phase 3)
- 数据自动清理 (默认3天过期)
- 图片响应预览 (检测图片类型并内联渲染)
- 深色/浅色主题 (CSS 变量 + 主题切换 + 跟随系统)
- 键盘快捷键 (全局快捷键支持 + 帮助面板)
- 请求收藏/标记 (收藏重要请求，防止被清理)
- 批量操作 (多选 + 批量删除/收藏/导出)

---

## 版本历史图表

```
v1.0.0 ─────► v1.1.0 ─────► v1.2.0 (当前)
   │            │            │
   │            │            └─ WebSocket 完整内容查看
   │            │               请求重放功能实现
   │            │               视觉风格简化
   │            │               协议兼容性修复
   │            │
   │            └─ 工程化增强 (React WebUI, API 文档)
   │               配置与日志增强
   │               可靠性增强 (持久化队列)
   │
   └─ 核心调试能力
      高级调试能力
      用户体验增强
```

---

## 升级指南

### 从 v1.1.x 升级到 v1.2.x

1. **后端无数据库迁移**，直接更新代码重新编译即可

2. **iOS SDK 需要重新集成**：
   ```bash
   # Swift Package Manager 会自动更新
   # 或手动清理缓存
   rm -rf ~/Library/Caches/org.swift.swiftpm
   ```

3. **WebUI 重新部署**：
   ```bash
   cd WebUI && npm run deploy
   ```

### 从 v1.0.x 升级到 v1.1.x

1. **数据库迁移** (如果使用 PostgreSQL)：
   ```bash
   cd DebugHub
   swift run App migrate
   ```

2. **配置文件更新**：
   - 检查 `.env` 文件中的数据库连接字符串
   - 确保 `DATABASE_URL` 指向正确的 PostgreSQL 实例
