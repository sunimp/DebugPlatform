// BreakpointEngine.swift
// DebugPlatform
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Foundation

// MARK: - Pending Breakpoints Manager (Actor)

/// 使用 actor 管理待处理的断点，确保并发安全
private actor PendingBreakpointsManager {
    private var breakpoints: [String: CheckedContinuation<BreakpointAction, Never>] = [:]

    func store(requestId: String, continuation: CheckedContinuation<BreakpointAction, Never>) {
        breakpoints[requestId] = continuation
    }

    func remove(requestId: String) -> CheckedContinuation<BreakpointAction, Never>? {
        breakpoints.removeValue(forKey: requestId)
    }

    func resume(requestId: String, action: BreakpointAction) -> Bool {
        if let continuation = breakpoints.removeValue(forKey: requestId) {
            continuation.resume(returning: action)
            return true
        }
        return false
    }
}

// MARK: - Request Breakpoint Result

/// 请求阶段断点处理结果
public enum RequestBreakpointResult {
    /// 继续请求（可能已修改）
    case proceed(URLRequest)
    /// 中止请求（不发送，不返回响应）
    case abort
    /// 返回 Mock 响应（不发送实际请求，直接返回此响应）
    case mockResponse(BreakpointResponseSnapshot)
}

// MARK: - Breakpoint Engine

/// 断点引擎，负责管理断点规则和拦截请求
public final class BreakpointEngine {
    // MARK: - Singleton

    public static let shared = BreakpointEngine()

    // MARK: - Properties

    private var rules: [BreakpointRule] = []
    private let rulesLock = NSLock()

    /// 等待中的断点管理器（使用 actor 确保并发安全）
    private let pendingManager = PendingBreakpointsManager()

    /// 断点超时时间（秒）
    public var breakpointTimeout: TimeInterval = 30

    /// 是否启用断点功能
    public var isEnabled: Bool = true

    // MARK: - Lifecycle

    private init() {}

    // MARK: - Rule Management

    /// 更新断点规则列表
    public func updateRules(_ newRules: [BreakpointRule]) {
        rulesLock.lock()
        rules = newRules.sorted { $0.priority > $1.priority }
        rulesLock.unlock()
        DebugLog.debug(.breakpoint, "Updated \(newRules.count) rules")
    }

    /// 添加断点规则
    public func addRule(_ rule: BreakpointRule) {
        rulesLock.lock()
        rules.append(rule)
        rules.sort { $0.priority > $1.priority }
        rulesLock.unlock()
    }

    /// 移除断点规则
    public func removeRule(id: String) {
        rulesLock.lock()
        rules.removeAll { $0.id == id }
        rulesLock.unlock()
    }

    /// 清空所有规则
    public func clearRules() {
        rulesLock.lock()
        rules.removeAll()
        rulesLock.unlock()
    }

    /// 获取当前规则列表
    public func getRules() -> [BreakpointRule] {
        rulesLock.lock()
        defer { rulesLock.unlock() }
        return rules
    }

    // MARK: - Request Phase Breakpoint

    /// 检查并处理请求阶段断点
    /// - Returns: 断点处理结果（继续/中止/Mock响应）
    public func checkRequestBreakpoint(
        requestId: String,
        request: URLRequest
    ) async -> RequestBreakpointResult {
        guard isEnabled else { return .proceed(request) }

        guard let rule = matchingRule(for: request, phase: .request) else {
            return .proceed(request)
        }

        let snapshot = BreakpointRequestSnapshot(from: request)
        let hit = BreakpointHit(
            breakpointId: rule.id,
            requestId: requestId,
            phase: .request,
            request: snapshot,
            response: nil
        )

        // 通知 Debug Hub 断点命中
        notifyBreakpointHit(hit)

        // 等待用户操作
        let action = await waitForAction(requestId: requestId)

        switch action {
        case .resume:
            return .proceed(request)

        case let .modify(modification):
            if
                let modifiedRequest = modification.request,
                let urlRequest = modifiedRequest.toURLRequest() {
                return .proceed(urlRequest)
            }
            return .proceed(request)

        case .abort:
            return .abort

        case let .mockResponse(response):
            // 返回 Mock 响应，调用方应直接使用此响应而不发起实际请求
            return .mockResponse(response)
        }
    }

    /// 检查并处理响应阶段断点
    /// - Returns: 修改后的响应，或 nil 表示使用原响应
    public func checkResponseBreakpoint(
        requestId: String,
        request: URLRequest,
        response: HTTPURLResponse,
        body: Data?
    ) async -> BreakpointResponseSnapshot? {
        guard isEnabled else { return nil }

        guard let rule = matchingRule(for: request, phase: .response) else {
            return nil
        }

        let requestSnapshot = BreakpointRequestSnapshot(from: request)
        let responseSnapshot = BreakpointResponseSnapshot(
            statusCode: response.statusCode,
            headers: (response.allHeaderFields as? [String: String]) ?? [:],
            body: body
        )

        let hit = BreakpointHit(
            breakpointId: rule.id,
            requestId: requestId,
            phase: .response,
            request: requestSnapshot,
            response: responseSnapshot
        )

        // 通知 Debug Hub 断点命中
        notifyBreakpointHit(hit)

        // 等待用户操作
        let action = await waitForAction(requestId: requestId)

        switch action {
        case .resume:
            return nil

        case let .modify(modification):
            return modification.response

        case .abort:
            // 响应阶段中止意味着返回错误
            return BreakpointResponseSnapshot(
                statusCode: 0,
                headers: [:],
                body: "Request aborted by breakpoint".data(using: .utf8)
            )

        case let .mockResponse(response):
            return response
        }
    }

    // MARK: - Resume Breakpoint

    /// 恢复断点（由 Debug Hub 调用）
    public func resumeBreakpoint(_ resume: BreakpointResume) {
        Task {
            await resumeBreakpoint(requestId: resume.requestId, action: resume.action)
        }
    }
    
    /// 恢复断点（直接调用）
    public func resumeBreakpoint(requestId: String, action: BreakpointAction) async {
        let resumed = await pendingManager.resume(requestId: requestId, action: action)
        if !resumed {
            DebugLog.debug(.breakpoint, "No pending breakpoint for requestId: \(requestId)")
        }
    }

    // MARK: - Private Methods

    private func matchingRule(for request: URLRequest, phase: BreakpointPhase) -> BreakpointRule? {
        rulesLock.lock()
        defer { rulesLock.unlock() }

        for rule in rules {
            guard rule.enabled else { continue }
            guard rule.phase == phase || rule.phase == .both else { continue }

            // 检查 URL 匹配
            if let pattern = rule.urlPattern, !pattern.isEmpty {
                guard let url = request.url?.absoluteString else { continue }

                // 支持通配符匹配
                if pattern.contains("*") {
                    let regex = pattern
                        .replacingOccurrences(of: ".", with: "\\.")
                        .replacingOccurrences(of: "*", with: ".*")
                    if url.range(of: regex, options: .regularExpression) == nil {
                        continue
                    }
                } else if !url.contains(pattern) {
                    continue
                }
            }

            // 检查方法匹配
            if let method = rule.method, !method.isEmpty {
                guard request.httpMethod?.uppercased() == method.uppercased() else { continue }
            }

            return rule
        }

        return nil
    }

    private func notifyBreakpointHit(_ hit: BreakpointHit) {
        // 通过 DebugProbe 的 bridgeClient 发送断点命中事件
        DebugProbe.shared.bridgeClient.sendBreakpointHit(hit)
    }

    private func waitForAction(requestId: String) async -> BreakpointAction {
        let timeout = breakpointTimeout

        return await withCheckedContinuation { continuation in
            // 存储 continuation 到 actor
            Task {
                await pendingManager.store(requestId: requestId, continuation: continuation)
            }

            // 设置超时任务
            Task {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))

                // 尝试超时处理
                if let continuation = await pendingManager.remove(requestId: requestId) {
                    DebugLog.debug(.breakpoint, "Breakpoint timeout for requestId: \(requestId)")
                    continuation.resume(returning: .resume)
                }
            }
        }
    }
}
