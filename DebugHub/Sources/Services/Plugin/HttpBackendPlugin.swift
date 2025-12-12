// HttpBackendPlugin.swift
// DebugHub
//
// Created by Sun on 2025/12/09.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Foundation
import Vapor

// MARK: - HTTP Backend Plugin

/// HTTP 请求监控后端插件
/// 负责 HTTP 事件的持久化和 API 提供
public final class HttpBackendPlugin: BackendPlugin, @unchecked Sendable {
    // MARK: - Plugin Metadata

    public let pluginId: String = BackendPluginId.http
    public let displayName: String = "HTTP"
    public let version: String = "1.0.0"
    public let pluginDescription: String = "HTTP 请求监控后端"
    public let dependencies: [String] = []

    // MARK: - State

    public private(set) var state: BackendPluginState = .uninitialized

    // MARK: - Private Properties

    private var context: BackendPluginContext?

    // MARK: - Lifecycle

    public init() {}

    public func boot(context: BackendPluginContext) async throws {
        self.context = context
        state = .booting

        // HTTP 插件启动时不需要特殊初始化
        // 数据库迁移已在主配置中完成

        state = .running
        context.logger.info("HttpBackendPlugin booted")
    }

    public func registerRoutes(on routes: RoutesBuilder) throws {
        // HTTP 相关路由
        // 保持与现有 HTTPEventController 兼容的路由结构
        let http = routes.grouped("devices", ":deviceId", "http")

        http.get(use: listHTTPEvents)
        http.get(":eventId", use: getHTTPEvent)
        http.get(":eventId", "curl", use: generateCurl)
        http.post(":eventId", "replay", use: replayRequest)
        http.post(":eventId", "favorite", use: toggleFavorite)
        http.post("batch", "delete", use: batchDelete)
        http.post("batch", "favorite", use: batchFavorite)
        http.delete(use: deleteAllHTTPEvents)
    }

    public func handleEvent(_ event: PluginEventDTO, from deviceId: String) async {
        guard event.eventType == "http_event" else { return }

        do {
            let httpEvent = try event.decodePayload(as: HTTPEventDTO.self)
            try await ingestHTTPEvent(httpEvent, deviceId: deviceId)

            // 广播到 WebUI
            let wsEvent = WebUIEventDTO(
                type: "http_event",
                deviceId: deviceId,
                data: httpEvent
            )
            context?.broadcastToWebUI(wsEvent, deviceId: deviceId)
        } catch {
            context?.logger.error("Failed to process HTTP event: \(error)")
        }
    }

    public func shutdown() async {
        state = .stopping
        // 清理资源
        state = .stopped
        context?.logger.info("HttpBackendPlugin shut down")
    }

    // MARK: - Event Ingestion

    /// 入库 HTTP 事件
    private func ingestHTTPEvent(_ event: HTTPEventDTO, deviceId: String) async throws {
        guard let db = context?.database else { return }

        let encoder = JSONEncoder()

        // 编码 timing 数据
        var timingJSON: String?
        if let timing = event.timing {
            timingJSON = try? String(data: encoder.encode(timing), encoding: .utf8)
        }

        // 解析 Body Params
        var bodyParams: [String: String] = [:]
        if let body = event.request.body, !body.isEmpty {
            let contentType = event.request.headers.first { $0.key.lowercased() == "content-type" }?.value
                .lowercased() ?? ""
            if contentType.contains("application/json") {
                bodyParams = flattenJSON(body)
            } else if contentType.contains("application/x-www-form-urlencoded") {
                if let str = String(data: body, encoding: .utf8) {
                    let components = URLComponents(string: "?" + str)
                    if let items = components?.queryItems {
                        for item in items {
                            bodyParams[item.name] = item.value ?? ""
                        }
                    }
                }
            }
        }
        let bodyParamsJSON = (try? String(data: encoder.encode(bodyParams), encoding: .utf8)) ?? "{}"

        let model = try HTTPEventModel(
            id: event.request.id,
            deviceId: deviceId,
            method: event.request.method,
            url: event.request.url,
            queryItems: String(data: encoder.encode(event.request.queryItems), encoding: .utf8) ?? "{}",
            requestHeaders: String(data: encoder.encode(event.request.headers), encoding: .utf8) ?? "{}",
            requestBody: event.request.body,
            statusCode: event.response?.statusCode,
            responseHeaders: event.response.flatMap { try? String(data: encoder.encode($0.headers), encoding: .utf8) },
            responseBody: event.response?.body,
            bodyParams: bodyParamsJSON,
            startTime: event.request.startTime,
            endTime: event.response?.endTime,
            duration: event.response?.duration,
            errorDescription: event.response?.errorDescription,
            isMocked: event.isMocked,
            mockRuleId: event.mockRuleId,
            traceId: event.request.traceId,
            timingJSON: timingJSON,
            isReplay: event.isReplay ?? false
        )

        try await model.save(on: db)

        // 批量保存参数
        if !bodyParams.isEmpty {
            let paramModels = bodyParams.map { key, value in
                HTTPEventParamModel(eventId: event.request.id, paramKey: key, paramValue: value)
            }
            try await paramModels.create(on: db)
        }
    }

    // MARK: - Helpers

    private func flattenJSON(_ data: Data) -> [String: String] {
        guard let json = try? JSONSerialization.jsonObject(with: data, options: []) else {
            return [:]
        }
        var result: [String: String] = [:]
        flatten(json, prefix: "", result: &result)
        return result
    }

    private func flatten(_ value: Any, prefix: String, result: inout [String: String]) {
        if let dict = value as? [String: Any] {
            for (key, val) in dict {
                let newKey = prefix.isEmpty ? key : "\(prefix).\(key)"
                flatten(val, prefix: newKey, result: &result)
            }
        } else if let array = value as? [Any] {
            for (index, val) in array.enumerated() {
                let newKey = "\(prefix)[\(index)]"
                flatten(val, prefix: newKey, result: &result)
            }
        } else {
            result[prefix] = "\(value)"
        }
    }

    // MARK: - Route Handlers

    /// 获取 HTTP 事件列表
    func listHTTPEvents(req: Request) async throws -> PluginHTTPEventListResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let page = req.query[Int.self, at: "page"] ?? 1
        let pageSize = min(req.query[Int.self, at: "pageSize"] ?? 50, 100)

        var query = HTTPEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)

        // 应用过滤参数
        if let method = req.query[String.self, at: "method"] {
            query = query.filter(\.$method == method.uppercased())
        }

        if let statusCode = req.query[Int.self, at: "statusCode"] {
            query = query.filter(\.$statusCode == statusCode)
        }

        if let urlContains = req.query[String.self, at: "urlContains"] {
            query = query.filter(\.$url ~~ urlContains)
        }

        let total = try await query.count()

        let events = try await query
            .sort(\.$startTime, .descending)
            .range((page - 1) * pageSize..<page * pageSize)
            .all()

        let items = events.map { event in
            PluginHTTPEventSummaryDTO(
                id: event.id ?? "",
                method: event.method,
                url: event.url,
                statusCode: event.statusCode,
                duration: event.duration,
                startTime: event.startTime,
                isMocked: event.isMocked,
                isFavorite: event.isFavorite,
                isReplay: event.isReplay,
                seqNum: event.seqNum
            )
        }

        return PluginHTTPEventListResponse(
            items: items,
            total: total,
            page: page,
            pageSize: pageSize
        )
    }

    /// 获取单个 HTTP 事件详情
    func getHTTPEvent(req: Request) async throws -> PluginHTTPEventDetailDTO {
        guard let eventId = req.parameters.get("eventId") else {
            throw Abort(.badRequest, reason: "Missing eventId")
        }

        guard let event = try await HTTPEventModel.find(eventId, on: req.db) else {
            throw Abort(.notFound, reason: "HTTP event not found")
        }

        return PluginHTTPEventDetailDTO(from: event)
    }

    /// 生成 cURL 命令
    func generateCurl(req: Request) async throws -> PluginCurlResponse {
        guard let eventId = req.parameters.get("eventId") else {
            throw Abort(.badRequest, reason: "Missing eventId")
        }

        guard let event = try await HTTPEventModel.find(eventId, on: req.db) else {
            throw Abort(.notFound, reason: "HTTP event not found")
        }

        var curl = "curl -X \(event.method) '\(event.url)'"

        // 添加请求头
        let headersJSON = event.requestHeaders
        if let headers = try? JSONDecoder().decode([String: String].self, from: Data(headersJSON.utf8)) {
            for (key, value) in headers where key.lowercased() != "host" {
                curl += " \\\n  -H '\(key): \(value)'"
            }
        }

        // 添加请求体
        if let body = event.requestBody, !body.isEmpty {
            if let bodyStr = String(data: body, encoding: .utf8) {
                curl += " \\\n  -d '\(bodyStr.replacingOccurrences(of: "'", with: "'\\''"))'"
            }
        }

        return PluginCurlResponse(curl: curl)
    }

    /// 重放请求
    func replayRequest(req: Request) async throws -> PluginReplayResponse {
        guard
            let eventId = req.parameters.get("eventId"),
            let deviceId = req.parameters.get("deviceId")
        else {
            throw Abort(.badRequest, reason: "Missing parameters")
        }

        guard let event = try await HTTPEventModel.find(eventId, on: req.db) else {
            throw Abort(.notFound, reason: "HTTP event not found")
        }

        // 解析请求头
        let headersJSON = event.requestHeaders
        let headers = (try? JSONDecoder().decode([String: String].self, from: Data(headersJSON.utf8))) ?? [:]

        // 构建重放命令
        let command = try PluginCommandDTO(
            pluginId: pluginId,
            commandType: "replay",
            payload: JSONEncoder().encode(ReplayPayload(
                url: event.url,
                method: event.method,
                headers: headers,
                body: event.requestBody
            ))
        )

        await context?.sendCommand(command, to: deviceId)

        return PluginReplayResponse(success: true, message: "Replay request sent")
    }

    /// 切换收藏状态
    func toggleFavorite(req: Request) async throws -> PluginFavoriteResponse {
        guard let eventId = req.parameters.get("eventId") else {
            throw Abort(.badRequest, reason: "Missing eventId")
        }

        guard let event = try await HTTPEventModel.find(eventId, on: req.db) else {
            throw Abort(.notFound, reason: "HTTP event not found")
        }

        event.isFavorite = !event.isFavorite
        try await event.save(on: req.db)

        return PluginFavoriteResponse(isFavorite: event.isFavorite)
    }

    /// 批量删除
    func batchDelete(req: Request) async throws -> PluginBatchDeleteResponse {
        let input = try req.content.decode(BatchDeleteInput.self)

        try await HTTPEventModel.query(on: req.db)
            .filter(\.$id ~~ input.ids)
            .delete()

        return PluginBatchDeleteResponse(deleted: input.ids.count)
    }

    /// 批量收藏
    func batchFavorite(req: Request) async throws -> PluginBatchFavoriteResponse {
        let input = try req.content.decode(PluginBatchFavoriteInput.self)

        try await HTTPEventModel.query(on: req.db)
            .filter(\.$id ~~ input.ids)
            .set(\.$isFavorite, to: input.favorite)
            .update()

        return PluginBatchFavoriteResponse(updated: input.ids.count, favorite: input.favorite)
    }

    /// 删除设备全部 HTTP 事件
    func deleteAllHTTPEvents(req: Request) async throws -> PluginDeleteAllResponse {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        // 先删除关联的参数表记录
        let eventIds = try await HTTPEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .all()
            .compactMap(\.id)

        if !eventIds.isEmpty {
            try await HTTPEventParamModel.query(on: req.db)
                .filter(\.$eventId ~~ eventIds)
                .delete()
        }

        // 删除 HTTP 事件
        let count = try await HTTPEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .count()

        try await HTTPEventModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .delete()

        return PluginDeleteAllResponse(deleted: count)
    }
}

// MARK: - DTOs

struct PluginHTTPEventListResponse: Content {
    let items: [PluginHTTPEventSummaryDTO]
    let total: Int
    let page: Int
    let pageSize: Int
}

struct PluginHTTPEventSummaryDTO: Content {
    let id: String
    let method: String
    let url: String
    let statusCode: Int?
    let duration: Double?
    let startTime: Date
    let isMocked: Bool
    let isFavorite: Bool
    let isReplay: Bool
    let seqNum: Int64
}

struct PluginHTTPEventDetailDTO: Content {
    let id: String
    let method: String
    let url: String
    let queryItems: [String: String]
    let requestHeaders: [String: String]
    let requestBody: Data?
    let statusCode: Int?
    let responseHeaders: [String: String]?
    let responseBody: Data?
    let startTime: Date
    let endTime: Date?
    let duration: Double?
    let errorDescription: String?
    let isMocked: Bool
    let mockRuleId: String?
    let traceId: String?
    let timing: PluginTimingDTO?
    let isFavorite: Bool
    let isReplay: Bool

    init(from model: HTTPEventModel) {
        id = model.id ?? ""
        method = model.method
        url = model.url
        queryItems = (try? JSONDecoder().decode([String: String].self, from: Data(model.queryItems.utf8))) ?? [:]
        requestHeaders = (try? JSONDecoder().decode([String: String].self, from: Data(model.requestHeaders.utf8))) ??
            [:]
        requestBody = model.requestBody
        statusCode = model.statusCode
        responseHeaders = model.responseHeaders.flatMap { try? JSONDecoder().decode(
            [String: String].self,
            from: Data($0.utf8)
        ) }
        responseBody = model.responseBody
        startTime = model.startTime
        endTime = model.endTime
        duration = model.duration
        errorDescription = model.errorDescription
        isMocked = model.isMocked
        mockRuleId = model.mockRuleId
        traceId = model.traceId
        timing = model.timingJSON.flatMap { try? JSONDecoder().decode(PluginTimingDTO.self, from: Data($0.utf8)) }
        isFavorite = model.isFavorite
        isReplay = model.isReplay
    }
}

struct PluginTimingDTO: Content {
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

struct PluginCurlResponse: Content {
    let curl: String
}

struct PluginReplayResponse: Content {
    let success: Bool
    let message: String
}

struct ReplayPayload: Codable {
    let url: String
    let method: String
    let headers: [String: String]
    let body: Data?
}

struct PluginFavoriteResponse: Content {
    let isFavorite: Bool
}

struct BatchDeleteInput: Content {
    let ids: [String]
}

struct PluginBatchDeleteResponse: Content {
    let deleted: Int
}

struct PluginDeleteAllResponse: Content {
    let deleted: Int
}

struct PluginBatchFavoriteInput: Content {
    let ids: [String]
    let favorite: Bool
}

struct PluginBatchFavoriteResponse: Content {
    let updated: Int
    let favorite: Bool
}

struct WebUIEventDTO: Content {
    let type: String
    let deviceId: String
    let data: HTTPEventDTO
}
