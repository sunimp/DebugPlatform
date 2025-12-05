// DeviceRegistry.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Foundation
import Vapor

// MARK: - Device Info DTO

struct DeviceInfoDTO: Content {
    let deviceId: String
    let deviceName: String
    let systemName: String
    let systemVersion: String
    let appName: String
    let appVersion: String
    let buildNumber: String
    let platform: String
    var captureEnabled: Bool
    var logCaptureEnabled: Bool
}

// MARK: - Device Session

final class DeviceSession {
    let deviceInfo: DeviceInfoDTO
    let webSocket: WebSocket
    let connectedAt: Date
    let sessionId: String
    var lastSeenAt: Date

    init(deviceInfo: DeviceInfoDTO, webSocket: WebSocket, sessionId: String) {
        self.deviceInfo = deviceInfo
        self.webSocket = webSocket
        self.sessionId = sessionId
        connectedAt = Date()
        lastSeenAt = Date()
    }

    func updateLastSeen() {
        lastSeenAt = Date()
    }
}

// MARK: - Device Registry

final class DeviceRegistry: LifecycleHandler, @unchecked Sendable {
    static let shared = DeviceRegistry()

    private var sessions: [String: DeviceSession] = [:]
    private var pendingDisconnects: [String: DispatchWorkItem] = [:] // 延迟断开任务
    private let lock = NSLock()

    /// 延迟断开时间（秒）- 只有超过这个时间没有重连才认为真正断开
    /// 减少到 3 秒以配合更频繁的心跳检测
    private let disconnectDelay: TimeInterval = 3.0

    /// 数据库引用（由外部设置）
    var database: Database?

    /// 断开事件回调
    var onDeviceDisconnected: ((String) -> Void)?

    private init() {}

    // MARK: - LifecycleHandler

    func shutdown(_: Application) {
        lock.lock()
        // 取消所有挂起的断开任务
        for item in pendingDisconnects.values {
            item.cancel()
        }
        pendingDisconnects.removeAll()
        
        let currentSessions = Array(sessions.values)
        sessions.removeAll()
        lock.unlock()
        
        // 非阻塞关闭所有 WebSocket 连接
        for session in currentSessions {
            session.webSocket.close(code: .goingAway, promise: nil)
        }
        
        print("[DeviceRegistry] Shutdown complete")
    }

    // MARK: - Session Management

    func register(deviceInfo: DeviceInfoDTO, webSocket: WebSocket, sessionId: String) -> DeviceSession {
        lock.lock()

        // 取消待处理的断开任务（设备快速重连）
        if let pendingTask = pendingDisconnects[deviceInfo.deviceId] {
            pendingTask.cancel()
            pendingDisconnects.removeValue(forKey: deviceInfo.deviceId)
            print("[DeviceRegistry] Cancelled pending disconnect for \(deviceInfo.deviceId) - quick reconnect")
        }

        let session = DeviceSession(deviceInfo: deviceInfo, webSocket: webSocket, sessionId: sessionId)
        let isNewConnection = sessions[deviceInfo.deviceId] == nil
        sessions[deviceInfo.deviceId] = session
        lock.unlock()

        // 只有新连接（非快速重连）才记录到数据库
        if isNewConnection {
            Task {
                await self.recordSessionStart(deviceInfo: deviceInfo, sessionId: sessionId)
            }
        }

        return session
    }

    func unregister(deviceId: String) {
        lock.lock()
        let session = sessions[deviceId]
        sessions.removeValue(forKey: deviceId)

        // 创建延迟断开任务
        let workItem = DispatchWorkItem { [weak self] in
            self?.handleDelayedDisconnect(deviceId: deviceId, sessionId: session?.sessionId)
        }
        pendingDisconnects[deviceId] = workItem
        lock.unlock()

        // 延迟执行断开通知
        DispatchQueue.global().asyncAfter(deadline: .now() + disconnectDelay, execute: workItem)
        print("[DeviceRegistry] Scheduled delayed disconnect for \(deviceId) in \(disconnectDelay)s")
    }

    private func handleDelayedDisconnect(deviceId: String, sessionId: String?) {
        lock.lock()
        // 检查设备是否已重新连接
        if sessions[deviceId] != nil {
            pendingDisconnects.removeValue(forKey: deviceId)
            lock.unlock()
            print("[DeviceRegistry] Device \(deviceId) reconnected, skipping disconnect notification")
            return
        }
        pendingDisconnects.removeValue(forKey: deviceId)
        lock.unlock()

        // 真正的断开 - 记录到数据库并通知
        Task {
            await self.recordSessionEnd(deviceId: deviceId, sessionId: sessionId)
        }

        // 通知 WebUI
        onDeviceDisconnected?(deviceId)
        print("[DeviceRegistry] Device \(deviceId) confirmed disconnected")
    }

    // MARK: - Database Operations

    private func recordSessionStart(deviceInfo: DeviceInfoDTO, sessionId: String) async {
        guard let db = database else { return }

        let model = DeviceSessionModel(
            deviceId: deviceInfo.deviceId,
            deviceName: deviceInfo.deviceName,
            sessionId: sessionId,
            connectedAt: Date()
        )

        do {
            try await model.save(on: db)
            print("[DeviceRegistry] Session recorded: \(sessionId)")
        } catch {
            print("[DeviceRegistry] Failed to record session: \(error)")
        }
    }

    private func recordSessionEnd(deviceId: String, sessionId: String?) async {
        guard let db = database, let sessionId else { return }

        do {
            if
                let session = try await DeviceSessionModel.query(on: db)
                    .filter(\.$sessionId == sessionId)
                    .first() {
                session.disconnectedAt = Date()
                try await session.save(on: db)
                print("[DeviceRegistry] Session end recorded: \(sessionId)")
            }
        } catch {
            print("[DeviceRegistry] Failed to record session end: \(error)")
        }
    }

    /// 获取设备的会话历史
    func getSessionHistory(deviceId: String, limit: Int = 50) async -> [DeviceSessionModel] {
        guard let db = database else { return [] }

        do {
            return try await DeviceSessionModel.query(on: db)
                .filter(\DeviceSessionModel.$deviceId == deviceId)
                .sort(\DeviceSessionModel.$connectedAt, .descending)
                .limit(limit)
                .all()
        } catch {
            print("[DeviceRegistry] Failed to get session history: \(error)")
            return []
        }
    }

    func getSession(deviceId: String) -> DeviceSession? {
        lock.lock()
        defer { lock.unlock() }
        return sessions[deviceId]
    }

    func getAllSessions() -> [DeviceSession] {
        lock.lock()
        defer { lock.unlock() }
        return Array(sessions.values)
    }

    func getAllDevices() -> [DeviceInfoDTO] {
        getAllSessions().map(\.deviceInfo)
    }

    func isOnline(deviceId: String) -> Bool {
        getSession(deviceId: deviceId) != nil
    }

    // MARK: - Message Sending

    func sendMessage(to deviceId: String, message: BridgeMessageDTO) {
        guard let session = getSession(deviceId: deviceId) else { return }

        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(message)

            session.webSocket.send([UInt8](data))
        } catch {
            print("[DeviceRegistry] Failed to send message: \(error)")
        }
    }

    func broadcast(message: BridgeMessageDTO) {
        for session in getAllSessions() {
            do {
                let encoder = JSONEncoder()
                encoder.dateEncodingStrategy = .iso8601
                let data = try encoder.encode(message)
                session.webSocket.send([UInt8](data))
            } catch {
                print("[DeviceRegistry] Failed to broadcast: \(error)")
            }
        }
    }
}

// MARK: - Bridge Message DTO

enum BridgeMessageDTO: Codable {
    case register(DeviceInfoDTO, token: String)
    case heartbeat
    case events([DebugEventDTO])
    case registered(sessionId: String)
    case toggleCapture(network: Bool, log: Bool)
    case updateMockRules([MockRuleDTO])
    case requestExport(timeFrom: Date, timeTo: Date, types: [String])
    case replayRequest(ReplayRequestPayload)
    // 断点相关
    case updateBreakpointRules([BreakpointRuleDTO])
    case breakpointHit(BreakpointHitDTO)
    case breakpointResume(BreakpointResumeDTO)
    // 故障注入相关
    case updateChaosRules([ChaosRuleDTO])
    // 数据库检查相关
    case dbCommand(DBCommandDTO)
    case dbResponse(DBResponseDTO)
    case error(code: Int, message: String)

    private enum CodingKeys: String, CodingKey {
        case type
        case payload
    }

    private enum MessageType: String, Codable {
        case register
        case heartbeat
        case events
        case registered
        case toggleCapture
        case updateMockRules
        case requestExport
        case replayRequest
        case updateBreakpointRules
        case breakpointHit
        case breakpointResume
        case updateChaosRules
        case dbCommand
        case dbResponse
        case error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(MessageType.self, forKey: .type)

        switch type {
        case .register:
            let payload = try container.decode(RegisterPayload.self, forKey: .payload)
            self = .register(payload.deviceInfo, token: payload.token)
        case .heartbeat:
            self = .heartbeat
        case .events:
            let events = try container.decode([DebugEventDTO].self, forKey: .payload)
            self = .events(events)
        case .registered:
            let payload = try container.decode(RegisteredPayload.self, forKey: .payload)
            self = .registered(sessionId: payload.sessionId)
        case .toggleCapture:
            let payload = try container.decode(ToggleCapturePayload.self, forKey: .payload)
            self = .toggleCapture(network: payload.network, log: payload.log)
        case .updateMockRules:
            let rules = try container.decode([MockRuleDTO].self, forKey: .payload)
            self = .updateMockRules(rules)
        case .requestExport:
            let payload = try container.decode(ExportPayload.self, forKey: .payload)
            self = .requestExport(timeFrom: payload.timeFrom, timeTo: payload.timeTo, types: payload.types)
        case .replayRequest:
            let payload = try container.decode(ReplayRequestPayload.self, forKey: .payload)
            self = .replayRequest(payload)
        case .updateBreakpointRules:
            let rules = try container.decode([BreakpointRuleDTO].self, forKey: .payload)
            self = .updateBreakpointRules(rules)
        case .breakpointHit:
            let payload = try container.decode(BreakpointHitDTO.self, forKey: .payload)
            self = .breakpointHit(payload)
        case .breakpointResume:
            let payload = try container.decode(BreakpointResumeDTO.self, forKey: .payload)
            self = .breakpointResume(payload)
        case .updateChaosRules:
            let rules = try container.decode([ChaosRuleDTO].self, forKey: .payload)
            self = .updateChaosRules(rules)
        case .dbCommand:
            let command = try container.decode(DBCommandDTO.self, forKey: .payload)
            self = .dbCommand(command)
        case .dbResponse:
            let response = try container.decode(DBResponseDTO.self, forKey: .payload)
            self = .dbResponse(response)
        case .error:
            let payload = try container.decode(ErrorPayload.self, forKey: .payload)
            self = .error(code: payload.code, message: payload.message)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case let .register(deviceInfo, token):
            try container.encode(MessageType.register, forKey: .type)
            try container.encode(RegisterPayload(deviceInfo: deviceInfo, token: token), forKey: .payload)
        case .heartbeat:
            try container.encode(MessageType.heartbeat, forKey: .type)
        case let .events(events):
            try container.encode(MessageType.events, forKey: .type)
            try container.encode(events, forKey: .payload)
        case let .registered(sessionId):
            try container.encode(MessageType.registered, forKey: .type)
            try container.encode(RegisteredPayload(sessionId: sessionId), forKey: .payload)
        case let .toggleCapture(network, log):
            try container.encode(MessageType.toggleCapture, forKey: .type)
            try container.encode(ToggleCapturePayload(network: network, log: log), forKey: .payload)
        case let .updateMockRules(rules):
            try container.encode(MessageType.updateMockRules, forKey: .type)
            try container.encode(rules, forKey: .payload)
        case let .requestExport(timeFrom, timeTo, types):
            try container.encode(MessageType.requestExport, forKey: .type)
            try container.encode(ExportPayload(timeFrom: timeFrom, timeTo: timeTo, types: types), forKey: .payload)
        case let .replayRequest(payload):
            try container.encode(MessageType.replayRequest, forKey: .type)
            try container.encode(payload, forKey: .payload)
        case let .updateBreakpointRules(rules):
            try container.encode(MessageType.updateBreakpointRules, forKey: .type)
            try container.encode(rules, forKey: .payload)
        case let .breakpointHit(payload):
            try container.encode(MessageType.breakpointHit, forKey: .type)
            try container.encode(payload, forKey: .payload)
        case let .breakpointResume(payload):
            try container.encode(MessageType.breakpointResume, forKey: .type)
            try container.encode(payload, forKey: .payload)
        case let .updateChaosRules(rules):
            try container.encode(MessageType.updateChaosRules, forKey: .type)
            try container.encode(rules, forKey: .payload)
        case let .dbCommand(command):
            try container.encode(MessageType.dbCommand, forKey: .type)
            try container.encode(command, forKey: .payload)
        case let .dbResponse(response):
            try container.encode(MessageType.dbResponse, forKey: .type)
            try container.encode(response, forKey: .payload)
        case let .error(code, message):
            try container.encode(MessageType.error, forKey: .type)
            try container.encode(ErrorPayload(code: code, message: message), forKey: .payload)
        }
    }
}

// Payload types
private struct RegisterPayload: Codable {
    let deviceInfo: DeviceInfoDTO
    let token: String
}

private struct RegisteredPayload: Codable {
    let sessionId: String
}

private struct ToggleCapturePayload: Codable {
    let network: Bool
    let log: Bool
}

private struct ExportPayload: Codable {
    let timeFrom: Date
    let timeTo: Date
    let types: [String]
}

private struct ErrorPayload: Codable {
    let code: Int
    let message: String
}

struct ReplayRequestPayload: Codable {
    let id: String
    let method: String
    let url: String
    let headers: [String: String]
    let body: String? // base64 encoded
}

// MARK: - Breakpoint DTOs

struct BreakpointRuleDTO: Content {
    let id: String
    var name: String
    var urlPattern: String?
    var method: String?
    var phase: String // "request", "response", "both"
    var enabled: Bool
    var priority: Int
}

struct BreakpointHitDTO: Content {
    let breakpointId: String
    let requestId: String
    let phase: String
    let timestamp: Date
    let request: BreakpointRequestSnapshotDTO
    let response: BreakpointResponseSnapshotDTO?
}

struct BreakpointRequestSnapshotDTO: Content {
    var method: String
    var url: String
    var headers: [String: String]
    var body: String? // base64
}

struct BreakpointResponseSnapshotDTO: Content {
    var statusCode: Int
    var headers: [String: String]
    var body: String? // base64
}

struct BreakpointResumeDTO: Content {
    let breakpointId: String
    let requestId: String
    let action: String  // "continue", "abort", "modify", "mockResponse"
    let modifiedRequest: ModifiedRequestDTO?
    let modifiedResponse: ModifiedResponseDTO?  // 添加响应修改支持
    
    init(breakpointId: String = "", requestId: String, action: String, modifiedRequest: ModifiedRequestDTO? = nil, modifiedResponse: ModifiedResponseDTO? = nil) {
        self.breakpointId = breakpointId
        self.requestId = requestId
        self.action = action
        self.modifiedRequest = modifiedRequest
        self.modifiedResponse = modifiedResponse
    }
    
    /// 从 BreakpointActionDTO 创建 BreakpointResumeDTO
    static func from(requestId: String, breakpointId: String = "", actionDTO: BreakpointActionDTO) -> BreakpointResumeDTO {
        var modifiedRequest: ModifiedRequestDTO? = nil
        var modifiedResponse: ModifiedResponseDTO? = nil
        
        // 处理请求修改
        if let modification = actionDTO.modification?.request {
            modifiedRequest = ModifiedRequestDTO(
                method: modification.method,
                url: modification.url,
                headers: modification.headers,
                body: modification.body
            )
        }
        
        // 处理响应修改（包括 mockResponse）
        if let modification = actionDTO.modification?.response {
            modifiedResponse = ModifiedResponseDTO(
                statusCode: modification.statusCode,
                headers: modification.headers,
                body: modification.body
            )
        } else if let mock = actionDTO.mockResponse {
            modifiedResponse = ModifiedResponseDTO(
                statusCode: mock.statusCode,
                headers: mock.headers,
                body: mock.body
            )
        }
        
        return BreakpointResumeDTO(
            breakpointId: breakpointId,
            requestId: requestId,
            action: actionDTO.type,
            modifiedRequest: modifiedRequest,
            modifiedResponse: modifiedResponse
        )
    }
}

struct ModifiedRequestDTO: Content {
    let method: String?
    let url: String?
    let headers: [String: String]?
    let body: String?  // base64 encoded
}

struct ModifiedResponseDTO: Content {
    let statusCode: Int?
    let headers: [String: String]?
    let body: String?  // base64 encoded
}

struct BreakpointActionDTO: Content {
    let type: String // "resume", "modify", "abort", "mockResponse"
    let modification: BreakpointModificationDTO?
    let mockResponse: BreakpointResponseSnapshotDTO?
}

struct BreakpointModificationDTO: Content {
    var request: BreakpointRequestSnapshotDTO?
    var response: BreakpointResponseSnapshotDTO?
}

// MARK: - Chaos DTOs

struct ChaosRuleDTO: Content {
    let id: String
    var name: String
    var urlPattern: String?
    var method: String?
    var probability: Double
    var chaos: ChaosTypeDTO
    var enabled: Bool
    var priority: Int
}

struct ChaosTypeDTO: Content {
    let type: String // "latency", "timeout", "connectionReset", "randomError", "corruptResponse", "slowNetwork",
    // "dropRequest"
    var minLatency: Int?
    var maxLatency: Int?
    var errorCodes: [Int]?
    var bytesPerSecond: Int?
}
