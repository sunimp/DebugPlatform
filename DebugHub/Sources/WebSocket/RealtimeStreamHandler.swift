// RealtimeStreamHandler.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Foundation
import Vapor

/// 实时流消息类型
struct RealtimeMessage: Content {
    enum MessageType: String, Codable {
        case httpEvent
        case wsEvent
        case logEvent
        case stats
        case deviceConnected
        case deviceDisconnected
        case breakpointHit
    }

    let type: MessageType
    let deviceId: String
    let payload: String // JSON string
}

/// 设备会话事件
struct DeviceSessionEvent: Content {
    let sessionId: String
    let deviceId: String
    let deviceName: String
    let timestamp: Date
}

/// 订阅者信息
struct StreamSubscriber {
    let deviceId: String?
    let types: Set<RealtimeMessage.MessageType>
    let webSocket: WebSocket
}

/// 实时流 WebSocket 处理器
final class RealtimeStreamHandler: LifecycleHandler, @unchecked Sendable {
    static let shared = RealtimeStreamHandler()

    private var subscribers: [ObjectIdentifier: StreamSubscriber] = [:]
    private let lock = NSLock()

    private init() {}

    // MARK: - LifecycleHandler

    func shutdown(_: Application) {
        lock.lock()
        let currentSubscribers = Array(subscribers.values)
        subscribers.removeAll()
        lock.unlock()

        // 非阻塞关闭所有 WebSocket 连接
        for subscriber in currentSubscribers {
            subscriber.webSocket.close(code: .goingAway, promise: nil)
        }
        
        print("[RealtimeStream] Shutdown complete")
    }

    // MARK: - Connection Handling

    func handleConnection(req: Request, ws: WebSocket) {
        // 解析查询参数
        let deviceId = req.query[String.self, at: "deviceId"]
        let typeParam = req.query[String.self, at: "type"] ?? "both"

        var types: Set<RealtimeMessage.MessageType> = []
        switch typeParam {
        case "network":
            types = [.httpEvent, .wsEvent]
        case "log":
            types = [.logEvent]
        case "both", "all":
            types = [.httpEvent, .wsEvent, .logEvent, .stats, .breakpointHit]
        default:
            types = [.httpEvent, .wsEvent, .logEvent, .breakpointHit]
        }

        let subscriber = StreamSubscriber(deviceId: deviceId, types: types, webSocket: ws)
        let id = ObjectIdentifier(ws)

        lock.lock()
        subscribers[id] = subscriber
        lock.unlock()

        print("[RealtimeStream] New subscriber: deviceId=\(deviceId ?? "all"), types=\(types)")

        ws.onClose.whenComplete { [weak self] _ in
            self?.lock.lock()
            self?.subscribers.removeValue(forKey: id)
            self?.lock.unlock()
            print("[RealtimeStream] Subscriber disconnected")
        }
    }

    /// 广播设备连接事件
    func broadcastDeviceConnected(deviceId: String, deviceName: String, sessionId: String) {
        let event = DeviceSessionEvent(
            sessionId: sessionId,
            deviceId: deviceId,
            deviceName: deviceName,
            timestamp: Date()
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601

        guard
            let payloadData = try? encoder.encode(event),
            let payload = String(data: payloadData, encoding: .utf8) else {
            return
        }

        let message = RealtimeMessage(type: .deviceConnected, deviceId: deviceId, payload: payload)
        broadcastMessage(message)
        print("[RealtimeStream] Broadcasted device connected: \(deviceName)")
    }

    /// 广播设备断开事件
    func broadcastDeviceDisconnected(deviceId: String) {
        let event = DeviceSessionEvent(
            sessionId: "",
            deviceId: deviceId,
            deviceName: "",
            timestamp: Date()
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601

        guard
            let payloadData = try? encoder.encode(event),
            let payload = String(data: payloadData, encoding: .utf8) else {
            return
        }

        let message = RealtimeMessage(type: .deviceDisconnected, deviceId: deviceId, payload: payload)
        broadcastMessage(message)
        print("[RealtimeStream] Broadcasted device disconnected: \(deviceId)")
    }

    /// 广播断点命中事件
    func broadcastBreakpointHit(_ hit: BreakpointHitDTO, deviceId: String) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601

        guard
            let payloadData = try? encoder.encode(hit),
            let payload = String(data: payloadData, encoding: .utf8) else {
            return
        }

        let message = RealtimeMessage(type: .breakpointHit, deviceId: deviceId, payload: payload)
        broadcastMessage(message)
        print("[RealtimeStream] Broadcasted breakpoint hit: requestId=\(hit.requestId)")
    }

    /// 广播单个消息给所有相关订阅者
    private func broadcastMessage(_ message: RealtimeMessage) {
        lock.lock()
        let currentSubscribers = Array(subscribers.values)
        lock.unlock()

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601

        for subscriber in currentSubscribers {
            // 检查设备过滤
            if let subscriberDeviceId = subscriber.deviceId, subscriberDeviceId != message.deviceId {
                continue
            }

            // 发送消息
            do {
                let data = try encoder.encode(message)
                if let text = String(data: data, encoding: .utf8) {
                    subscriber.webSocket.send(text)
                }
            } catch {
                print("[RealtimeStream] Failed to send message: \(error)")
            }
        }
    }

    func broadcast(events: [DebugEventDTO], deviceId: String) {
        lock.lock()
        let currentSubscribers = Array(subscribers.values)
        lock.unlock()

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601

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
        if wsCount > 0 {
            print("[RealtimeStream] Broadcasting events: http=\(httpCount), ws=\(wsCount), log=\(logCount), stats=\(statsCount), subscribers=\(currentSubscribers.count)")
        }

        for event in events {
            let messageType: RealtimeMessage.MessageType
            let payloadJSON: String

            do {
                switch event {
                case let .http(httpEvent):
                    messageType = .httpEvent
                    payloadJSON = try String(data: encoder.encode(httpEvent), encoding: .utf8) ?? "{}"

                case let .webSocket(wsEvent):
                    messageType = .wsEvent
                    payloadJSON = try String(data: encoder.encode(wsEvent), encoding: .utf8) ?? "{}"
                    print("[RealtimeStream] WS event payload: \(payloadJSON.prefix(200))...")

                case let .log(logEvent):
                    messageType = .logEvent
                    payloadJSON = try String(data: encoder.encode(logEvent), encoding: .utf8) ?? "{}"

                case let .stats(statsEvent):
                    messageType = .stats
                    payloadJSON = try String(data: encoder.encode(statsEvent), encoding: .utf8) ?? "{}"
                }
            } catch {
                print("[RealtimeStream] Failed to encode event: \(error)")
                continue
            }

            let message = RealtimeMessage(type: messageType, deviceId: deviceId, payload: payloadJSON)

            for subscriber in currentSubscribers {
                // 检查设备过滤
                if let subscriberDeviceId = subscriber.deviceId, subscriberDeviceId != deviceId {
                    continue
                }

                // 检查类型过滤
                guard subscriber.types.contains(messageType) else {
                    continue
                }

                // 发送消息（使用文本格式以兼容浏览器 WebSocket）
                do {
                    let data = try encoder.encode(message)
                    if let text = String(data: data, encoding: .utf8) {
                        subscriber.webSocket.send(text)
                    }
                } catch {
                    print("[RealtimeStream] Failed to send message: \(error)")
                }
            }
        }
    }
}
