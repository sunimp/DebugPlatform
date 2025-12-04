// DebugBridgeHandler.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Foundation
import Vapor

/// 线程安全的设备 ID 容器
private final class DeviceIdHolder: @unchecked Sendable {
    private var _deviceId: String?
    private let lock = NSLock()

    var deviceId: String? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return _deviceId
        }
        set {
            lock.lock()
            defer { lock.unlock() }
            _deviceId = newValue
        }
    }
}

/// Debug Bridge WebSocket 连接处理器
final class DebugBridgeHandler: @unchecked Sendable {
    static let shared = DebugBridgeHandler()

    // 认证 Token（可配置）
    private let validToken = ProcessInfo.processInfo.environment["DEBUG_HUB_TOKEN"] ?? "debug-token-2025"

    private init() {}

    func handleConnection(req: Request, ws: WebSocket) {
        let deviceIdHolder = DeviceIdHolder()

        print("[DebugBridge] New WebSocket connection from \(req.remoteAddress?.description ?? "unknown")")

        ws.onBinary { [weak self] ws, buffer in
            guard let self else { return }

            let data = Data(buffer: buffer)
            handleMessage(data: data, ws: ws, req: req, deviceIdHolder: deviceIdHolder)
        }

        ws.onText { [weak self] ws, text in
            guard let self else { return }

            let data = Data(text.utf8)
            handleMessage(data: data, ws: ws, req: req, deviceIdHolder: deviceIdHolder)
        }

        ws.onClose.whenComplete { [weak self] result in
            switch result {
            case .success:
                print("[DebugBridge] WebSocket closed normally")
            case let .failure(error):
                print("[DebugBridge] WebSocket closed with error: \(error)")
            }
            if let deviceId = deviceIdHolder.deviceId {
                self?.handleDisconnect(deviceId: deviceId)
            }
        }
    }

    private func handleMessage(data: Data, ws: WebSocket, req: Request, deviceIdHolder: DeviceIdHolder) {
        do {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let message = try decoder.decode(BridgeMessageDTO.self, from: data)

            switch message {
            case let .register(deviceInfo, token):
                print("[DebugBridge] Received register message from \(deviceInfo.deviceName)")
                handleRegister(deviceInfo: deviceInfo, token: token, ws: ws, deviceIdHolder: deviceIdHolder, req: req)

            case .heartbeat:
                print("[DebugBridge] Received heartbeat from \(deviceIdHolder.deviceId ?? "unknown")")
                handleHeartbeat(deviceId: deviceIdHolder.deviceId)

            case let .events(events):
                if let deviceId = deviceIdHolder.deviceId {
                    // 统计事件类型
                    var httpCount = 0, wsCount = 0, logCount = 0, statsCount = 0
                    for event in events {
                        switch event {
                        case .http: httpCount += 1
                        case .webSocket: wsCount += 1
                        case .log: logCount += 1
                        case .stats: statsCount += 1
                        }
                    }
                    print("[DebugBridge] Received \(events.count) events from \(deviceId): http=\(httpCount), ws=\(wsCount), log=\(logCount), stats=\(statsCount)")
                    handleEvents(events: events, deviceId: deviceId, req: req)
                }

            case let .breakpointHit(hit):
                if let deviceId = deviceIdHolder.deviceId {
                    print("[DebugBridge] Received breakpoint hit from \(deviceId): requestId=\(hit.requestId)")
                    handleBreakpointHit(hit: hit, deviceId: deviceId)
                }

            default:
                print("[DebugBridge] Received unknown message type")
            }
        } catch {
            req.logger.error("Failed to decode bridge message: \(error)")
            print("[DebugBridge] Failed to decode message: \(error)")
            sendError(ws: ws, code: 400, message: "Invalid message format")
        }
    }

    private func handleRegister(
        deviceInfo: DeviceInfoDTO,
        token: String,
        ws: WebSocket,
        deviceIdHolder: DeviceIdHolder,
        req: Request
    ) {
        // 验证 token
        guard token == validToken else {
            sendError(ws: ws, code: 401, message: "Invalid token")
            _ = ws.close()
            return
        }

        // 生成会话 ID
        let sessionId = UUID().uuidString

        // 注册设备
        let session = DeviceRegistry.shared.register(deviceInfo: deviceInfo, webSocket: ws, sessionId: sessionId)
        deviceIdHolder.deviceId = deviceInfo.deviceId

        // 发送注册成功响应
        let response = BridgeMessageDTO.registered(sessionId: sessionId)
        sendMessage(ws: ws, message: response)

        print("[DebugBridge] Device registered: \(deviceInfo.deviceName) (\(deviceInfo.deviceId))")

        // 广播设备连接事件给 WebUI（只有首次连接才广播，快速重连不广播）
        RealtimeStreamHandler.shared.broadcastDeviceConnected(
            deviceId: deviceInfo.deviceId,
            deviceName: deviceInfo.deviceName,
            sessionId: sessionId
        )

        // 发送当前的规则
        Task {
            await sendCurrentRules(to: deviceInfo.deviceId, session: session, db: req.db)
        }
    }

    private func handleHeartbeat(deviceId: String?) {
        guard
            let deviceId,
            let session = DeviceRegistry.shared.getSession(deviceId: deviceId) else {
            return
        }
        session.updateLastSeen()
    }

    private func handleEvents(events: [DebugEventDTO], deviceId: String, req: Request) {
        // 异步处理事件入库
        Task {
            await EventIngestor.shared.ingest(events: events, deviceId: deviceId, db: req.db)

            // 广播给实时流订阅者
            RealtimeStreamHandler.shared.broadcast(events: events, deviceId: deviceId)
        }
    }

    private func handleBreakpointHit(hit: BreakpointHitDTO, deviceId: String) {
        // 添加到 pending hits
        BreakpointManager.shared.addPendingHit(hit)
        
        // 广播给 WebUI
        RealtimeStreamHandler.shared.broadcastBreakpointHit(hit, deviceId: deviceId)
    }

    private func handleDisconnect(deviceId: String) {
        // 注销设备（DeviceRegistry 会处理延迟断开逻辑）
        DeviceRegistry.shared.unregister(deviceId: deviceId)
        print("[DebugBridge] Device WebSocket closed: \(deviceId) (delayed disconnect pending)")
        // 注意：断开事件由 DeviceRegistry 的延迟机制广播，不在这里直接广播
    }

    private func sendCurrentRules(to deviceId: String, session: DeviceSession, db: Database) async {
        // 发送 Mock 规则
        let mockRules = await loadMockRules(deviceId: deviceId, db: db)
        if !mockRules.isEmpty {
            let message = BridgeMessageDTO.updateMockRules(mockRules)
            sendMessage(ws: session.webSocket, message: message)
            print("[DebugBridge] Sent \(mockRules.count) mock rules to \(deviceId)")
        }

        // 发送断点规则
        let breakpointRules = await loadBreakpointRules(deviceId: deviceId, db: db)
        if !breakpointRules.isEmpty {
            let message = BridgeMessageDTO.updateBreakpointRules(breakpointRules)
            sendMessage(ws: session.webSocket, message: message)
            print("[DebugBridge] Sent \(breakpointRules.count) breakpoint rules to \(deviceId)")
        }

        // 发送混沌规则
        let chaosRules = await loadChaosRules(deviceId: deviceId, db: db)
        if !chaosRules.isEmpty {
            let message = BridgeMessageDTO.updateChaosRules(chaosRules)
            sendMessage(ws: session.webSocket, message: message)
            print("[DebugBridge] Sent \(chaosRules.count) chaos rules to \(deviceId)")
        }
    }

    private func loadMockRules(deviceId: String, db: Database) async -> [MockRuleDTO] {
        do {
            let rules = try await MockRuleModel.query(on: db)
                .filter(\.$deviceId == deviceId)
                .filter(\.$enabled == true)
                .sort(\.$priority, .descending)
                .all()
            return rules.map { $0.toDTO() }
        } catch {
            print("[DebugBridge] Failed to load mock rules: \(error)")
            return []
        }
    }

    private func loadBreakpointRules(deviceId: String, db: Database) async -> [BreakpointRuleDTO] {
        do {
            let rules = try await BreakpointRuleModel.query(on: db)
                .filter(\.$deviceId == deviceId)
                .filter(\.$enabled == true)
                .sort(\.$priority, .descending)
                .all()
            return rules.map { $0.toDTO() }
        } catch {
            print("[DebugBridge] Failed to load breakpoint rules: \(error)")
            return []
        }
    }

    private func loadChaosRules(deviceId: String, db: Database) async -> [ChaosRuleDTO] {
        do {
            let rules = try await ChaosRuleModel.query(on: db)
                .filter(\.$deviceId == deviceId)
                .filter(\.$enabled == true)
                .sort(\.$priority, .descending)
                .all()
            return rules.map { $0.toDTO() }
        } catch {
            print("[DebugBridge] Failed to load chaos rules: \(error)")
            return []
        }
    }

    // MARK: - Public API

    /// 向设备发送请求重放指令
    func sendReplayCommand(deviceId: String, command: ReplayCommand) async -> Bool {
        guard let session = DeviceRegistry.shared.getSession(deviceId: deviceId) else {
            return false
        }

        let payload = ReplayRequestPayload(
            id: command.id,
            method: command.method,
            url: command.url,
            headers: command.headers,
            body: command.body
        )

        let message = BridgeMessageDTO.replayRequest(payload)
        sendMessage(ws: session.webSocket, message: message)
        return true
    }

    private func sendMessage(ws: WebSocket, message: BridgeMessageDTO) {
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(message)

            // 使用文本格式发送，而非二进制，提高兼容性
            if let text = String(data: data, encoding: .utf8) {
                ws.send(text)
                print("[DebugBridge] Sent message: \(text.prefix(200))...")
            } else {
                ws.send([UInt8](data))
            }
        } catch {
            print("[DebugBridge] Failed to encode message: \(error)")
        }
    }

    private func sendError(ws: WebSocket, code: Int, message: String) {
        let error = BridgeMessageDTO.error(code: code, message: message)
        sendMessage(ws: ws, message: error)
    }
}
