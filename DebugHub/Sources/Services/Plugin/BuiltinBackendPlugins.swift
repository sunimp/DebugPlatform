// BuiltinBackendPlugins.swift
// DebugHub
//
// Created by Sun on 2025/12/09.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Foundation
import Vapor

// MARK: - 内置后端插件工厂

/// 内置后端插件工厂
public enum BuiltinBackendPlugins {
    /// 创建所有内置后端插件实例
    public static func createAll() -> [BackendPlugin] {
        [
            HttpBackendPlugin(),
            LogBackendPlugin(),
            WebSocketBackendPlugin(),
            DatabaseBackendPlugin(),
            MockBackendPlugin(),
            BreakpointBackendPlugin(),
            ChaosBackendPlugin(),
        ]
    }

    /// 注册所有内置后端插件
    public static func registerAll() throws {
        let plugins = createAll()
        try BackendPluginRegistry.shared.register(plugins: plugins)
    }
}

// MARK: - Log Backend Plugin

/// 日志后端插件
public final class LogBackendPlugin: BackendPlugin, @unchecked Sendable {
    public let pluginId = BackendPluginId.log
    public let displayName = "Log"
    public let version = "1.0.0"
    public let pluginDescription = "应用日志后端"
    public let dependencies: [String] = []

    public private(set) var state: BackendPluginState = .uninitialized
    private var context: BackendPluginContext?

    public init() {}

    public func boot(context: BackendPluginContext) async throws {
        self.context = context
        state = .running
        context.logger.info("LogBackendPlugin booted")
    }

    public func registerRoutes(on routes: RoutesBuilder) throws {
        let logs = routes.grouped("devices", ":deviceId", "logs")
        logs.get(use: listLogs)
        logs.get("subsystems", use: listSubsystems)
        logs.get("categories", use: listCategories)
        logs.post("batch-delete", use: batchDelete)
        logs.delete(use: deleteAllLogs)
    }

    public func handleEvent(_ event: PluginEventDTO, from deviceId: String) async {
        guard event.eventType == "log_event" else { return }

        do {
            let logEvent = try event.decodePayload(as: LogEventDTO.self)
            try await ingestLogEvent(logEvent, deviceId: deviceId)

            // 广播到 WebUI
            let wsEvent = ["type": "log_event", "deviceId": deviceId, "data": logEvent] as [String: Any]
            context?.broadcastToWebUI(wsEvent, deviceId: deviceId)
        } catch {
            context?.logger.error("Failed to process log event: \(error)")
        }
    }

    private func ingestLogEvent(_ event: LogEventDTO, deviceId: String) async throws {
        guard let db = context?.database else { return }

        let model = LogEventModel(
            id: event.id,
            deviceId: deviceId,
            source: event.source,
            timestamp: event.timestamp,
            level: event.level,
            subsystem: event.subsystem,
            category: event.category,
            loggerName: event.loggerName,
            thread: event.thread,
            file: event.file,
            function: event.function,
            line: event.line,
            message: event.message,
            tags: event.tags.joined(separator: ","),
            traceId: event.traceId
        )

        try await model.save(on: db)
    }

    func listLogs(req: Request) async throws -> PluginLogEventListResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let page = req.query[Int.self, at: "page"] ?? 1
        let pageSize = min(req.query[Int.self, at: "pageSize"] ?? 100, 500)

        var query = LogEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)

        if let level = req.query[String.self, at: "level"] {
            query = query.filter(\.$level == level)
        }

        let total = try await query.count()
        let events = try await query
            .sort(\.$timestamp, .descending)
            .range((page - 1) * pageSize..<page * pageSize)
            .all()

        let items = events.map { PluginLogEventItemDTO(from: $0) }

        return PluginLogEventListResponse(items: items, total: total, page: page, pageSize: pageSize)
    }

    func listSubsystems(req: Request) async throws -> [String] {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let subsystems = try await LogEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .unique()
            .all(\.$subsystem)

        return subsystems.compactMap(\.self)
    }

    func listCategories(req: Request) async throws -> [String] {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let categories = try await LogEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .unique()
            .all(\.$category)

        return categories.compactMap(\.self)
    }

    func batchDelete(req: Request) async throws -> BatchLogDeleteResponse {
        let input = try req.content.decode(BatchLogDeleteInput.self)
        try await LogEventModel.query(on: req.db)
            .filter(\.$id ~~ input.ids)
            .delete()
        return BatchLogDeleteResponse(deleted: input.ids.count)
    }

    /// 删除设备全部日志
    func deleteAllLogs(req: Request) async throws -> DeleteAllLogsResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let count = try await LogEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .count()

        try await LogEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        return DeleteAllLogsResponse(deleted: count)
    }

    public func shutdown() async {
        state = .stopped
    }
}

// MARK: - WebSocket Backend Plugin

/// WebSocket 后端插件
public final class WebSocketBackendPlugin: BackendPlugin, @unchecked Sendable {
    public let pluginId = BackendPluginId.webSocket
    public let displayName = "WebSocket"
    public let version = "1.0.0"
    public let pluginDescription = "WebSocket 连接后端"
    public let dependencies: [String] = []

    public private(set) var state: BackendPluginState = .uninitialized
    private var context: BackendPluginContext?

    public init() {}

    public func boot(context: BackendPluginContext) async throws {
        self.context = context
        state = .running
        context.logger.info("WebSocketBackendPlugin booted")
    }

    public func registerRoutes(on routes: RoutesBuilder) throws {
        let ws = routes.grouped("devices", ":deviceId")
        ws.get("ws-sessions", use: listSessions)
        ws.get("ws-sessions", ":sessionId", use: getSession)
        ws.get("ws-sessions", ":sessionId", "frames", use: listFrames)
        ws.get("ws-sessions", ":sessionId", "frames", ":frameId", use: getFrame)
        ws.delete("ws-sessions", use: deleteAllWSSessions)
    }

    public func handleEvent(_ event: PluginEventDTO, from deviceId: String) async {
        guard event.eventType == "ws_event" else { return }

        do {
            let wsEvent = try event.decodePayload(as: WSEventDTO.self)
            try await ingestWSEvent(wsEvent, deviceId: deviceId)

            // 广播到 WebUI
            let data = ["type": "ws_event", "deviceId": deviceId, "data": wsEvent] as [String: Any]
            context?.broadcastToWebUI(data, deviceId: deviceId)
        } catch {
            context?.logger.error("Failed to process WebSocket event: \(error)")
        }
    }

    private func ingestWSEvent(_ event: WSEventDTO, deviceId: String) async throws {
        guard let db = context?.database else { return }
        let encoder = JSONEncoder()

        switch event.kind {
        case let .sessionCreated(session):
            let model = try WSSessionModel(
                id: session.id,
                deviceId: deviceId,
                url: session.url,
                requestHeaders: String(data: encoder.encode(session.requestHeaders), encoding: .utf8) ?? "{}",
                subprotocols: String(data: encoder.encode(session.subprotocols), encoding: .utf8) ?? "[]",
                connectTime: session.connectTime,
                disconnectTime: session.disconnectTime,
                closeCode: session.closeCode,
                closeReason: session.closeReason
            )
            try await model.save(on: db)

        case let .sessionClosed(session):
            if let existing = try await WSSessionModel.find(session.id, on: db) {
                existing.disconnectTime = session.disconnectTime
                existing.closeCode = session.closeCode
                existing.closeReason = session.closeReason
                try await existing.save(on: db)
            }

        case let .frame(frame):
            // 检查 session 是否存在，如果不存在则自动创建
            let sessionExists = try await WSSessionModel.find(frame.sessionId, on: db) != nil
            if !sessionExists {
                let sessionUrl = frame.sessionUrl ?? "(Session \(String(frame.sessionId.prefix(8)))...)"
                let placeholderSession = WSSessionModel(
                    id: frame.sessionId,
                    deviceId: deviceId,
                    url: sessionUrl,
                    requestHeaders: "{}",
                    subprotocols: "[]",
                    connectTime: frame.timestamp,
                    disconnectTime: nil,
                    closeCode: nil,
                    closeReason: nil
                )
                try await placeholderSession.save(on: db)
            }

            let model = WSFrameModel(
                id: frame.id,
                deviceId: deviceId,
                sessionId: frame.sessionId,
                direction: frame.direction,
                opcode: frame.opcode,
                payload: frame.payload,
                payloadPreview: frame.payloadPreview,
                timestamp: frame.timestamp,
                isMocked: frame.isMocked,
                mockRuleId: frame.mockRuleId
            )
            try await model.save(on: db)
        }
    }

    func listSessions(req: Request) async throws -> WSSessionListResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let page = req.query[Int.self, at: "page"] ?? 1
        let pageSize = min(req.query[Int.self, at: "pageSize"] ?? 50, 200)

        let query = WSSessionModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)

        let total = try await query.count()
        let sessions = try await query
            .sort(\.$connectTime, .descending)
            .range((page - 1) * pageSize..<page * pageSize)
            .all()

        let items = sessions.map { WSSessionDTO(from: $0) }
        return WSSessionListResponse(items: items, total: total, page: page, pageSize: pageSize)
    }

    func getSession(req: Request) async throws -> WSSessionDetailDTO {
        guard let sessionId = req.parameters.get("sessionId") else {
            throw Abort(.badRequest)
        }
        guard let session = try await WSSessionModel.find(sessionId, on: req.db) else {
            throw Abort(.notFound)
        }

        // 获取帧数量
        let frameCount = try await WSFrameModel.query(on: req.db)
            .filter(\.$sessionId == sessionId)
            .count()

        return WSSessionDetailDTO(from: session, frameCount: frameCount)
    }

    func listFrames(req: Request) async throws -> WSFrameListResponse {
        guard let sessionId = req.parameters.get("sessionId") else {
            throw Abort(.badRequest)
        }

        let page = req.query[Int.self, at: "page"] ?? 1
        let pageSize = min(req.query[Int.self, at: "pageSize"] ?? 100, 500)
        let direction = req.query[String.self, at: "direction"]

        var query = WSFrameModel.query(on: req.db)
            .filter(\.$sessionId == sessionId)

        // 根据方向筛选
        if let direction = direction, !direction.isEmpty {
            query = query.filter(\.$direction == direction)
        }

        let total = try await query.count()
        let frames = try await query
            .sort(\.$timestamp, .descending)
            .range((page - 1) * pageSize..<page * pageSize)
            .all()

        let items = frames.map { WSFrameDTO(from: $0) }
        return WSFrameListResponse(items: items, total: total, page: page, pageSize: pageSize)
    }

    func getFrame(req: Request) async throws -> WSFrameDetailDTO {
        guard let frameId = req.parameters.get("frameId") else {
            throw Abort(.badRequest)
        }
        guard let frame = try await WSFrameModel.find(frameId, on: req.db) else {
            throw Abort(.notFound)
        }
        return WSFrameDetailDTO(from: frame)
    }

    /// 删除设备全部 WebSocket 会话和帧
    func deleteAllWSSessions(req: Request) async throws -> DeleteAllWSSessionsResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        // 先获取所有 session ID
        let sessionIds = try await WSSessionModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .all()
            .compactMap(\.id)

        // 删除关联的 frames
        if !sessionIds.isEmpty {
            try await WSFrameModel.query(on: req.db)
                .filter(\.$sessionId ~~ sessionIds)
                .delete()
        }

        // 删除 sessions
        let count = try await WSSessionModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .count()

        try await WSSessionModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        return DeleteAllWSSessionsResponse(deleted: count)
    }

    public func shutdown() async {
        state = .stopped
    }
}

// MARK: - Database Backend Plugin

/// 数据库检查后端插件
public final class DatabaseBackendPlugin: BackendPlugin, @unchecked Sendable {
    public let pluginId = BackendPluginId.database
    public let displayName = "Database"
    public let version = "1.0.0"
    public let pluginDescription = "SQLite 数据库检查后端"
    public let dependencies: [String] = []

    public private(set) var state: BackendPluginState = .uninitialized
    private var context: BackendPluginContext?

    public init() {}

    public func boot(context: BackendPluginContext) async throws {
        self.context = context
        state = .running
        context.logger.info("DatabaseBackendPlugin booted")
    }

    public func registerRoutes(on routes: RoutesBuilder) throws {
        let db = routes.grouped("devices", ":deviceId", "databases")
        db.get(use: listDatabases)
        db.get(":dbId", "tables", use: listTables)
        db.get(":dbId", "tables", ":table", "schema", use: describeTable)
        db.get(":dbId", "tables", ":table", "rows", use: fetchTablePage)
        db.post(":dbId", "query", use: executeQuery)
    }

    public func handleEvent(_ event: PluginEventDTO, from deviceId: String) async {
        // 数据库插件接收响应事件
        if event.eventType == "db_response" {
            if let response = try? event.decodePayload(as: DBResponseDTO.self) {
                DBResponseManager.shared.handleResponse(response)
            }
        }
    }

    // MARK: - Route Handlers

    func listDatabases(req: Request) async throws -> DBListDatabasesResponseDTO {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        guard DeviceRegistry.shared.getSession(deviceId: deviceId) != nil else {
            throw Abort(.notFound, reason: "Device not connected")
        }

        let command = DBCommandDTO(
            requestId: UUID().uuidString,
            kind: .listDatabases,
            dbId: nil,
            table: nil,
            page: nil,
            pageSize: nil,
            orderBy: nil,
            ascending: nil
        )

        let response = try await sendCommandAndWaitResponse(command: command, to: deviceId, timeout: 10)
        guard response.success, let payload = response.payload else {
            throw Abort(.internalServerError, reason: response.error?.message ?? "Unknown error")
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(DBListDatabasesResponseDTO.self, from: payload)
    }

    func listTables(req: Request) async throws -> DBListTablesResponseDTO {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let dbId = req.parameters.get("dbId")
        else {
            throw Abort(.badRequest, reason: "Missing deviceId or dbId")
        }

        guard DeviceRegistry.shared.getSession(deviceId: deviceId) != nil else {
            throw Abort(.notFound, reason: "Device not connected")
        }

        let command = DBCommandDTO(
            requestId: UUID().uuidString,
            kind: .listTables,
            dbId: dbId,
            table: nil,
            page: nil,
            pageSize: nil,
            orderBy: nil,
            ascending: nil
        )

        let response = try await sendCommandAndWaitResponse(command: command, to: deviceId, timeout: 10)
        guard response.success, let payload = response.payload else {
            throw Abort(.internalServerError, reason: response.error?.message ?? "Unknown error")
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(DBListTablesResponseDTO.self, from: payload)
    }

    func describeTable(req: Request) async throws -> DBDescribeTableResponseDTO {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let dbId = req.parameters.get("dbId"),
            let table = req.parameters.get("table")
        else {
            throw Abort(.badRequest, reason: "Missing parameters")
        }

        guard DeviceRegistry.shared.getSession(deviceId: deviceId) != nil else {
            throw Abort(.notFound, reason: "Device not connected")
        }

        let command = DBCommandDTO(
            requestId: UUID().uuidString,
            kind: .describeTable,
            dbId: dbId,
            table: table,
            page: nil,
            pageSize: nil,
            orderBy: nil,
            ascending: nil
        )

        let response = try await sendCommandAndWaitResponse(command: command, to: deviceId, timeout: 10)
        guard response.success, let payload = response.payload else {
            throw Abort(.internalServerError, reason: response.error?.message ?? "Unknown error")
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(DBDescribeTableResponseDTO.self, from: payload)
    }

    func fetchTablePage(req: Request) async throws -> DBTablePageResultDTO {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let dbId = req.parameters.get("dbId"),
            let table = req.parameters.get("table")
        else {
            throw Abort(.badRequest, reason: "Missing parameters")
        }

        let page = req.query[Int.self, at: "page"] ?? 1
        let pageSize = min(req.query[Int.self, at: "pageSize"] ?? 50, 500)
        let orderBy = req.query[String.self, at: "orderBy"]
        let ascending = req.query[Bool.self, at: "ascending"] ?? true

        guard DeviceRegistry.shared.getSession(deviceId: deviceId) != nil else {
            throw Abort(.notFound, reason: "Device not connected")
        }

        let command = DBCommandDTO(
            requestId: UUID().uuidString,
            kind: .fetchTablePage,
            dbId: dbId,
            table: table,
            page: page,
            pageSize: pageSize,
            orderBy: orderBy,
            ascending: ascending
        )

        let response = try await sendCommandAndWaitResponse(command: command, to: deviceId, timeout: 15)
        guard response.success, let payload = response.payload else {
            let errorMsg = response.error?.message ?? "Unknown error"
            if errorMsg.contains("not found") {
                throw Abort(.notFound, reason: errorMsg)
            } else if errorMsg.contains("Access denied") || errorMsg.contains("sensitive") {
                throw Abort(.forbidden, reason: errorMsg)
            } else if errorMsg.contains("timeout") {
                throw Abort(.gatewayTimeout, reason: errorMsg)
            } else {
                throw Abort(.internalServerError, reason: errorMsg)
            }
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(DBTablePageResultDTO.self, from: payload)
    }

    func executeQuery(req: Request) async throws -> PluginDBQueryResponse {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let dbId = req.parameters.get("dbId")
        else {
            throw Abort(.badRequest, reason: "Missing parameters")
        }

        struct QueryInput: Content {
            let query: String
        }
        let input = try req.content.decode(QueryInput.self)

        guard DeviceRegistry.shared.getSession(deviceId: deviceId) != nil else {
            throw Abort(.notFound, reason: "Device not connected")
        }

        let command = DBCommandDTO(
            requestId: UUID().uuidString,
            kind: .executeQuery,
            dbId: dbId,
            table: nil,
            page: nil,
            pageSize: nil,
            orderBy: nil,
            ascending: nil,
            query: input.query
        )

        let response = try await sendCommandAndWaitResponse(command: command, to: deviceId, timeout: 30)
        guard response.success, let payload = response.payload else {
            throw Abort(.internalServerError, reason: response.error?.message ?? "Unknown error")
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(PluginDBQueryResponse.self, from: payload)
    }

    // MARK: - Helpers

    private func sendCommandAndWaitResponse(
        command: DBCommandDTO,
        to deviceId: String,
        timeout: TimeInterval
    ) async throws -> DBResponseDTO {
        try await withCheckedThrowingContinuation { continuation in
            DBResponseManager.shared.registerWaiter(
                requestId: command.requestId,
                timeout: timeout
            ) { response in
                if let response {
                    continuation.resume(returning: response)
                } else {
                    continuation.resume(throwing: Abort(.gatewayTimeout, reason: "DB command timeout"))
                }
            }

            let message = BridgeMessageDTO.dbCommand(command)
            DeviceRegistry.shared.sendMessage(to: deviceId, message: message)
        }
    }

    public func shutdown() async {
        state = .stopped
    }
}

// MARK: - Mock Backend Plugin

/// Mock 规则后端插件
public final class MockBackendPlugin: BackendPlugin, @unchecked Sendable {
    public let pluginId = BackendPluginId.mock
    public let displayName = "Mock"
    public let version = "1.0.0"
    public let pluginDescription = "Mock 规则管理后端"
    public let dependencies: [String] = [BackendPluginId.http]

    public private(set) var state: BackendPluginState = .uninitialized
    private var context: BackendPluginContext?

    public init() {}

    public func boot(context: BackendPluginContext) async throws {
        self.context = context
        state = .running
        context.logger.info("MockBackendPlugin booted")
    }

    public func registerRoutes(on routes: RoutesBuilder) throws {
        let mock = routes.grouped("devices", ":deviceId", "mock-rules")
        mock.get(use: listRules)
        mock.post(use: createRule)
        mock.put(":ruleId", use: updateRule)
        mock.delete(":ruleId", use: deleteRule)
    }

    public func handleEvent(_ event: PluginEventDTO, from deviceId: String) async {
        // Mock 插件不接收事件
    }

    func listRules(req: Request) async throws -> [MockRuleDTO] {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest)
        }

        let rules = try await MockRuleModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .all()

        return rules.map { $0.toDTO() }
    }

    func createRule(req: Request) async throws -> MockRuleDTO {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest)
        }

        let input = try req.content.decode(MockRuleDTO.self)
        let encoder = JSONEncoder()
        let conditionJSON = (try? String(data: encoder.encode(input.condition), encoding: .utf8)) ?? "{}"
        let actionJSON = (try? String(data: encoder.encode(input.action), encoding: .utf8)) ?? "{}"

        let model = MockRuleModel(
            id: UUID().uuidString,
            deviceId: deviceId,
            name: input.name,
            targetType: input.targetType,
            conditionJSON: conditionJSON,
            actionJSON: actionJSON,
            priority: input.priority,
            enabled: input.enabled
        )

        try await model.save(on: req.db)

        // 通知设备更新规则
        await syncRulesToDevice(deviceId: deviceId, db: req.db)

        return model.toDTO()
    }

    func updateRule(req: Request) async throws -> MockRuleDTO {
        guard
            let ruleId = req.parameters.get("ruleId"),
            let deviceId = req.parameters.get("deviceId")
        else {
            throw Abort(.badRequest)
        }

        guard let model = try await MockRuleModel.find(ruleId, on: req.db) else {
            throw Abort(.notFound)
        }

        let input = try req.content.decode(MockRuleDTO.self)
        let encoder = JSONEncoder()
        model.name = input.name
        model.targetType = input.targetType
        model.conditionJSON = (try? String(data: encoder.encode(input.condition), encoding: .utf8)) ?? "{}"
        model.actionJSON = (try? String(data: encoder.encode(input.action), encoding: .utf8)) ?? "{}"
        model.priority = input.priority
        model.enabled = input.enabled

        try await model.save(on: req.db)
        await syncRulesToDevice(deviceId: deviceId, db: req.db)

        return model.toDTO()
    }

    func deleteRule(req: Request) async throws -> HTTPStatus {
        guard
            let ruleId = req.parameters.get("ruleId"),
            let deviceId = req.parameters.get("deviceId")
        else {
            throw Abort(.badRequest)
        }

        try await MockRuleModel.query(on: req.db)
            .filter(\.$id == ruleId)
            .delete()

        await syncRulesToDevice(deviceId: deviceId, db: req.db)
        return .noContent
    }

    private func syncRulesToDevice(deviceId: String, db: Database) async {
        let rules = await (try? MockRuleModel.query(on: db)
            .filter(\.$deviceId == deviceId)
            .filter(\.$enabled == true)
            .all()) ?? []

        let ruleDTOs = rules.map { $0.toDTO() }

        do {
            let command = try PluginCommandDTO(
                pluginId: pluginId,
                commandType: "update_rules",
                encodable: ruleDTOs
            )
            await context?.sendCommand(command, to: deviceId)
        } catch {
            context?.logger.error("Failed to sync mock rules: \(error)")
        }
    }

    public func shutdown() async {
        state = .stopped
    }
}

// MARK: - Breakpoint Backend Plugin

/// 断点后端插件
public final class BreakpointBackendPlugin: BackendPlugin, @unchecked Sendable {
    public let pluginId = BackendPluginId.breakpoint
    public let displayName = "Breakpoint"
    public let version = "1.0.0"
    public let pluginDescription = "断点调试后端"
    public let dependencies: [String] = [BackendPluginId.http]

    public private(set) var state: BackendPluginState = .uninitialized
    private var context: BackendPluginContext?

    public init() {}

    public func boot(context: BackendPluginContext) async throws {
        self.context = context
        state = .running
        context.logger.info("BreakpointBackendPlugin booted")
    }

    public func registerRoutes(on routes: RoutesBuilder) throws {
        let bp = routes.grouped("devices", ":deviceId", "breakpoints")
        bp.get(use: listRules)
        bp.post(use: createRule)
        bp.put(":ruleId", use: updateRule)
        bp.delete(":ruleId", use: deleteRule)
        bp.get("pending", use: getPendingBreakpoints)
        bp.post("resume", ":requestId", use: resumeBreakpoint)
    }

    public func handleEvent(_ event: PluginEventDTO, from deviceId: String) async {
        if event.eventType == "breakpoint_hit" {
            // 解析断点命中事件
            if let hit = try? event.decodePayload(as: BreakpointHitDTO.self) {
                // 存储到 BreakpointManager
                BreakpointManager.shared.addPendingHit(hit)
            }
            // 广播断点命中事件到 WebUI
            context?.broadcastToWebUI(["type": "breakpoint_hit", "deviceId": deviceId], deviceId: deviceId)
        }
    }

    func listRules(req: Request) async throws -> [PluginBreakpointRuleDTO] {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest)
        }

        let rules = try await BreakpointRuleModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .sort(\.$priority, .descending)
            .all()

        return rules.map { PluginBreakpointRuleDTO(from: $0) }
    }

    func createRule(req: Request) async throws -> PluginBreakpointRuleDTO {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest)
        }

        let input = try req.content.decode(PluginBreakpointRuleInput.self)
        let model = BreakpointRuleModel(
            id: UUID().uuidString,
            deviceId: deviceId,
            name: input.name ?? "",
            urlPattern: input.urlPattern ?? "",
            method: input.method,
            phase: input.phase ?? "request",
            enabled: input.enabled ?? true,
            priority: input.priority ?? 0
        )

        try await model.save(on: req.db)
        await syncRulesToDevice(deviceId: deviceId, db: req.db)

        return PluginBreakpointRuleDTO(from: model)
    }

    func updateRule(req: Request) async throws -> PluginBreakpointRuleDTO {
        guard
            let ruleId = req.parameters.get("ruleId"),
            let deviceId = req.parameters.get("deviceId")
        else {
            throw Abort(.badRequest)
        }

        guard
            let model = try await BreakpointRuleModel.query(on: req.db)
                .filter(\.$id == ruleId)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound)
        }

        let input = try req.content.decode(PluginBreakpointRuleInput.self)
        if let name = input.name { model.name = name }
        if let urlPattern = input.urlPattern { model.urlPattern = urlPattern }
        if let method = input.method { model.method = method }
        if let phase = input.phase { model.phase = phase }
        if let enabled = input.enabled { model.enabled = enabled }
        if let priority = input.priority { model.priority = priority }

        try await model.save(on: req.db)
        await syncRulesToDevice(deviceId: deviceId, db: req.db)

        return PluginBreakpointRuleDTO(from: model)
    }

    func deleteRule(req: Request) async throws -> HTTPStatus {
        guard
            let ruleId = req.parameters.get("ruleId"),
            let deviceId = req.parameters.get("deviceId")
        else {
            throw Abort(.badRequest)
        }

        try await BreakpointRuleModel.query(on: req.db)
            .filter(\.$id == ruleId)
            .filter(\.$deviceId == deviceId)
            .delete()

        await syncRulesToDevice(deviceId: deviceId, db: req.db)
        return .noContent
    }

    func getPendingBreakpoints(req _: Request) async throws -> [BreakpointHitDTO] {
        BreakpointManager.shared.getPendingHits()
    }

    func resumeBreakpoint(req: Request) async throws -> HTTPStatus {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let requestId = req.parameters.get("requestId")
        else {
            throw Abort(.badRequest)
        }

        let action = try req.content.decode(BreakpointActionDTO.self)
        let breakpointId = BreakpointManager.shared.getPendingHits()
            .first { $0.requestId == requestId }?.breakpointId ?? ""

        let resume = BreakpointResumeDTO.from(
            requestId: requestId,
            breakpointId: breakpointId,
            actionDTO: action
        )

        DeviceRegistry.shared.sendMessage(to: deviceId, message: .breakpointResume(resume))
        BreakpointManager.shared.removePendingHit(requestId: requestId)

        return .ok
    }

    private func syncRulesToDevice(deviceId: String, db: Database) async {
        let rules = await (try? BreakpointRuleModel.query(on: db)
            .filter(\.$deviceId == deviceId)
            .filter(\.$enabled == true)
            .sort(\.$priority, .descending)
            .all()) ?? []

        let dtos = rules.map { $0.toDTO() }
        DeviceRegistry.shared.sendMessage(to: deviceId, message: .updateBreakpointRules(dtos))
    }

    public func shutdown() async {
        state = .stopped
    }
}

// MARK: - Chaos Backend Plugin

/// 故障注入后端插件
public final class ChaosBackendPlugin: BackendPlugin, @unchecked Sendable {
    public let pluginId = BackendPluginId.chaos
    public let displayName = "Chaos"
    public let version = "1.0.0"
    public let pluginDescription = "故障注入后端"
    public let dependencies: [String] = [BackendPluginId.http]

    public private(set) var state: BackendPluginState = .uninitialized
    private var context: BackendPluginContext?

    public init() {}

    public func boot(context: BackendPluginContext) async throws {
        self.context = context
        state = .running
        context.logger.info("ChaosBackendPlugin booted")
    }

    public func registerRoutes(on routes: RoutesBuilder) throws {
        let chaos = routes.grouped("devices", ":deviceId", "chaos")
        chaos.get(use: listRules)
        chaos.post(use: createRule)
        chaos.put(":ruleId", use: updateRule)
        chaos.delete(":ruleId", use: deleteRule)
    }

    public func handleEvent(_ event: PluginEventDTO, from deviceId: String) async {
        // Chaos 插件不接收事件，只接收命令下发
    }

    func listRules(req: Request) async throws -> [ChaosRuleDTO] {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest)
        }

        let rules = try await ChaosRuleModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .sort(\.$priority, .descending)
            .all()

        return rules.map { $0.toDTO() }
    }

    func createRule(req: Request) async throws -> ChaosRuleDTO {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest)
        }

        let input = try req.content.decode(PluginChaosRuleInput.self)
        guard let chaos = input.chaos else {
            throw Abort(.badRequest, reason: "Missing chaos type")
        }

        let encoder = JSONEncoder()
        let chaosJSON = try String(data: encoder.encode(chaos), encoding: .utf8) ?? "{}"

        let model = ChaosRuleModel(
            id: UUID().uuidString,
            deviceId: deviceId,
            name: input.name ?? "",
            urlPattern: input.urlPattern ?? "",
            method: input.method,
            probability: input.probability ?? 1.0,
            chaosJSON: chaosJSON,
            enabled: input.enabled ?? true,
            priority: input.priority ?? 0
        )

        try await model.save(on: req.db)
        await syncRulesToDevice(deviceId: deviceId, db: req.db)

        return model.toDTO()
    }

    func updateRule(req: Request) async throws -> ChaosRuleDTO {
        guard
            let ruleId = req.parameters.get("ruleId"),
            let deviceId = req.parameters.get("deviceId")
        else {
            throw Abort(.badRequest)
        }

        guard
            let model = try await ChaosRuleModel.query(on: req.db)
                .filter(\.$id == ruleId)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound)
        }

        let input = try req.content.decode(PluginChaosRuleInput.self)
        if let name = input.name { model.name = name }
        if let urlPattern = input.urlPattern { model.urlPattern = urlPattern }
        if let method = input.method { model.method = method }
        if let probability = input.probability { model.probability = probability }
        if let chaos = input.chaos {
            let encoder = JSONEncoder()
            let chaosJSON = try String(data: encoder.encode(chaos), encoding: .utf8) ?? "{}"
            model.chaosJSON = chaosJSON
        }
        if let enabled = input.enabled { model.enabled = enabled }
        if let priority = input.priority { model.priority = priority }

        try await model.save(on: req.db)
        await syncRulesToDevice(deviceId: deviceId, db: req.db)

        return model.toDTO()
    }

    func deleteRule(req: Request) async throws -> HTTPStatus {
        guard
            let ruleId = req.parameters.get("ruleId"),
            let deviceId = req.parameters.get("deviceId")
        else {
            throw Abort(.badRequest)
        }

        try await ChaosRuleModel.query(on: req.db)
            .filter(\.$id == ruleId)
            .filter(\.$deviceId == deviceId)
            .delete()

        await syncRulesToDevice(deviceId: deviceId, db: req.db)
        return .noContent
    }

    private func syncRulesToDevice(deviceId: String, db: Database) async {
        let rules = await (try? ChaosRuleModel.query(on: db)
            .filter(\.$deviceId == deviceId)
            .filter(\.$enabled == true)
            .sort(\.$priority, .descending)
            .all()) ?? []

        let dtos = rules.map { $0.toDTO() }
        DeviceRegistry.shared.sendMessage(to: deviceId, message: .updateChaosRules(dtos))
    }

    public func shutdown() async {
        state = .stopped
    }
}

// MARK: - Supporting DTOs

struct PluginLogEventListResponse: Content {
    let items: [PluginLogEventItemDTO]
    let total: Int
    let page: Int
    let pageSize: Int
}

struct PluginLogEventItemDTO: Content {
    let id: String
    let level: String
    let message: String
    let timestamp: Date
    let subsystem: String?
    let category: String?
    let seqNum: Int64

    init(from model: LogEventModel) {
        id = model.id ?? ""
        level = model.level
        message = model.message
        timestamp = model.timestamp
        subsystem = model.subsystem
        category = model.category
        seqNum = model.seqNum
    }
}

struct BatchLogDeleteInput: Content {
    let ids: [String]
}

struct BatchLogDeleteResponse: Content {
    let deleted: Int
}

struct DeleteAllLogsResponse: Content {
    let deleted: Int
}

struct DeleteAllWSSessionsResponse: Content {
    let deleted: Int
}

struct WSSessionDTO: Content {
    let id: String
    let url: String
    let connectTime: Date
    let disconnectTime: Date?
    let closeCode: Int?
    let closeReason: String?
    let isOpen: Bool

    init(from model: WSSessionModel) {
        id = model.id ?? ""
        url = model.url
        connectTime = model.connectTime
        disconnectTime = model.disconnectTime
        closeCode = model.closeCode
        closeReason = model.closeReason
        // 如果 disconnectTime 为 nil，则认为连接还在打开状态
        isOpen = model.disconnectTime == nil
    }
}

/// WebSocket 会话详情 DTO（包含帧数量）
struct WSSessionDetailDTO: Content {
    let id: String
    let url: String
    let requestHeaders: [String: String]
    let subprotocols: [String]
    let connectTime: Date
    let disconnectTime: Date?
    let closeCode: Int?
    let closeReason: String?
    let frameCount: Int

    init(from model: WSSessionModel, frameCount: Int) {
        id = model.id ?? ""
        url = model.url
        requestHeaders = (try? JSONDecoder().decode([String: String].self, from: Data(model.requestHeaders.utf8))) ??
            [:]
        subprotocols = (try? JSONDecoder().decode([String].self, from: Data(model.subprotocols.utf8))) ?? []
        connectTime = model.connectTime
        disconnectTime = model.disconnectTime
        closeCode = model.closeCode
        closeReason = model.closeReason
        self.frameCount = frameCount
    }
}

struct WSSessionListResponse: Content {
    let items: [WSSessionDTO]
    let total: Int
    let page: Int
    let pageSize: Int
}

struct WSFrameDTO: Content {
    let id: String
    let direction: String
    let opcode: String
    let payloadPreview: String?
    let payloadSize: Int
    let timestamp: Date
    let isMocked: Bool
    let seqNum: Int64

    init(from model: WSFrameModel) {
        id = model.id ?? ""
        direction = model.direction
        opcode = model.opcode
        payloadPreview = model.payloadPreview
        payloadSize = model.payload.count
        timestamp = model.timestamp
        isMocked = model.isMocked
        seqNum = model.seqNum
    }
}

/// WebSocket 帧详情 DTO（包含完整 payload）
struct WSFrameDetailDTO: Content {
    let id: String
    let sessionId: String
    let direction: String
    let opcode: String
    let payloadText: String?
    let payloadBase64: String
    let payloadSize: Int
    let timestamp: Date
    let isMocked: Bool

    init(from model: WSFrameModel) {
        id = model.id ?? ""
        sessionId = model.sessionId
        direction = model.direction
        opcode = model.opcode
        payloadSize = model.payload.count
        timestamp = model.timestamp
        isMocked = model.isMocked

        // Base64 编码的完整 payload
        payloadBase64 = model.payload.base64EncodedString()

        // 尝试 UTF-8 解码
        if let text = String(data: model.payload, encoding: .utf8) {
            payloadText = text
        } else {
            payloadText = nil
        }
    }
}

struct WSFrameListResponse: Content {
    let items: [WSFrameDTO]
    let total: Int
    let page: Int
    let pageSize: Int
}

struct DBListResponse: Content {
    let pending: Bool
    let databases: [PluginDBInfoDTO]
}

struct PluginDBInfoDTO: Content {
    let id: String
    let name: String
    let tableCount: Int
}

struct PluginDBTablesResponse: Content {
    let tables: [String]
}

struct PluginDBColumnInfo: Content {
    let name: String
    let type: String?
    let notNull: Bool
    let primaryKey: Bool
    let defaultValue: String?
}

struct PluginDBRow: Content {
    let values: [String: String?]
}

struct PluginDBQueryResponse: Content {
    let dbId: String
    let query: String
    let columns: [PluginDBColumnInfo]
    let rows: [PluginDBRow]
    let rowCount: Int
    let executionTimeMs: Double
}

struct PluginDBSQLResponse: Content {
    let success: Bool
    let affectedRows: Int?
}

// 使用 Plugin 前缀避免与现有 DTO 冲突
struct PluginMockRuleDTO: Content {
    let id: String
    let name: String
    let urlPattern: String
    let method: String?
    let responseStatus: Int
    let isEnabled: Bool

    init(from model: MockRuleModel) {
        id = model.id ?? ""
        name = model.name

        // 从 conditionJSON 解析 urlPattern 和 method
        let decoder = JSONDecoder()
        struct ConditionJSON: Decodable {
            let urlPattern: String?
            let method: String?
        }
        let condition = (try? decoder.decode(ConditionJSON.self, from: Data(model.conditionJSON.utf8)))
        urlPattern = condition?.urlPattern ?? ""
        method = condition?.method

        // 从 actionJSON 解析 responseStatus
        struct ActionJSON: Decodable {
            let statusCode: Int?
        }
        let action = (try? decoder.decode(ActionJSON.self, from: Data(model.actionJSON.utf8)))
        responseStatus = action?.statusCode ?? 200

        isEnabled = model.enabled
    }
}

struct PluginMockRuleInput: Content {
    let name: String
    let urlPattern: String
    let method: String?
    let responseStatus: Int
    let responseHeaders: String?
    let responseBody: Data?
    let isEnabled: Bool?
}

struct PluginBreakpointRuleDTO: Content {
    let id: String
    let name: String
    let urlPattern: String?
    let method: String?
    let phase: String
    let enabled: Bool
    let priority: Int

    init(from model: BreakpointRuleModel) {
        id = model.id ?? ""
        name = model.name
        urlPattern = model.urlPattern
        method = model.method
        phase = model.phase
        enabled = model.enabled
        priority = model.priority
    }
}

struct PluginBreakpointResumeInput: Content {
    let requestId: String
    let action: String
}

// MARK: - Input DTOs

struct PluginBreakpointRuleInput: Content {
    let name: String?
    let urlPattern: String?
    let method: String?
    let phase: String?
    let enabled: Bool?
    let priority: Int?
}

struct PluginChaosRuleInput: Content {
    let name: String?
    let urlPattern: String?
    let method: String?
    let probability: Double?
    let chaos: ChaosTypeDTO?
    let enabled: Bool?
    let priority: Int?
}
