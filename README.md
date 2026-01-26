# Debug Platform

移动 App 调试平台，集成 HTTP/WebSocket 监控、日志分析、数据库检查、Mock 引擎、断点调试、故障注入、性能监控于一体。基于三层插件化架构，支持灵活扩展。

> [!IMPORTANT]
>
> **本项目全部代码和文档均由 AI Agent 生成**

> **当前版本**: 1.2.0 | [更新日志](docs/CHANGELOG.md) | [开发路线图](docs/ROADMAP.md)
>
> **最后更新**: 2026-01-26

## ✨ 功能特性

### 核心调试能力

- 🌐 **HTTP/HTTPS 捕获** - URLProtocol 自动拦截 + URLSessionTaskMetrics 性能时间线
- 🔌 **WebSocket 捕获** - 连接级监控 + 消息帧完整内容查看（Text/JSON/Hex/Base64）
- 📝 **日志捕获** - CocoaLumberjack + os_log 支持
- 🎭 **Mock 规则引擎** - HTTP/WS 请求拦截与响应模拟
- 🔄 **请求重放** - 一键重放历史请求
- ⏸️ **断点调试** - 请求/响应拦截与修改
- 💥 **故障注入** - 延迟、超时、错误码注入
- 🗄️ **数据库检查** - SQLite 数据库浏览和查询
- 📊 **性能监控** - CPU/内存/FPS 实时监控、App 启动时间、页面耗时分析

### 数据分析
- 🔍 **高级搜索语法** - `method:POST status:4xx duration:>500ms`
- 📊 **请求 Diff 对比** - 并排对比两个请求差异
- 📦 **Protobuf 解析** - Wire Format 自动解析 + BLOB 列解析
- 🖼️ **图片响应预览** - 检测图片类型并内联渲染
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
- 🔌 **插件管理** - 动态启用/禁用功能模块

### 可靠性
- 💾 **事件持久化** - 断线时本地 SQLite 缓存，重连后自动恢复
- 🐘 **PostgreSQL 支持** - 生产环境高并发数据库
- ⚙️ **运行时配置** - 动态修改 Hub 地址，无需重新编译

---

## 📸 截图预览

| | |
|:---:|:---:|
| ![设备列表](screenshots/screenshot_0.png) | ![插件详情](screenshots/screenshot_1.png) |
| ![2](screenshots/screenshot_0.png) | ![WebSocket 监控](screenshots/screenshot_3.png) |
| ![日志查看](screenshots/screenshot_4.png) | ![数据库检查](screenshots/screenshot_5.png) |
| ![Mock 规则](screenshots/screenshot_6.png) | ![断点调试](screenshots/screenshot_7.png) |

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                          Mobile App                             │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   DebugProbe SDK                        │   │
│   │  ┌─────────────────────────────────────────────────┐    │   │
│   │  │              Plugin System (8 插件)              │    │   │
│   │  │  HttpPlugin │ LogPlugin │ WebSocketPlugin        │    │   │
│   │  │  MockPlugin │ BreakpointPlugin │ ChaosPlugin     │    │   │
│   │  │  DatabasePlugin │ PerformancePlugin              │    │   │
│   │  └─────────────────────────────────────────────────┘    │   │
│   │  PluginManager → EventCallbacks → BridgeClient          │   │
│   │            ↓ 断线时                                     │   │
│   │   EventPersistenceQueue (SQLite)                        │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │ WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Debug Hub (Vapor)                            │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              Backend Plugin System                      │   │
│   │  HttpBackendPlugin │ LogBackendPlugin │ WSBackendPlugin │   │
│   │  MockBackendPlugin │ BreakpointBackendPlugin            │   │
│   │  ChaosBackendPlugin │ DatabaseBackendPlugin             │   │
│   │  PerformanceBackendPlugin                               │   │
│   └─────────────────────────────────────────────────────────┘   │
│   BackendPluginRegistry → Services → Controllers → PostgreSQL   │
│                           ↓                                     │
│                    Public/ (WebUI 静态资源)                     │
└─────────────────────────────────────────────────────────────────┘
                               │ HTTP + WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Web UI (React + TypeScript)                     │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              Frontend Plugin System                     │   │
│   │  HttpPlugin │ LogPlugin │ WebSocketPlugin               │   │
│   │  MockPlugin │ BreakpointPlugin │ ChaosPlugin            │   │
│   │  DatabasePlugin │ PerformancePlugin                     │   │
│   └─────────────────────────────────────────────────────────┘   │
│   PluginRegistry → PluginRenderer → Zustand Stores              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📚 功能模块路线图

| 模块 | 文档 | 当前状态 |
|------|------|----------|
| **HTTP Inspector** | [HTTP_INSPECTOR_ROADMAP](docs/HTTP_INSPECTOR_ROADMAP.md) | ✅ 1.3 稳定 |
| **WebSocket Inspector** | [WS_INSPECTOR_ROADMAP](docs/WS_INSPECTOR_ROADMAP.md) | ✅ 1.2 稳定 |
| **Log Viewer** | [LOG_VIEWER_ROADMAP](docs/LOG_VIEWER_ROADMAP.md) | ✅ 1.3 稳定 |
| **DB Inspector** | [DB_INSPECTOR_ROADMAP](docs/DB_INSPECTOR_ROADMAP.md) | ✅ 1.3 稳定 |
| **Mock Engine** | [MOCK_ENGINE_ROADMAP](docs/MOCK_ENGINE_ROADMAP.md) | ✅ 1.2 稳定 |
| **Breakpoint** | [BREAKPOINT_ROADMAP](docs/BREAKPOINT_ROADMAP.md) | ✅ 1.3 稳定 |
| **Chaos Engine** | [CHAOS_ENGINE_ROADMAP](docs/CHAOS_ENGINE_ROADMAP.md) | ✅ 1.3 稳定 |
| **Performance Monitor** | [PERFORMANCE_MONITOR_ROADMAP](docs/PERFORMANCE_MONITOR_ROADMAP.md) | ✅ 1.5 稳定 |

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

### 2. App 集成

SDK 已独立为 [DebugProbe](https://github.com/AIAugmentLab/iOS-DebugProbe) 仓库，请参阅该仓库的 README 获取详细集成文档。

**快速开始：**

```swift
// Package.swift 添加依赖
dependencies: [
    .package(path: "../DebugProbe")  // 本地路径
    // 或使用远程仓库
    // .package(url: "https://github.com/AIAugmentLab/iOS-DebugProbe.git", branch: "main")
]

// 集成代码
#if DEBUG
import DebugProbe

func setupDebugProbe() {
    // 可选：预先配置参数
    let settings = DebugProbeSettings.shared
    settings.hubHost = "your-debug-hub"  // 局域网 IP 或 hostname
    settings.hubPort = 8081
    settings.enablePersistence = true
    
    // 启动 DebugProbe
    DebugProbe.shared.start()
}
#endif
```

SDK 默认自动拦截所有 HTTP 请求（Method Swizzling），无需额外配置。更多功能请参阅 [DebugProbe README](https://github.com/sunimp/iOS-DebugProbe/blob/main/README.md)。

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
| `GET /api/devices/{id}/databases` | 查询数据库列表 |
| `POST /api/devices/{id}/mock-rules` | 管理 Mock 规则 |
| `POST /api/devices/{id}/breakpoints` | 管理断点规则 |
| `POST /api/devices/{id}/chaos` | 管理故障注入规则 |

### WebSocket 端点

| 端点 | 说明 |
|------|------|
| `/debug-bridge` | 设备连接端点 |
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
2. **条件编译**: 使用 `#if DEBUG` 保护调试代码
3. **内网部署**: Debug Hub 建议仅在内网使用
4. **自动清理**: 默认 3 天自动清理，收藏请求除外

---

---

## 📖 相关文档

- [DebugProbe SDK (iOS)](https://github.com/AIAugmentLab/iOS-DebugProbe/blob/main/README.md) - iOS 端 SDK
- [Android Probe 开发指南](docs/ANDROID_PROBE_GUIDE.md) - Android 端 SDK 开发指南
- [WebUI](WebUI/README.md) - 前端界面
- [开发路线图](docs/ROADMAP.md) - 功能规划
- [更新日志](docs/CHANGELOG.md) - 版本历史

---

## 📝 License

This project is licensed under the [MIT License](LICENSE).
