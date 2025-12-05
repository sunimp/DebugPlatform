// BridgeMessage.swift
// DebugPlatform
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Foundation

/// Debug Bridge 通信协议消息
public enum BridgeMessage: Codable {
    // MARK: - 客户端 -> 服务端

    /// 设备注册
    case register(DeviceInfo, token: String)

    /// 心跳
    case heartbeat

    /// 批量事件上报
    case events([DebugEvent])

    /// 断点命中通知
    case breakpointHit(BreakpointHit)

    // MARK: - 服务端 -> 客户端

    /// 注册成功响应
    case registered(sessionId: String)

    /// 开关控制
    case toggleCapture(network: Bool, log: Bool)

    /// 更新 Mock 规则
    case updateMockRules([MockRule])

    /// 请求导出数据
    case requestExport(timeFrom: Date, timeTo: Date, types: [String])
    
    /// 重放请求
    case replayRequest(ReplayRequestPayload)
    
    /// 更新断点规则
    case updateBreakpointRules([BreakpointRule])
    
    /// 断点恢复
    case breakpointResume(BreakpointResumePayload)
    
    /// 更新故障注入规则
    case updateChaosRules([ChaosRule])
    
    /// 数据库命令
    case dbCommand(DBCommand)
    
    /// 数据库响应
    case dbResponse(DBResponse)

    /// 错误响应
    case error(code: Int, message: String)

    // MARK: - Coding

    private enum CodingKeys: String, CodingKey {
        case type
        case payload
    }

    private enum MessageType: String, Codable {
        case register
        case heartbeat
        case events
        case breakpointHit
        case registered
        case toggleCapture
        case updateMockRules
        case requestExport
        case replayRequest
        case updateBreakpointRules
        case breakpointResume
        case updateChaosRules
        case dbCommand
        case dbResponse
        case error
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(MessageType.self, forKey: .type)

        switch type {
        case .register:
            let payload = try container.decode(RegisterPayload.self, forKey: .payload)
            self = .register(payload.deviceInfo, token: payload.token)
        case .heartbeat:
            self = .heartbeat
        case .events:
            let events = try container.decode([DebugEvent].self, forKey: .payload)
            self = .events(events)
        case .breakpointHit:
            let hit = try container.decode(BreakpointHit.self, forKey: .payload)
            self = .breakpointHit(hit)
        case .registered:
            let payload = try container.decode(RegisteredPayload.self, forKey: .payload)
            self = .registered(sessionId: payload.sessionId)
        case .toggleCapture:
            let payload = try container.decode(ToggleCapturePayload.self, forKey: .payload)
            self = .toggleCapture(network: payload.network, log: payload.log)
        case .updateMockRules:
            let rules = try container.decode([MockRule].self, forKey: .payload)
            self = .updateMockRules(rules)
        case .requestExport:
            let payload = try container.decode(ExportPayload.self, forKey: .payload)
            self = .requestExport(timeFrom: payload.timeFrom, timeTo: payload.timeTo, types: payload.types)
        case .replayRequest:
            let payload = try container.decode(ReplayRequestPayload.self, forKey: .payload)
            self = .replayRequest(payload)
        case .updateBreakpointRules:
            let rules = try container.decode([BreakpointRule].self, forKey: .payload)
            self = .updateBreakpointRules(rules)
        case .breakpointResume:
            let payload = try container.decode(BreakpointResumePayload.self, forKey: .payload)
            self = .breakpointResume(payload)
        case .updateChaosRules:
            let rules = try container.decode([ChaosRule].self, forKey: .payload)
            self = .updateChaosRules(rules)
        case .dbCommand:
            let command = try container.decode(DBCommand.self, forKey: .payload)
            self = .dbCommand(command)
        case .dbResponse:
            let response = try container.decode(DBResponse.self, forKey: .payload)
            self = .dbResponse(response)
        case .error:
            let payload = try container.decode(ErrorPayload.self, forKey: .payload)
            self = .error(code: payload.code, message: payload.message)
        }
    }

    public func encode(to encoder: Encoder) throws {
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
        case let .breakpointHit(hit):
            try container.encode(MessageType.breakpointHit, forKey: .type)
            try container.encode(hit, forKey: .payload)
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

// MARK: - Payload Types

private struct RegisterPayload: Codable {
    let deviceInfo: DeviceInfo
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

/// 重放请求 Payload
public struct ReplayRequestPayload: Codable {
    public let id: String
    public let method: String
    public let url: String
    public let headers: [String: String]
    public let body: String?  // base64 encoded
    
    public init(id: String, method: String, url: String, headers: [String: String], body: String?) {
        self.id = id
        self.method = method
        self.url = url
        self.headers = headers
        self.body = body
    }
    
    /// 解码 body 为 Data
    public var bodyData: Data? {
        guard let body = body else { return nil }
        return Data(base64Encoded: body)
    }
}

/// 断点恢复 Payload
public struct BreakpointResumePayload: Codable {
    public let breakpointId: String
    public let requestId: String
    public let action: String  // "continue", "resume", "abort", "modify", "mockResponse"
    public let modifiedRequest: ModifiedRequest?
    public let modifiedResponse: ModifiedResponse?
    
    public struct ModifiedRequest: Codable {
        public let method: String?
        public let url: String?
        public let headers: [String: String]?
        public let body: String?  // base64 encoded
        
        /// 解码 body 为 Data
        public var bodyData: Data? {
            guard let body = body else { return nil }
            return Data(base64Encoded: body)
        }
    }
    
    public struct ModifiedResponse: Codable {
        public let statusCode: Int?
        public let headers: [String: String]?
        public let body: String?  // base64 encoded
        
        /// 解码 body 为 Data
        public var bodyData: Data? {
            guard let body = body else { return nil }
            return Data(base64Encoded: body)
        }
    }
    
    public init(breakpointId: String, requestId: String, action: String, modifiedRequest: ModifiedRequest? = nil, modifiedResponse: ModifiedResponse? = nil) {
        self.breakpointId = breakpointId
        self.requestId = requestId
        self.action = action
        self.modifiedRequest = modifiedRequest
        self.modifiedResponse = modifiedResponse
    }
}
