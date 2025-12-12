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
        devices.post(":deviceId", "control", "update-mock-rules", use: updateMockRules)
        devices.delete(":deviceId", "data", use: clearDeviceData)
        devices.delete(":deviceId", use: removeDevice)
        devices.delete("offline", use: removeAllOfflineDevices)
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

        // API 请求返回 JSON - 从数据库获取所有设备（包括离线的）
        let onlineSessions = DeviceRegistry.shared.getAllSessions()
        let onlineDeviceIds = Set(onlineSessions.map(\.deviceInfo.deviceId))

        // 从数据库获取所有未移除的设备
        let allDevices = try await DeviceModel.query(on: req.db)
            .filter(\.$isRemoved == false)
            .sort(\.$lastSeenAt, .descending)
            .all()

        let devices = allDevices.map { device in
            let isOnline = onlineDeviceIds.contains(device.deviceId)
            let onlineSession = onlineSessions.first { $0.deviceInfo.deviceId == device.deviceId }

            return DeviceListItemDTO(
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                deviceModel: device.deviceModel,
                appName: device.appName,
                appVersion: device.appVersion,
                buildNumber: device.buildNumber,
                platform: device.platform,
                systemVersion: device.systemVersion,
                isSimulator: device.isSimulator,
                isOnline: isOnline,
                lastSeenAt: isOnline ? (onlineSession?.lastSeenAt ?? device.lastSeenAt) : device.lastSeenAt,
                connectedAt: onlineSession?.connectedAt,
                appIcon: device.appIcon
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

        // 删除性能指标数据
        try await PerformanceMetricsModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        // 删除卡顿事件数据
        try await JankEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        // 删除告警记录
        try await AlertModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        // 重置该设备的序号缓存
        await SequenceNumberManager.shared.reset(for: deviceId)

        return .ok
    }
}

// MARK: - DTOs

struct DeviceListItemDTO: Content {
    let deviceId: String
    let deviceName: String
    let deviceModel: String
    let appName: String
    let appVersion: String
    let buildNumber: String
    let platform: String
    let systemVersion: String
    let isSimulator: Bool
    let isOnline: Bool
    let lastSeenAt: Date
    let connectedAt: Date? // 离线设备可能没有 connectedAt
    let appIcon: String?
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

struct DeviceSessionDTO: Content {
    let id: String
    let deviceId: String
    let deviceName: String
    let sessionId: String
    let connectedAt: Date
    let disconnectedAt: Date?
    let isNormalClose: Bool
}

// MARK: - 移除设备（软删除）

extension DeviceController {
    func removeDevice(req: Request) async throws -> HTTPStatus {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        // 检查设备是否在线，在线设备不能移除
        if DeviceRegistry.shared.getSession(deviceId: deviceId) != nil {
            throw Abort(.conflict, reason: "Cannot remove online device")
        }

        // 软删除设备
        guard
            let device = try await DeviceModel.query(on: req.db)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound, reason: "Device not found")
        }

        device.isRemoved = true
        try await device.save(on: req.db)

        return .ok
    }

    func removeAllOfflineDevices(req: Request) async throws -> HTTPStatus {
        // 获取所有在线设备 ID
        let onlineDeviceIds = Set(DeviceRegistry.shared.getAllSessions().map(\.deviceInfo.deviceId))

        // 软删除所有离线设备
        let offlineDevices = try await DeviceModel.query(on: req.db)
            .filter(\.$isRemoved == false)
            .all()
            .filter { !onlineDeviceIds.contains($0.deviceId) }

        for device in offlineDevices {
            device.isRemoved = true
            try await device.save(on: req.db)
        }

        return .ok
    }
}
