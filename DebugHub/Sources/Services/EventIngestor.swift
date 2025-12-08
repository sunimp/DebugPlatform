// EventIngestor.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Foundation
import Vapor

/// 事件接收器，负责将事件写入数据库
final class EventIngestor: @unchecked Sendable {
    static let shared = EventIngestor()

    private init() {}

    func ingest(events: [DebugEventDTO], deviceId: String, db: Database) async {
        for event in events {
            do {
                switch event {
                case let .http(httpEvent):
                    try await ingestHTTPEvent(httpEvent, deviceId: deviceId, db: db)

                case let .webSocket(wsEvent):
                    try await ingestWSEvent(wsEvent, deviceId: deviceId, db: db)

                case let .log(logEvent):
                    try await ingestLogEvent(logEvent, deviceId: deviceId, db: db)

                case .stats:
                    // Stats 事件暂不持久化，仅用于实时展示
                    break
                }
            } catch {
                print("[EventIngestor] Failed to ingest event: \(error)")
            }
        }
    }

    // MARK: - HTTP Event

    private func ingestHTTPEvent(_ event: HTTPEventDTO, deviceId: String, db: Database) async throws {
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
            timingJSON: timingJSON
        )

        try await model.save(on: db)

        // 批量保存解析后的参数到关联表，用于搜索优化
        if !bodyParams.isEmpty {
            let paramModels = bodyParams.map { key, value in
                HTTPEventParamModel(
                    eventId: event.request.id,
                    paramKey: key,
                    paramValue: value
                )
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

    // MARK: - WebSocket Event

    private func ingestWSEvent(_ event: WSEventDTO, deviceId: String, db: Database) async throws {
        let encoder = JSONEncoder()

        switch event.kind {
        case let .sessionCreated(session):
            print("[EventIngestor] WS sessionCreated: id=\(session.id), url=\(session.url.prefix(80))...")
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

    // MARK: - Log Event

    private func ingestLogEvent(_ event: LogEventDTO, deviceId: String, db: Database) async throws {
        let encoder = JSONEncoder()

        let model = try LogEventModel(
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
            tags: String(data: encoder.encode(event.tags), encoding: .utf8) ?? "[]",
            traceId: event.traceId
        )

        try await model.save(on: db)
    }
}
