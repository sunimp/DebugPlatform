// Configure.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import FluentPostgresDriver
import FluentSQLiteDriver
import NIOSSL
import Vapor

// MARK: - Server Start Time

/// 服务器启动时间（用于计算运行时间）
let serverStartTime = Date()

// MARK: - Application Configuration

func configure(_ app: Application) throws {
    // 配置数据库（支持 PostgreSQL 和 SQLite 两种模式）
    try configureDatabase(app)

    // 注册数据库迁移
    app.migrations.add(CreateHTTPEvent())
    app.migrations.add(CreateWSSession())
    app.migrations.add(CreateWSFrame())
    app.migrations.add(CreateLogEvent())
    app.migrations.add(CreateMockRule())
    app.migrations.add(AddHTTPTiming())
    app.migrations.add(CreateBreakpointRule())
    app.migrations.add(CreateChaosRule())
    app.migrations.add(AddHTTPEventFavorite())
    app.migrations.add(AddHTTPBodyParams())
    app.migrations.add(CreateDomainPolicy())
    app.migrations.add(CreateDeviceSession())
    app.migrations.add(CreateHTTPEventParam())
    app.migrations.add(CreateTrafficRule())
    app.migrations.add(CreateDevice())
    app.migrations.add(AddHTTPEventReplay())
    app.migrations.add(CreatePerformanceMetrics())
    app.migrations.add(CreateJankEvent())
    app.migrations.add(CreateAlert())
    app.migrations.add(AddSequenceNumber())

    // 运行迁移
    try app.autoMigrate().wait()

    // 设置 DeviceRegistry 的数据库引用并注册生命周期
    DeviceRegistry.shared.database = app.db
    app.lifecycle.use(DeviceRegistry.shared)

    // 设置设备断开回调（延迟后触发）
    DeviceRegistry.shared.onDeviceDisconnected = { deviceId in
        RealtimeStreamHandler.shared.broadcastDeviceDisconnected(deviceId: deviceId)
    }

    // 设置设备重连回调（快速重连时触发）
    DeviceRegistry.shared.onDeviceReconnected = { deviceId, deviceName, sessionId in
        RealtimeStreamHandler.shared.broadcastDeviceReconnected(
            deviceId: deviceId,
            deviceName: deviceName,
            sessionId: sessionId
        )
    }

    // 注册数据清理服务（生命周期管理）
    app.lifecycle.use(DataCleanupService.shared)

    // 注册实时流处理器（生命周期管理，用于优雅关闭连接）
    app.lifecycle.use(RealtimeStreamHandler.shared)

    // 注册并启动插件系统
    registerBuiltinPlugins()
    // 同步启动插件（在注册路由之前必须完成）
    try app.eventLoopGroup.next().makeFutureWithTask {
        try await BackendPluginRegistry.shared.bootAll(app: app)
    }.wait()
    app.lifecycle.use(BackendPluginRegistry.shared)

    // 配置静态文件服务（Web UI）
    app.middleware.use(FileMiddleware(publicDirectory: app.directory.publicDirectory))

    // 配置 CORS
    let corsConfig = CORSMiddleware.Configuration(
        allowedOrigin: .all,
        allowedMethods: [.GET, .POST, .PUT, .DELETE, .OPTIONS],
        allowedHeaders: [.accept, .authorization, .contentType, .origin, .xRequestedWith]
    )
    app.middleware.use(CORSMiddleware(configuration: corsConfig))

    // 注册路由
    try routes(app)
}

func routes(_ app: Application) throws {
    // 忽略 Chrome DevTools 的 well-known 请求
    app.get(".well-known", "**") { _ async throws -> Response in
        Response(status: .notFound)
    }

    // 根路径 - 返回 index.html
    app.get { req async throws -> Response in
        try await req.fileio.asyncStreamFile(at: app.directory.publicDirectory + "index.html")
    }

    // 健康检查页面 - 返回 SPA，由 React Router 处理
    app.get("health") { req async throws -> Response in
        try await req.fileio.asyncStreamFile(at: app.directory.publicDirectory + "index.html")
    }

    // 健康检查 API - 返回 JSON
    app.get("api", "health") { _ async throws -> HealthResponse in
        let uptimeSeconds = Int(Date().timeIntervalSince(serverStartTime))
        return HealthResponse(
            status: "healthy",
            version: "1.0.0",
            timestamp: Date(),
            uptimeSeconds: uptimeSeconds,
            startTime: serverStartTime
        )
    }

    // API 路由组
    let api = app.grouped("api")

    // API 索引 - 浏览器返回 SPA，API 客户端返回 JSON
    api.get { req async throws -> Response in
        // 浏览器请求返回 index.html，由 React Router 处理
        let acceptsHTML = req.headers.accept.contains { $0.mediaType == .html }
        if acceptsHTML {
            return try await req.fileio.asyncStreamFile(at: app.directory.publicDirectory + "index.html")
        }
        // API 请求返回 JSON
        let response = APIIndexResponse(
            name: "DebugHub API",
            version: "1.0.0",
            endpoints: [
                "GET  /api/devices": "设备列表",
                "GET  /api/devices/:deviceId": "设备详情",
                "GET  /api/devices/:deviceId/http-events": "HTTP 事件列表",
                "GET  /api/devices/:deviceId/ws-sessions": "WebSocket 会话列表",
                "GET  /api/devices/:deviceId/log-events": "日志事件列表",
                "GET  /api/devices/:deviceId/mock-rules": "Mock 规则列表",
                "GET  /api/devices/:deviceId/breakpoints": "断点规则列表",
                "GET  /api/devices/:deviceId/chaos-rules": "故障注入规则列表",
                "GET  /api/cleanup/config": "清理配置",
                "GET  /api/export/har/:deviceId": "导出 HAR",
                "WS   /debug-bridge": "设备连接",
                "WS   /ws/live": "实时事件流",
            ]
        )
        return try await response.encodeResponse(for: req)
    }

    // 设备相关 API
    try api.register(collection: DeviceController())

    // 插件化 API（由 BackendPluginRegistry 统一注册）
    // 包括：HTTP 事件、WebSocket 事件、日志事件、Mock 规则、断点、故障注入、数据库检查
    try BackendPluginRegistry.shared.registerAllRoutes(on: api)

    // 导出 API
    try api.register(collection: ExportController())

    // 数据清理 API
    try api.register(collection: CleanupController())

    // 域名策略 API
    try api.register(collection: DomainPolicyController())

    // 流量规则 API
    try api.register(collection: TrafficRuleController())

    // 服务器统计 API
    try api.register(collection: StatsController())

    // WebUI 插件状态 API
    try api.register(collection: WebUIPluginController())

    // Token 验证 API
    api.post("auth", "verify") { req async throws -> TokenVerifyResponse in
        let input = try req.content.decode(TokenVerifyRequest.self)
        let validToken = ProcessInfo.processInfo.environment["DEBUG_HUB_TOKEN"] ?? "debug-token-2025"

        if input.token == validToken {
            return TokenVerifyResponse(valid: true, message: "Token 验证成功")
        } else {
            return TokenVerifyResponse(valid: false, message: "Token 无效")
        }
    }

    // Debug Bridge WebSocket 端点
    app.webSocket("debug-bridge", maxFrameSize: WebSocketMaxFrameSize(integerLiteral: 50 * 1024 * 1024)) { req, ws in
        // 设置 ping 间隔保持连接活跃（每 10 秒发送 ping）
        ws.pingInterval = .seconds(10)
        print("[DebugBridge] WebSocket configured with ping interval")

        // 处理连接（非阻塞）
        DebugBridgeHandler.shared.handleConnection(req: req, ws: ws)
    }

    // 实时流 WebSocket 端点
    app.webSocket("ws", "live", maxFrameSize: WebSocketMaxFrameSize(integerLiteral: 50 * 1024 * 1024)) { req, ws in
        ws.pingInterval = .seconds(10)
        RealtimeStreamHandler.shared.handleConnection(req: req, ws: ws)
    }

    // SPA Fallback - 所有未匹配的 GET 请求返回 index.html
    // 这让 React Router 可以处理前端路由（如 /api-docs, /health, /device/:id）
    app.get("**") { req async throws -> Response in
        // 检查是否是静态文件请求（有文件扩展名）
        let path = req.url.path
        if path.contains(".") {
            // 文件不存在，返回 404
            throw Abort(.notFound)
        }
        // 返回 index.html 让 React Router 处理
        return try await req.fileio.asyncStreamFile(at: app.directory.publicDirectory + "index.html")
    }
}

// MARK: - Database Configuration

/// 数据库模式
enum DatabaseMode: String {
    case sqlite
    case postgres
}

/// 获取数据存储目录
/// - 优先使用环境变量 `DATA_DIR`
/// - 默认为当前工作目录下的 `data` 文件夹
func getDataDirectory() -> String {
    if let customPath = Environment.get("DATA_DIR") {
        return customPath
    }

    // 默认使用当前工作目录下的 data 文件夹
    let dataDir = "./data"

    // 确保目录存在
    let fileManager = FileManager.default
    if !fileManager.fileExists(atPath: dataDir) {
        do {
            try fileManager.createDirectory(atPath: dataDir, withIntermediateDirectories: true)
        } catch {
            // 如果创建失败，使用当前目录
            return "."
        }
    }

    return dataDir
}

/// 配置数据库连接
/// - 环境变量 `DATABASE_MODE=sqlite` 可切换为 SQLite, 默认 postgres
/// - 环境变量 `DATA_DIR` 可指定数据存储目录（默认 ./data）
/// - 环境变量 `SQLITE_PATH` 可指定 SQLite 数据库完整路径
/// - 默认使用 PostgreSQL
func configureDatabase(_ app: Application) throws {
    let mode = Environment.get("DATABASE_MODE").flatMap { DatabaseMode(rawValue: $0.lowercased()) } ?? .postgres

    switch mode {
    case .postgres:
        try configurePostgreSQL(app)
    case .sqlite:
        configureSQLite(app)
    }

    app.logger.info("Database mode: \(mode.rawValue)")
}

/// 配置 PostgreSQL 数据库
func configurePostgreSQL(_ app: Application) throws {
    // 从环境变量读取配置
    let hostname = Environment.get("POSTGRES_HOST") ?? "localhost"
    let port = Environment.get("POSTGRES_PORT").flatMap(Int.init) ?? 5432
    let username = Environment.get("POSTGRES_USER") ?? "debug_hub"
    let password = Environment.get("POSTGRES_PASSWORD") ?? "debug_hub_password"
    let database = Environment.get("POSTGRES_DB") ?? "debug_hub"

    // TLS 配置
    let sslMode = Environment.get("POSTGRES_SSL")
    var tlsOption: PostgresConnection.Configuration.TLS = .disable
    if sslMode == "true" || sslMode == "require" {
        var tlsConfig = TLSConfiguration.makeClientConfiguration()
        // 生产环境建议启用完整验证，设置 POSTGRES_SSL_VERIFY=false 可禁用
        if Environment.get("POSTGRES_SSL_VERIFY") == "false" {
            tlsConfig.certificateVerification = .none
        }
        let sslContext = try NIOSSLContext(configuration: tlsConfig)
        tlsOption = .require(sslContext)
    }

    // 连接池配置
    let maxConnectionsPerEventLoop = Environment.get("POSTGRES_MAX_CONNECTIONS")
        .flatMap(Int.init) ?? 4

    let configuration = SQLPostgresConfiguration(
        hostname: hostname,
        port: port,
        username: username,
        password: password,
        database: database,
        tls: tlsOption
    )

    app.databases.use(
        .postgres(
            configuration: configuration,
            maxConnectionsPerEventLoop: maxConnectionsPerEventLoop,
            connectionPoolTimeout: .seconds(30)
        ),
        as: .psql
    )

    app.logger.info("PostgreSQL configured: \(hostname):\(port)/\(database)")
}

/// 配置 SQLite 数据库
/// - 环境变量 `SQLITE_PATH` 可指定完整数据库路径
/// - 否则使用 `DATA_DIR/debug_hub.sqlite`
func configureSQLite(_ app: Application) {
    let dbPath: String
    if let customPath = Environment.get("SQLITE_PATH") {
        dbPath = customPath
    } else {
        let dataDir = getDataDirectory()
        dbPath = "\(dataDir)/debug_hub.sqlite"
    }

    app.databases.use(.sqlite(.file(dbPath)), as: .sqlite)
    app.logger.info("SQLite configured: \(dbPath)")
}

// MARK: - API Response DTOs

struct APIIndexResponse: Content {
    let name: String
    let version: String
    let endpoints: [String: String]
}

struct HealthResponse: Content {
    let status: String
    let version: String
    let timestamp: Date
    let uptimeSeconds: Int
    let startTime: Date
}

struct TokenVerifyRequest: Content {
    let token: String
}

struct TokenVerifyResponse: Content {
    let valid: Bool
    let message: String
}

// MARK: - Plugin Registration

/// 注册所有内置后端插件
private func registerBuiltinPlugins() {
    let registry = BackendPluginRegistry.shared

    // 核心监控插件
    try? registry.register(plugin: HttpBackendPlugin())
    try? registry.register(plugin: LogBackendPlugin())
    try? registry.register(plugin: WebSocketBackendPlugin())
    try? registry.register(plugin: DatabaseBackendPlugin())
    try? registry.register(plugin: PerformanceBackendPlugin())

    // 调试工具插件
    try? registry.register(plugin: MockBackendPlugin())
    try? registry.register(plugin: BreakpointBackendPlugin())
    try? registry.register(plugin: ChaosBackendPlugin())

    print("[PluginRegistry] \(registry.getAllPlugins().count) builtin plugins registered")
}
