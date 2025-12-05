# Debug Platform

一套专为内部 iOS App 设计的调试系统，类似于内部版的 Proxy Tool + Log Viewer。

> [!IMPORTANT]
>
> **本项全部代码和文档均有 Agent AI 生成**

> **当前版本**: v1.3.0 | [更新日志](docs/CHANGELOG.md) | [开发路线图](docs/ROADMAP.md)
>
> **最后更新**: 2025-12-06

## ✨ 功能特性

### 核心调试能力
- 🌐 **HTTP/HTTPS 捕获** - URLProtocol 自动拦截 + URLSessionTaskMetrics 性能时间线
- 🔌 **WebSocket 捕获** - 连接级监控 + 消息帧完整内容查看（Text/JSON/Hex/Base64）
- 📝 **日志捕获** - CocoaLumberjack + os_log 支持
- 🎭 **Mock 规则引擎** - HTTP/WS 请求拦截与响应模拟
- 🔄 **请求重放** - 一键重放历史请求
- ⏸️ **断点调试** - 请求/响应拦截与修改
- 💥 **故障注入** - 延迟、超时、错误码注入

### 数据分析
- 🔍 **高级搜索语法** - `method:POST status:4xx duration:>500ms`
- 📊 **请求 Diff 对比** - 并排对比两个请求差异
- 📦 **Protobuf 解析** - Wire Format 自动解析
- ��️ **图片响应预览** - 检测图片类型并内联渲染
- ⏱️ **性能时间线** - DNS/TCP/TLS/TTFB 瀑布图

### 数据导出
- 📋 **cURL 导出** - 生成可复制的 cURL 命令
- 📁 **HAR 导出** - HTTP Archive 1.2 格式

### 用户体验
- 🌙 **深色/浅色主题** - 支持跟随系统
- ⌨️ **键盘快捷键** - 全局快捷键支持
- ⭐ **请求收藏** - 收藏重要请求，防止被清理
- 📦 **批量操作** - 多选 + 批量删除/收藏/导出
- 🧹 **自动清理** - 可配置的数据过期策略

### 可靠性
- 💾 **事件持久化** - 断线时本地 SQLite 缓存，重连后自动恢复
- 🐘 **PostgreSQL 支持** - 生产环境高并发数据库
- ⚙️ **运行时配置** - 动态修改 Hub 地址，无需重新编译

---

## 📚 功能模块路线图

| 模块 | 文档 | 描述 |
|------|------|------|
| **HTTP Inspector** | [HTTP_INSPECTOR_ROADMAP](docs/HTTP_INSPECTOR_ROADMAP.md) | HTTP 请求捕获和分析 |
| **WebSocket Inspector** | [WS_INSPECTOR_ROADMAP](docs/WS_INSPECTOR_ROADMAP.md) | WebSocket 会话监控 |
| **Log Viewer** | [LOG_VIEWER_ROADMAP](docs/LOG_VIEWER_ROADMAP.md) | 日志查看和分析 |
| **DB Inspector** | [DB_INSPECTOR_ROADMAP](docs/DB_INSPECTOR_ROADMAP.md) | SQLite 数据库检查 |
| **Mock Engine** | [MOCK_ENGINE_ROADMAP](docs/MOCK_ENGINE_ROADMAP.md) | 请求 Mock 规则引擎 |
| **Breakpoint** | [BREAKPOINT_ROADMAP](docs/BREAKPOINT_ROADMAP.md) | 请求断点调试 |
| **Chaos Engine** | [CHAOS_ENGINE_ROADMAP](docs/CHAOS_ENGINE_ROADMAP.md) | 故障注入测试 |

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                          iOS App                                │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                     iOS Probe SDK                       │   │
│   │   NetworkInstrumentation → DebugEventBus → BridgeClient │   │
│   │            ↓ 断线时                                     │   │
│   │   EventPersistenceQueue (SQLite)                        │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │ WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Debug Hub (Vapor)                            │
│   WebSocket Handlers → Services → Controllers → PostgreSQL      │
│                           ↓                                     │
│                    Public/ (WebUI 静态资源)                     │
└─────────────────────────────────────────────────────────────────┘
                               │ HTTP + WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Web UI (React + TypeScript)                     │
│   DeviceListPage │ DeviceDetailPage │ ApiDocsPage │ HealthPage  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 1. 启动 Debug Hub

```bash
cd DebugPlatform/DebugHub

# 一键部署（PostgreSQL + Release）
./deploy.sh

# 或使用 SQLite（零配置）
./deploy.sh --sqlite

# 同时构建 WebUI
./deploy.sh --with-webui
```

服务启动后：
- Web UI: http://localhost:8081
- API 文档: http://localhost:8081/api-docs
- 健康检查: http://localhost:8081/health

### 2. iOS App 集成

将 `iOSProbe/Sources/` 添加到 Xcode 项目：

```swift
#if !APPSTORE
import DebugProbe

func setupDebugProbe() {
	  let settings =DebugProbeSettings.shared
    guard settings.isEnabled else { return }
  
  	settings.hubHost = "<DebugHub host>"
	  settings.hubPort = "<DebugHub port>"
  
    var config = DebugProbe.Configuration(
        hubURL: settings.hubURL,
        token: settings.token
    )
    config.enablePersistence = true
    
    DebugProbe.shared.start(configuration: config)
}
#endif
```

SDK 默认自动拦截所有 HTTP 请求（Method Swizzling），无需额外配置。

### 3. 开发模式

```bash
# 前端开发服务器
cd WebUI && npm run dev

# 构建并部署到 DebugHub
npm run deploy
```

---

## 📡 API 参考

详见 http://localhost:8081/api-docs

### 主要端点

| 端点 | 说明 |
|------|------|
| `GET /api/devices` | 获取在线设备列表 |
| `GET /api/devices/{id}/http` | 查询 HTTP 事件 |
| `GET /api/devices/{id}/ws-sessions` | 查询 WebSocket 会话 |
| `GET /api/devices/{id}/logs` | 查询日志事件 |
| `POST /api/devices/{id}/mock` | 管理 Mock 规则 |
| `POST /api/devices/{id}/breakpoints` | 管理断点规则 |
| `POST /api/devices/{id}/chaos` | 管理故障注入规则 |

### WebSocket 端点

| 端点 | 说明 |
|------|------|
| `/debug-bridge` | iOS 设备连接 |
| `/ws/live?deviceId=xxx` | Web UI 实时事件流 |

---

## ⌨️ 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `⌘K` | 搜索 |
| `⌘R` | 刷新 |
| `⌘T` | 切换主题 |
| `⌘/` | 快捷键帮助 |
| `F` | 收藏 |
| `Del` | 删除选中 |

---

## 🔧 环境变量

| 变量 | 默认值 | 说明 |
|-----|-------|------|
| `DATABASE_MODE` | `postgres` | 数据库模式：`sqlite` 或 `postgres` |
| `POSTGRES_HOST` | `localhost` | PostgreSQL 主机 |
| `POSTGRES_PORT` | `5432` | PostgreSQL 端口 |
| `POSTGRES_USER` | `debug_hub` | PostgreSQL 用户 |
| `POSTGRES_PASSWORD` | `debug_hub_password` | PostgreSQL 密码 |
| `POSTGRES_DB` | `debug_hub` | PostgreSQL 数据库名 |
| `DEBUG_HUB_TOKEN` | - | 设备连接认证 Token |

---

## 🔒 安全性

1. **Token 认证**: Debug Bridge 连接需要有效 Token
2. **条件编译**: 使用 `#if !APPSTORE` 保护调试代码
3. **内网部署**: Debug Hub 建议仅在内网使用
4. **自动清理**: 默认 3 天自动清理，收藏请求除外

---

## 📝 License

This project is licensed under the [MIT License](LICENSE).
