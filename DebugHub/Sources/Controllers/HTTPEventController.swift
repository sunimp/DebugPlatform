// HTTPEventController.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Vapor

struct HTTPEventController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let http = routes.grouped("devices", ":deviceId", "http")

        http.get(use: listHTTPEvents)
        http.get(":eventId", use: getHTTPEvent)
        http.get(":eventId", "curl", use: generateCurl)
        http.post(":eventId", "replay", use: replayRequest)
        http.post(":eventId", "favorite", use: toggleFavorite)
        http.post("batch", "delete", use: batchDelete)
        http.post("batch", "favorite", use: batchFavorite)
    }

    // MARK: - 获取 HTTP 事件列表

    func listHTTPEvents(req: Request) async throws -> HTTPEventListResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let page = req.query[Int.self, at: "page"] ?? 1
        let pageSize = min(req.query[Int.self, at: "pageSize"] ?? 50, 100)

        // 高级搜索查询
        let searchQuery = req.query[String.self, at: "q"]

        // 传统过滤参数（向后兼容）
        let method = req.query[String.self, at: "method"]
        let statusCode = req.query[Int.self, at: "statusCode"]
        let urlContains = req.query[String.self, at: "urlContains"]
        // 注意：Vapor 的 Bool 解码可能会将缺失的参数解析为 false
        // 所以我们需要先检查原始查询字符串
        let isMocked: Bool? = req.url.query?.contains("isMocked=") == true
            ? req.query[Bool.self, at: "isMocked"]
            : nil
        let timeFrom = req.query[Date.self, at: "timeFrom"]
        let timeTo = req.query[Date.self, at: "timeTo"]
        let minDuration = req.query[Double.self, at: "minDuration"]
        let maxDuration = req.query[Double.self, at: "maxDuration"]

        var query = HTTPEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)

        // 应用高级搜索
        if let searchQuery, !searchQuery.isEmpty {
            query = applyAdvancedSearch(query: query, searchQuery: searchQuery)
        }

        // 应用传统过滤参数
        if let method {
            query = query.filter(\.$method == method.uppercased())
        }

        if let statusCode {
            query = query.filter(\.$statusCode == statusCode)
        }

        if let urlContains {
            query = query.filter(\.$url ~~ urlContains)
        }

        if let isMocked {
            query = query.filter(\.$isMocked == isMocked)
        }

        if let timeFrom {
            query = query.filter(\.$startTime >= timeFrom)
        }

        if let timeTo {
            query = query.filter(\.$startTime <= timeTo)
        }

        if let minDuration {
            query = query.filter(\.$duration >= minDuration)
        }

        if let maxDuration {
            query = query.filter(\.$duration <= maxDuration)
        }

        let total = try await query.count()

        let events = try await query
            .sort(\.$startTime, .descending)
            .range((page - 1) * pageSize..<page * pageSize)
            .all()

        let items = events.map { event in
            HTTPEventSummaryDTO(
                id: event.id!,
                method: event.method,
                url: event.url,
                statusCode: event.statusCode,
                startTime: event.startTime,
                duration: event.duration,
                isMocked: event.isMocked,
                mockRuleId: event.mockRuleId,
                errorDescription: event.errorDescription,
                traceId: event.traceId,
                isFavorite: event.isFavorite
            )
        }

        return HTTPEventListResponse(
            total: total,
            page: page,
            pageSize: pageSize,
            items: items
        )
    }

    // MARK: - 高级搜索

    private func applyAdvancedSearch(
        query: QueryBuilder<HTTPEventModel>,
        searchQuery: String
    ) -> QueryBuilder<HTTPEventModel> {
        let parsed = SearchQueryParser.parse(searchQuery)
        var currentQuery = query

        for filter in parsed.filters {
            currentQuery = applyFilter(query: currentQuery, filter: filter)
        }

        return currentQuery
    }

    private func applyFilter(
        query: QueryBuilder<HTTPEventModel>,
        filter: SearchFilter
    ) -> QueryBuilder<HTTPEventModel> {
        switch filter.field {
        case "method":
            return query.filter(\.$method == filter.value.uppercased())

        case "statusCode":
            // 处理状态码范围 (如 "400-499")
            if filter.value.contains("-") {
                let parts = filter.value.split(separator: "-")
                if
                    parts.count == 2,
                    let min = Int(parts[0]),
                    let max = Int(parts[1]) {
                    return query
                        .filter(\.$statusCode >= min)
                        .filter(\.$statusCode <= max)
                }
                // 范围格式无效，返回不可能匹配的条件
                return query.filter(\.$statusCode == -1)
            }
            if let code = Int(filter.value) {
                switch filter.op {
                case .greaterThan:
                    return query.filter(\.$statusCode > code)
                case .lessThan:
                    return query.filter(\.$statusCode < code)
                case .greaterOrEqual:
                    return query.filter(\.$statusCode >= code)
                case .lessOrEqual:
                    return query.filter(\.$statusCode <= code)
                default:
                    return query.filter(\.$statusCode == code)
                }
            }
            // 状态码解析失败，返回不可能匹配的条件
            return query.filter(\.$statusCode == -1)

        case "url":
            switch filter.op {
            case .equals:
                return query.filter(\.$url == filter.value)
            case .contains:
                return query.filter(\.$url ~~ filter.value)
            default:
                return query.filter(\.$url ~~ filter.value)
            }

        case "duration":
            if let duration = Double(filter.value) {
                switch filter.op {
                case .greaterThan:
                    return query.filter(\.$duration > duration)
                case .lessThan:
                    return query.filter(\.$duration < duration)
                case .greaterOrEqual:
                    return query.filter(\.$duration >= duration)
                case .lessOrEqual:
                    return query.filter(\.$duration <= duration)
                default:
                    return query.filter(\.$duration == duration)
                }
            }
            // duration 解析失败，返回不可能匹配的条件
            return query.filter(\.$duration == -1)

        case "isMocked":
            let isMocked = filter.value.lowercased() == "true"
            return query.filter(\.$isMocked == isMocked)

        case "traceId":
            return query.filter(\.$traceId == filter.value)

        case "errorDescription":
            if filter.value.lowercased() == "true" || filter.value == "*" {
                // 有错误
                return query.filter(\.$errorDescription != nil)
            }
            return query.filter(\.$errorDescription ~~ filter.value)

        default:
            // 未知字段，尝试作为 URL 搜索
            return query.filter(\.$url ~~ filter.value)
        }
    }

    // MARK: - 获取单个 HTTP 事件详情

    func getHTTPEvent(req: Request) async throws -> HTTPEventDetailDTO {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let eventId = req.parameters.get("eventId") else {
            throw Abort(.badRequest, reason: "Missing deviceId or eventId")
        }

        guard
            let event = try await HTTPEventModel.query(on: req.db)
                .filter(\.$id == eventId)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound, reason: "HTTP event not found")
        }

        let decoder = JSONDecoder()

        let queryItems = (try? decoder.decode([String: String].self, from: Data(event.queryItems.utf8))) ?? [:]
        let requestHeaders = (try? decoder.decode([String: String].self, from: Data(event.requestHeaders.utf8))) ?? [:]

        let bodyParams: [String: String]? = event.bodyParams.flatMap {
            try? decoder.decode([String: String].self, from: Data($0.utf8))
        }

        let responseHeaders: [String: String]? = event.responseHeaders.flatMap {
            try? decoder.decode([String: String].self, from: Data($0.utf8))
        }

        // 解码 timing 数据
        let timing: HTTPTimingDTO? = event.timingJSON.flatMap {
            try? decoder.decode(HTTPTimingDTO.self, from: Data($0.utf8))
        }

        return HTTPEventDetailDTO(
            id: event.id!,
            method: event.method,
            url: event.url,
            queryItems: queryItems,
            requestHeaders: requestHeaders,
            requestBody: event.requestBody?.base64EncodedString(),
            bodyParams: bodyParams,
            statusCode: event.statusCode,
            responseHeaders: responseHeaders,
            responseBody: event.responseBody?.base64EncodedString(),
            startTime: event.startTime,
            endTime: event.endTime,
            duration: event.duration,
            errorDescription: event.errorDescription,
            isMocked: event.isMocked,
            mockRuleId: event.mockRuleId,
            traceId: event.traceId,
            timing: timing,
            isFavorite: event.isFavorite
        )
    }

    // MARK: - 生成 cURL 命令

    func generateCurl(req: Request) async throws -> CurlResponse {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let eventId = req.parameters.get("eventId") else {
            throw Abort(.badRequest, reason: "Missing deviceId or eventId")
        }

        guard
            let event = try await HTTPEventModel.query(on: req.db)
                .filter(\.$id == eventId)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound, reason: "HTTP event not found")
        }

        let decoder = JSONDecoder()
        let requestHeaders = (try? decoder.decode([String: String].self, from: Data(event.requestHeaders.utf8))) ?? [:]

        var curlParts = ["curl"]

        // 添加方法
        if event.method != "GET" {
            curlParts.append("-X \(event.method)")
        }

        // 添加 headers
        for (key, value) in requestHeaders {
            let escapedValue = value.replacingOccurrences(of: "'", with: "'\\''")
            curlParts.append("-H '\(key): \(escapedValue)'")
        }

        // 添加 body
        if
            let bodyData = event.requestBody,
            let bodyString = String(data: bodyData, encoding: .utf8) {
            let escapedBody = bodyString.replacingOccurrences(of: "'", with: "'\\''")
            curlParts.append("-d '\(escapedBody)'")
        }

        // 添加 URL
        let escapedUrl = event.url.replacingOccurrences(of: "'", with: "'\\''")
        curlParts.append("'\(escapedUrl)'")

        return CurlResponse(curl: curlParts.joined(separator: " \\\n  "))
    }

    // MARK: - 请求重放

    func replayRequest(req: Request) async throws -> ReplayResponse {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let eventId = req.parameters.get("eventId")
        else {
            throw Abort(.badRequest, reason: "Missing deviceId or eventId")
        }

        guard
            let event = try await HTTPEventModel.query(on: req.db)
                .filter(\.$id == eventId)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound, reason: "HTTP event not found")
        }

        let decoder = JSONDecoder()
        let requestHeaders = (try? decoder.decode([String: String].self, from: Data(event.requestHeaders.utf8))) ?? [:]

        // 构建重放指令
        let replayId = UUID().uuidString
        let replayCommand = ReplayCommand(
            id: replayId,
            method: event.method,
            url: event.url,
            headers: requestHeaders,
            body: event.requestBody?.base64EncodedString()
        )

        // 通过 DebugBridgeHandler 向设备发送重放指令
        let sent = await DebugBridgeHandler.shared.sendReplayCommand(deviceId: deviceId, command: replayCommand)

        if sent {
            return ReplayResponse(replayId: replayId, status: "sent")
        } else {
            throw Abort(.serviceUnavailable, reason: "Device not connected or command failed")
        }
    }

    // MARK: - 收藏/取消收藏

    func toggleFavorite(req: Request) async throws -> FavoriteResponse {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let eventId = req.parameters.get("eventId")
        else {
            throw Abort(.badRequest, reason: "Missing deviceId or eventId")
        }

        guard
            let event = try await HTTPEventModel.query(on: req.db)
                .filter(\.$id == eventId)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound, reason: "HTTP event not found")
        }

        event.isFavorite.toggle()
        try await event.save(on: req.db)

        return FavoriteResponse(id: eventId, isFavorite: event.isFavorite)
    }

    // MARK: - 批量删除

    func batchDelete(req: Request) async throws -> BatchOperationResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let request = try req.content.decode(BatchDeleteRequest.self)

        // 先查询匹配的记录数
        let count = try await HTTPEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .filter(\.$id ~~ request.ids)
            .count()

        // 执行删除
        try await HTTPEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .filter(\.$id ~~ request.ids)
            .delete()

        return BatchOperationResponse(affected: count, success: true)
    }

    // MARK: - 批量收藏

    func batchFavorite(req: Request) async throws -> BatchOperationResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let request = try req.content.decode(BatchFavoriteRequest.self)

        let events = try await HTTPEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .filter(\.$id ~~ request.ids)
            .all()

        for event in events {
            event.isFavorite = request.isFavorite
            try await event.save(on: req.db)
        }

        return BatchOperationResponse(affected: events.count, success: true)
    }
}

// MARK: - DTOs

struct HTTPEventListResponse: Content {
    let total: Int
    let page: Int
    let pageSize: Int
    let items: [HTTPEventSummaryDTO]
}

struct HTTPEventSummaryDTO: Content {
    let id: String
    let method: String
    let url: String
    let statusCode: Int?
    let startTime: Date
    let duration: Double?
    let isMocked: Bool
    let mockRuleId: String?
    let errorDescription: String?
    let traceId: String?
    let isFavorite: Bool
}

struct HTTPEventDetailDTO: Content {
    let id: String
    let method: String
    let url: String
    let queryItems: [String: String]
    let requestHeaders: [String: String]
    let requestBody: String? // base64
    let bodyParams: [String: String]?
    let statusCode: Int?
    let responseHeaders: [String: String]?
    let responseBody: String? // base64
    let startTime: Date
    let endTime: Date?
    let duration: Double?
    let errorDescription: String?
    let isMocked: Bool
    let mockRuleId: String?
    let traceId: String?
    let timing: HTTPTimingDTO?
    let isFavorite: Bool
}

struct HTTPTimingDTO: Content {
    let dnsLookup: Double?
    let tcpConnection: Double?
    let tlsHandshake: Double?
    let timeToFirstByte: Double?
    let contentDownload: Double?
    let connectionReused: Bool?
    let protocolName: String?
    let localAddress: String?
    let remoteAddress: String?
    let requestBodyBytesSent: Int64?
    let responseBodyBytesReceived: Int64?
}

struct CurlResponse: Content {
    let curl: String
}

struct ReplayCommand: Content {
    let id: String
    let method: String
    let url: String
    let headers: [String: String]
    let body: String? // base64
}

struct ReplayResponse: Content {
    let replayId: String
    let status: String
}

struct FavoriteResponse: Content {
    let id: String
    let isFavorite: Bool
}

struct BatchDeleteRequest: Content {
    let ids: [String]
}

struct BatchFavoriteRequest: Content {
    let ids: [String]
    let isFavorite: Bool
}

struct BatchOperationResponse: Content {
    let affected: Int
    let success: Bool
}
