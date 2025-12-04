// WSEventController.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Vapor

struct WSEventController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let ws = routes.grouped("devices", ":deviceId")

        ws.get("ws-sessions", use: listWSSessions)
        ws.get("ws-sessions", ":sessionId", use: getWSSession)
        ws.get("ws-sessions", ":sessionId", "frames", use: listWSFrames)
        ws.get("ws-sessions", ":sessionId", "frames", ":frameId", use: getWSFramePayload)
        ws.post("ws-sessions", "batch", "delete", use: batchDeleteSessions)
    }

    // MARK: - 获取 WebSocket 会话列表

    func listWSSessions(req: Request) async throws -> WSSessionListResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let page = req.query[Int.self, at: "page"] ?? 1
        let pageSize = min(req.query[Int.self, at: "pageSize"] ?? 50, 100)
        let urlContains = req.query[String.self, at: "urlContains"]
        let host = req.query[String.self, at: "host"]
        
        // Parse isOpen from string to avoid Vapor's Bool parsing issue (returns false instead of nil)
        let isOpenStr = req.query[String.self, at: "isOpen"]
        let isOpen: Bool? = isOpenStr.flatMap { $0 == "true" ? true : ($0 == "false" ? false : nil) }
        
        let timeFrom = req.query[Date.self, at: "timeFrom"]
        let timeTo = req.query[Date.self, at: "timeTo"]

        // WORKAROUND: Fluent filter(\.$deviceId == deviceId) returns 0 results
        // despite the data existing. Using in-memory filtering as workaround.
        let allSessions = try await WSSessionModel.query(on: req.db).all()
        var filteredSessions = allSessions.filter { $0.deviceId == deviceId }
        
        if let urlContains {
            filteredSessions = filteredSessions.filter { $0.url.contains(urlContains) }
        }
        
        if let host {
            filteredSessions = filteredSessions.filter { session in
                session.url.contains("://\(host)/") || 
                session.url.contains("://\(host):") ||
                session.url.hasSuffix("://\(host)")
            }
        }
        
        if let isOpen {
            if isOpen {
                filteredSessions = filteredSessions.filter { $0.disconnectTime == nil }
            } else {
                filteredSessions = filteredSessions.filter { $0.disconnectTime != nil }
            }
        }
        
        if let timeFrom {
            filteredSessions = filteredSessions.filter { $0.connectTime >= timeFrom }
        }
        
        if let timeTo {
            filteredSessions = filteredSessions.filter { $0.connectTime <= timeTo }
        }
        
        let total = filteredSessions.count
        
        // Sort by connectTime descending
        filteredSessions.sort { $0.connectTime > $1.connectTime }
        
        // Pagination
        let startIndex = (page - 1) * pageSize
        let endIndex = min(startIndex + pageSize, filteredSessions.count)
        let pagedSessions = startIndex < filteredSessions.count 
            ? Array(filteredSessions[startIndex..<endIndex]) 
            : []

        let items = pagedSessions.map { session in
            WSSessionSummaryDTO(
                id: session.id!,
                url: session.url,
                connectTime: session.connectTime,
                disconnectTime: session.disconnectTime,
                closeCode: session.closeCode,
                closeReason: session.closeReason,
                isOpen: session.disconnectTime == nil
            )
        }

        return WSSessionListResponse(
            total: total,
            page: page,
            pageSize: pageSize,
            items: items
        )
    }

    // MARK: - 获取单个 WebSocket 会话详情

    func getWSSession(req: Request) async throws -> WSSessionDetailDTO {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let sessionId = req.parameters.get("sessionId") else {
            throw Abort(.badRequest, reason: "Missing deviceId or sessionId")
        }

        guard
            let session = try await WSSessionModel.query(on: req.db)
                .filter(\.$id == sessionId)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound, reason: "WebSocket session not found")
        }

        let decoder = JSONDecoder()
        let requestHeaders = (try? decoder.decode([String: String].self, from: Data(session.requestHeaders.utf8))) ??
            [:]
        let subprotocols = (try? decoder.decode([String].self, from: Data(session.subprotocols.utf8))) ?? []

        // 统计帧数量
        let frameCount = try await WSFrameModel.query(on: req.db)
            .filter(\.$sessionId == sessionId)
            .count()

        return WSSessionDetailDTO(
            id: session.id!,
            url: session.url,
            requestHeaders: requestHeaders,
            subprotocols: subprotocols,
            connectTime: session.connectTime,
            disconnectTime: session.disconnectTime,
            closeCode: session.closeCode,
            closeReason: session.closeReason,
            frameCount: frameCount
        )
    }

    // MARK: - 获取 WebSocket 帧列表

    func listWSFrames(req: Request) async throws -> WSFrameListResponse {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let sessionId = req.parameters.get("sessionId") else {
            throw Abort(.badRequest, reason: "Missing deviceId or sessionId")
        }

        let page = req.query[Int.self, at: "page"] ?? 1
        let pageSize = min(req.query[Int.self, at: "pageSize"] ?? 100, 500)
        let direction = req.query[String.self, at: "direction"]
        let timeFrom = req.query[Date.self, at: "timeFrom"]
        let timeTo = req.query[Date.self, at: "timeTo"]

        var query = WSFrameModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .filter(\.$sessionId == sessionId)

        if let direction {
            query = query.filter(\.$direction == direction)
        }

        if let timeFrom {
            query = query.filter(\.$timestamp >= timeFrom)
        }

        if let timeTo {
            query = query.filter(\.$timestamp <= timeTo)
        }

        let total = try await query.count()

        let frames = try await query
            .sort(\.$timestamp, .ascending)
            .range((page - 1) * pageSize..<page * pageSize)
            .all()

        let items = frames.map { frame in
            WSFrameItemDTO(
                id: frame.id!,
                direction: frame.direction,
                opcode: frame.opcode,
                payloadPreview: frame.payloadPreview,
                payloadSize: frame.payload.count,
                timestamp: frame.timestamp,
                isMocked: frame.isMocked
            )
        }

        return WSFrameListResponse(
            total: total,
            page: page,
            pageSize: pageSize,
            items: items
        )
    }

    // MARK: - 获取单个 WebSocket 帧详情（含完整 Payload）

    func getWSFramePayload(req: Request) async throws -> WSFrameDetailDTO {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let sessionId = req.parameters.get("sessionId"),
            let frameId = req.parameters.get("frameId") else {
            throw Abort(.badRequest, reason: "Missing deviceId, sessionId or frameId")
        }

        guard
            let frame = try await WSFrameModel.query(on: req.db)
                .filter(\.$id == frameId)
                .filter(\.$sessionId == sessionId)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound, reason: "WebSocket frame not found")
        }

        // 尝试将 payload 解析为 UTF-8 文本
        let payloadText = String(data: frame.payload, encoding: .utf8)
        // Base64 编码的完整 payload
        let payloadBase64 = frame.payload.base64EncodedString()

        return WSFrameDetailDTO(
            id: frame.id!,
            sessionId: frame.sessionId,
            direction: frame.direction,
            opcode: frame.opcode,
            payloadText: payloadText,
            payloadBase64: payloadBase64,
            payloadSize: frame.payload.count,
            timestamp: frame.timestamp,
            isMocked: frame.isMocked
        )
    }

    // MARK: - 批量删除会话

    func batchDeleteSessions(req: Request) async throws -> WSBatchDeleteResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let request = try req.content.decode(WSBatchDeleteRequest.self)

        // 先删除关联的帧
        try await WSFrameModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .filter(\.$sessionId ~~ request.ids)
            .delete()

        // 再删除会话
        let count = try await WSSessionModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .filter(\.$id ~~ request.ids)
            .count()

        try await WSSessionModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .filter(\.$id ~~ request.ids)
            .delete()

        return WSBatchDeleteResponse(affected: count, success: true)
    }
}

// MARK: - DTOs

struct WSSessionListResponse: Content {
    let total: Int
    let page: Int
    let pageSize: Int
    let items: [WSSessionSummaryDTO]
}

struct WSSessionSummaryDTO: Content {
    let id: String
    let url: String
    let connectTime: Date
    let disconnectTime: Date?
    let closeCode: Int?
    let closeReason: String?
    let isOpen: Bool
}

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
}

struct WSFrameListResponse: Content {
    let total: Int
    let page: Int
    let pageSize: Int
    let items: [WSFrameItemDTO]
}

struct WSFrameItemDTO: Content {
    let id: String
    let direction: String
    let opcode: String
    let payloadPreview: String?
    let payloadSize: Int
    let timestamp: Date
    let isMocked: Bool
}

struct WSFrameDetailDTO: Content {
    let id: String
    let sessionId: String
    let direction: String
    let opcode: String
    let payloadText: String?  // UTF-8 解码的文本（如果可解码）
    let payloadBase64: String // Base64 编码的完整 payload
    let payloadSize: Int
    let timestamp: Date
    let isMocked: Bool
}

// MARK: - 批量操作 DTOs

struct WSBatchDeleteRequest: Content {
    let ids: [String]
}

struct WSBatchDeleteResponse: Content {
    let affected: Int
    let success: Bool
}
