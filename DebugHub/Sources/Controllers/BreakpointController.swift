// BreakpointController.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Vapor

// MARK: - 断点管理器

/// 管理断点规则和断点命中事件
final class BreakpointManager: @unchecked Sendable {
    static let shared = BreakpointManager()

    /// 等待中的断点命中事件 (requestId -> hit)
    private var pendingHits: [String: BreakpointHitDTO] = [:]
    private var hitContinuations: [String: AsyncStream<BreakpointHitDTO>.Continuation] = [:]
    private let lock = NSLock()

    private init() {}

    func addPendingHit(_ hit: BreakpointHitDTO) {
        lock.lock()
        pendingHits[hit.requestId] = hit
        lock.unlock()

        // 通知所有订阅者
        notifyHit(hit)
    }

    func getPendingHits() -> [BreakpointHitDTO] {
        lock.lock()
        defer { lock.unlock() }
        return Array(pendingHits.values)
    }

    func removePendingHit(requestId: String) {
        lock.lock()
        pendingHits.removeValue(forKey: requestId)
        lock.unlock()
    }

    func subscribeToHits() -> AsyncStream<BreakpointHitDTO> {
        AsyncStream { continuation in
            let id = UUID().uuidString
            lock.lock()
            hitContinuations[id] = continuation
            lock.unlock()

            continuation.onTermination = { [weak self] _ in
                self?.lock.lock()
                self?.hitContinuations.removeValue(forKey: id)
                self?.lock.unlock()
            }
        }
    }

    private func notifyHit(_ hit: BreakpointHitDTO) {
        lock.lock()
        let continuations = hitContinuations.values
        lock.unlock()

        for continuation in continuations {
            continuation.yield(hit)
        }
    }
}

// MARK: - Breakpoint Controller

struct BreakpointController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let breakpoints = routes.grouped("devices", ":deviceId", "breakpoints")

        breakpoints.get(use: listBreakpointRules)
        breakpoints.post(use: createBreakpointRule)
        breakpoints.put(":ruleId", use: updateBreakpointRule)
        breakpoints.delete(":ruleId", use: deleteBreakpointRule)

        // 断点命中
        breakpoints.get("pending", use: getPendingBreakpoints)
        breakpoints.post("resume", ":requestId", use: resumeBreakpoint)
    }

    // MARK: - 规则管理

    func listBreakpointRules(req: Request) async throws -> [BreakpointRuleDTO] {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let rules = try await BreakpointRuleModel.query(on: req.db)
            .filter(\.$deviceId == deviceId)
            .sort(\.$priority, .descending)
            .all()

        return rules.map { $0.toDTO() }
    }

    func createBreakpointRule(req: Request) async throws -> BreakpointRuleDTO {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }

        let input = try req.content.decode(BreakpointRuleInput.self)

        let model = BreakpointRuleModel(
            id: UUID().uuidString,
            deviceId: deviceId,
            name: input.name ?? "",
            urlPattern: input.urlPattern,
            method: input.method,
            phase: input.phase ?? "request",
            enabled: input.enabled ?? true,
            priority: input.priority ?? 0
        )

        try await model.save(on: req.db)

        // 同步到设备
        syncBreakpointRulesToDevice(deviceId: deviceId, db: req.db)

        return model.toDTO()
    }

    func updateBreakpointRule(req: Request) async throws -> BreakpointRuleDTO {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let ruleId = req.parameters.get("ruleId") else {
            throw Abort(.badRequest, reason: "Missing deviceId or ruleId")
        }

        guard
            let model = try await BreakpointRuleModel.query(on: req.db)
                .filter(\.$id == ruleId)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound, reason: "Breakpoint rule not found")
        }

        let input = try req.content.decode(BreakpointRuleInput.self)

        // 只更新提供的字段
        if let name = input.name { model.name = name }
        if let urlPattern = input.urlPattern { model.urlPattern = urlPattern }
        if let method = input.method { model.method = method }
        if let phase = input.phase { model.phase = phase }
        if let enabled = input.enabled { model.enabled = enabled }
        if let priority = input.priority { model.priority = priority }

        try await model.save(on: req.db)

        // 同步到设备
        syncBreakpointRulesToDevice(deviceId: deviceId, db: req.db)

        return model.toDTO()
    }

    func deleteBreakpointRule(req: Request) async throws -> HTTPStatus {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let ruleId = req.parameters.get("ruleId") else {
            throw Abort(.badRequest, reason: "Missing deviceId or ruleId")
        }

        guard
            let model = try await BreakpointRuleModel.query(on: req.db)
                .filter(\.$id == ruleId)
                .filter(\.$deviceId == deviceId)
                .first()
        else {
            throw Abort(.notFound, reason: "Breakpoint rule not found")
        }

        try await model.delete(on: req.db)

        // 同步到设备
        syncBreakpointRulesToDevice(deviceId: deviceId, db: req.db)

        return .noContent
    }

    // MARK: - 断点操作

    func getPendingBreakpoints(req _: Request) async throws -> [BreakpointHitDTO] {
        BreakpointManager.shared.getPendingHits()
    }

    func resumeBreakpoint(req: Request) async throws -> HTTPStatus {
        guard
            let deviceId = req.parameters.get("deviceId"),
            let requestId = req.parameters.get("requestId") else {
            throw Abort(.badRequest, reason: "Missing deviceId or requestId")
        }

        let action = try req.content.decode(BreakpointActionDTO.self)
        
        // 从 pending hit 中获取 breakpointId
        let breakpointId = BreakpointManager.shared.getPendingHits()
            .first { $0.requestId == requestId }?.breakpointId ?? ""
        
        // 使用新的格式创建 resume，与 iOS SDK 格式匹配
        let resume = BreakpointResumeDTO.from(
            requestId: requestId,
            breakpointId: breakpointId,
            actionDTO: action
        )

        // 发送到设备
        DeviceRegistry.shared.sendMessage(to: deviceId, message: .breakpointResume(resume))

        // 移除等待中的断点
        BreakpointManager.shared.removePendingHit(requestId: requestId)

        return .ok
    }

    // MARK: - Helpers

    private func syncBreakpointRulesToDevice(deviceId: String, db: Database) {
        Task {
            let rules = try? await BreakpointRuleModel.query(on: db)
                .filter(\.$deviceId == deviceId)
                .filter(\.$enabled == true)
                .sort(\.$priority, .descending)
                .all()

            let dtos = rules?.map { $0.toDTO() } ?? []
            DeviceRegistry.shared.sendMessage(to: deviceId, message: .updateBreakpointRules(dtos))
        }
    }
}

// MARK: - Input DTO

struct BreakpointRuleInput: Content {
    let name: String?
    let urlPattern: String?
    let method: String?
    let phase: String?
    let enabled: Bool?
    let priority: Int?
}

// MARK: - Database Model

final class BreakpointRuleModel: Model, Content, @unchecked Sendable {
    static let schema = "breakpoint_rules"

    @ID(custom: "id", generatedBy: .user)
    var id: String?

    @Field(key: "device_id")
    var deviceId: String

    @Field(key: "name")
    var name: String

    @Field(key: "url_pattern")
    var urlPattern: String?

    @Field(key: "method")
    var method: String?

    @Field(key: "phase")
    var phase: String

    @Field(key: "enabled")
    var enabled: Bool

    @Field(key: "priority")
    var priority: Int

    @Timestamp(key: "created_at", on: .create)
    var createdAt: Date?

    @Timestamp(key: "updated_at", on: .update)
    var updatedAt: Date?

    init() {}

    init(
        id: String,
        deviceId: String,
        name: String,
        urlPattern: String?,
        method: String?,
        phase: String,
        enabled: Bool,
        priority: Int
    ) {
        self.id = id
        self.deviceId = deviceId
        self.name = name
        self.urlPattern = urlPattern
        self.method = method
        self.phase = phase
        self.enabled = enabled
        self.priority = priority
    }

    func toDTO() -> BreakpointRuleDTO {
        BreakpointRuleDTO(
            id: id!,
            name: name,
            urlPattern: urlPattern,
            method: method,
            phase: phase,
            enabled: enabled,
            priority: priority
        )
    }
}
