// DeviceController.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Vapor

struct DeviceController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let devices = routes.grouped("devices")

        devices.get(use: listDevices)
        devices.get(":deviceId", use: getDevice)
        devices.get(":deviceId", "sessions", use: getSessionHistory)
        devices.post(":deviceId", "control", "toggle-capture", use: toggleCapture)
        devices.post(":deviceId", "control", "update-mock-rules", use: updateMockRules)
        devices.delete(":deviceId", "data", use: clearDeviceData)
    }

    // MARK: - 获取设备会话历史

    func getSessionHistory(req: Request) async throws -> [DeviceSessionDTO] {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let limit = req.query[Int.self, at: "limit"] ?? 50

        let sessions = try await DeviceSessionModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .sort(\.$connectedAt, .descending)
            .limit(limit)
            .all()

        return sessions.map { session in
            DeviceSessionDTO(
                id: session.id?.uuidString ?? "",
                deviceId: session.deviceId,
                deviceName: session.deviceName,
                sessionId: session.sessionId,
                connectedAt: session.connectedAt,
                disconnectedAt: session.disconnectedAt,
                isNormalClose: session.isNormalClose
            )
        }
    }

    // MARK: - 获取设备列表

    func listDevices(req: Request) async throws -> Response {
        // 检查是否接受 HTML（浏览器直接访问）
        // 浏览器 Accept 头通常包含 text/html，而 API 客户端（如 fetch with Accept: application/json）不包含
        let acceptsHTML = req.headers.accept.contains { $0.mediaType == .html }

        // 浏览器直接访问返回 index.html，由 React Router 处理
        if acceptsHTML {
            return try await req.fileio.asyncStreamFile(
                at: req.application.directory.publicDirectory + "index.html"
            )
        }

        // API 请求返回 JSON
        let sessions = DeviceRegistry.shared.getAllSessions()
        let devices = sessions.map { session in
            DeviceListItemDTO(
                deviceId: session.deviceInfo.deviceId,
                deviceName: session.deviceInfo.deviceName,
                appName: session.deviceInfo.appName,
                appVersion: session.deviceInfo.appVersion,
                buildNumber: session.deviceInfo.buildNumber,
                platform: session.deviceInfo.platform,
                systemVersion: session.deviceInfo.systemVersion,
                isOnline: true,
                lastSeenAt: session.lastSeenAt,
                connectedAt: session.connectedAt
            )
        }
        return try await devices.encodeResponse(for: req)
    }

    // MARK: - 获取设备详情

    func getDevice(req: Request) async throws -> DeviceDetailDTO {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        guard let session = DeviceRegistry.shared.getSession(deviceId: deviceId) else {
            throw Abort(.notFound, reason: "Device not found or offline")
        }

        // 统计数据
        let httpCount = try await HTTPEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .count()

        let logCount = try await LogEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .count()

        let wsSessionCount = try await WSSessionModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .count()

        return DeviceDetailDTO(
            deviceInfo: session.deviceInfo,
            isOnline: true,
            connectedAt: session.connectedAt,
            lastSeenAt: session.lastSeenAt,
            stats: DeviceStatsDTO(
                httpEventCount: httpCount,
                logEventCount: logCount,
                wsSessionCount: wsSessionCount
            )
        )
    }

    // MARK: - 开关捕获

    func toggleCapture(req: Request) async throws -> HTTPStatus {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let payload = try req.content.decode(ToggleCaptureRequest.self)

        let message = BridgeMessageDTO.toggleCapture(
            network: payload.network,
            log: payload.log
        )

        DeviceRegistry.shared.sendMessage(to: deviceId, message: message)

        return .ok
    }

    // MARK: - 更新 Mock 规则

    func updateMockRules(req: Request) async throws -> HTTPStatus {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let rules = try req.content.decode([MockRuleDTO].self)

        let message = BridgeMessageDTO.updateMockRules(rules)
        DeviceRegistry.shared.sendMessage(to: deviceId, message: message)

        return .ok
    }

    // MARK: - 清空设备数据

    func clearDeviceData(req: Request) async throws -> HTTPStatus {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        // 删除 HTTP 事件
        try await HTTPEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        // 删除日志事件
        try await LogEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        // 删除 WebSocket 帧
        try await WSFrameModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        // 删除 WebSocket 会话
        try await WSSessionModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        // 删除设备连接会话记录
        try await DeviceSessionModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        return .ok
    }
}

// MARK: - DTOs

struct DeviceListItemDTO: Content {
    let deviceId: String
    let deviceName: String
    let appName: String
    let appVersion: String
    let buildNumber: String
    let platform: String
    let systemVersion: String
    let isOnline: Bool
    let lastSeenAt: Date
    let connectedAt: Date
}

struct DeviceDetailDTO: Content {
    let deviceInfo: DeviceInfoDTO
    let isOnline: Bool
    let connectedAt: Date
    let lastSeenAt: Date
    let stats: DeviceStatsDTO
}

struct DeviceStatsDTO: Content {
    let httpEventCount: Int
    let logEventCount: Int
    let wsSessionCount: Int
}

struct ToggleCaptureRequest: Content {
    let network: Bool
    let log: Bool
}

struct DeviceSessionDTO: Content {
    let id: String
    let deviceId: String
    let deviceName: String
    let sessionId: String
    let connectedAt: Date
    let disconnectedAt: Date?
    let isNormalClose: Bool
}
