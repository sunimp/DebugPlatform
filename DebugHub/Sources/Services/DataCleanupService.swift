// DataCleanupService.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Foundation
import Vapor

/// 数据清理服务 - 自动清理过期数据
final class DataCleanupService: LifecycleHandler, @unchecked Sendable {
    static let shared = DataCleanupService()

    private var isRunning = false
    private var cleanupTask: Task<Void, Never>?
    private var app: Application?

    /// 数据保留天数（默认3天）
    var retentionDays: Int = 3

    /// 清理间隔（秒），默认1小时
    var cleanupIntervalSeconds: Int = 3600

    private init() {}

    // MARK: - LifecycleHandler

    func didBoot(_ application: Application) throws {
        start(app: application)
    }

    func shutdown(_ application: Application) {
        stop()
    }

    // MARK: - Public Methods

    /// 启动自动清理服务
    func start(app: Application) {
        guard !isRunning else { return }

        self.app = app
        isRunning = true

        cleanupTask = Task {
            await runCleanupLoop()
        }

        app.logger.info("DataCleanupService started with retention: \(retentionDays) days")
    }

    /// 停止自动清理服务
    func stop() {
        isRunning = false
        cleanupTask?.cancel()
        cleanupTask = nil
        app?.logger.info("DataCleanupService stopped")
    }

    /// 手动触发一次清理
    func cleanupNow() async {
        guard let app else { return }
        await performCleanup(on: app.db)
    }

    /// 更新配置
    func configure(retentionDays: Int, cleanupIntervalSeconds: Int) {
        self.retentionDays = max(1, retentionDays)
        self.cleanupIntervalSeconds = max(60, cleanupIntervalSeconds)
    }

    /// 清空所有数据（危险操作）
    func truncateAll() async -> TruncateResult {
        guard let app else {
            return TruncateResult(success: false, message: "Service not initialized")
        }

        let db = app.db

        do {
            // 统计将要删除的数据量
            let httpCount = try await HTTPEventModel.query(on: db).count()
            let logCount = try await LogEventModel.query(on: db).count()
            let wsFrameCount = try await WSFrameModel.query(on: db).count()
            let wsSessionCount = try await WSSessionModel.query(on: db).count()
            let deviceSessionCount = try await DeviceSessionModel.query(on: db).count()

            // 统计规则数量
            let mockRuleCount = try await MockRuleModel.query(on: db).count()
            let breakpointRuleCount = try await BreakpointRuleModel.query(on: db).count()
            let chaosRuleCount = try await ChaosRuleModel.query(on: db).count()
            let trafficRuleCount = try await TrafficRuleModel.query(on: db).count()

            // 按顺序删除（考虑外键约束）
            try await WSFrameModel.query(on: db).delete()
            try await WSSessionModel.query(on: db).delete()
            try await LogEventModel.query(on: db).delete()
            try await HTTPEventModel.query(on: db).delete()
            try await DeviceSessionModel.query(on: db).delete()

            // 删除所有规则
            try await MockRuleModel.query(on: db).delete()
            try await BreakpointRuleModel.query(on: db).delete()
            try await ChaosRuleModel.query(on: db).delete()
            try await TrafficRuleModel.query(on: db).delete()

            // 重置序号缓存
            await SequenceNumberManager.shared.resetAll()

            let totalDeleted = httpCount + logCount + wsFrameCount + wsSessionCount + deviceSessionCount
            let totalRulesDeleted = mockRuleCount + breakpointRuleCount + chaosRuleCount + trafficRuleCount

            app.logger.warning(
                "Database truncated: HTTP=\(httpCount), Log=\(logCount), WSFrame=\(wsFrameCount), WSSession=\(wsSessionCount), DeviceSession=\(deviceSessionCount), MockRule=\(mockRuleCount), BreakpointRule=\(breakpointRuleCount), ChaosRule=\(chaosRuleCount), TrafficRule=\(trafficRuleCount)"
            )

            return TruncateResult(
                success: true,
                message: "已清空 \(totalDeleted) 条记录，\(totalRulesDeleted) 条规则",
                deletedCounts: TruncateResult.DeletedCounts(
                    http: httpCount,
                    log: logCount,
                    wsFrame: wsFrameCount,
                    wsSession: wsSessionCount,
                    deviceSession: deviceSessionCount
                )
            )
        } catch {
            app.logger.error("Database truncate failed: \(error)")
            return TruncateResult(success: false, message: "清空失败: \(error.localizedDescription)")
        }
    }

    // MARK: - Private Methods

    private func runCleanupLoop() async {
        while isRunning {
            guard let app else { break }

            await performCleanup(on: app.db)

            // 等待下一次清理
            do {
                try await Task.sleep(nanoseconds: UInt64(cleanupIntervalSeconds) * 1_000_000_000)
            } catch {
                break
            }
        }
    }

    private func performCleanup(on db: Database) async {
        let cutoffDate = Calendar.current.date(
            byAdding: .day,
            value: -retentionDays,
            to: Date()
        ) ?? Date()

        do {
            // 清理过期 HTTP 事件（保留收藏的）
            let httpDeleted = try await HTTPEventModel.query(on: db)
                .filter(\.$startTime < cutoffDate)
                .filter(\.$isFavorite == false)
                .count()
            try await HTTPEventModel.query(on: db)
                .filter(\.$startTime < cutoffDate)
                .filter(\.$isFavorite == false)
                .delete()

            // 清理过期日志事件
            let logDeleted = try await LogEventModel.query(on: db)
                .filter(\.$timestamp < cutoffDate)
                .count()
            try await LogEventModel.query(on: db)
                .filter(\.$timestamp < cutoffDate)
                .delete()

            // 清理过期 WebSocket 帧
            let wsFrameDeleted = try await WSFrameModel.query(on: db)
                .filter(\.$timestamp < cutoffDate)
                .count()
            try await WSFrameModel.query(on: db)
                .filter(\.$timestamp < cutoffDate)
                .delete()

            // 清理过期 WebSocket 会话（已断开的）
            let wsSessionDeleted = try await WSSessionModel.query(on: db)
                .filter(\.$connectTime < cutoffDate)
                .filter(\.$disconnectTime != nil)
                .count()
            try await WSSessionModel.query(on: db)
                .filter(\.$connectTime < cutoffDate)
                .filter(\.$disconnectTime != nil)
                .delete()

            // 清理过期性能指标数据
            let perfMetricsDeleted = try await PerformanceMetricsModel.query(on: db)
                .filter(\.$timestamp < cutoffDate)
                .count()
            try await PerformanceMetricsModel.query(on: db)
                .filter(\.$timestamp < cutoffDate)
                .delete()

            // 清理过期卡顿事件
            let jankEventsDeleted = try await JankEventModel.query(on: db)
                .filter(\.$timestamp < cutoffDate)
                .count()
            try await JankEventModel.query(on: db)
                .filter(\.$timestamp < cutoffDate)
                .delete()

            // 清理已解决的过期告警（保留未解决的）
            let alertsDeleted = try await AlertModel.query(on: db)
                .filter(\.$timestamp < cutoffDate)
                .filter(\.$isResolved == true)
                .count()
            try await AlertModel.query(on: db)
                .filter(\.$timestamp < cutoffDate)
                .filter(\.$isResolved == true)
                .delete()

            app?.logger.info(
                "Data cleanup completed: HTTP=\(httpDeleted), Log=\(logDeleted), WSFrame=\(wsFrameDeleted), WSSession=\(wsSessionDeleted), PerfMetrics=\(perfMetricsDeleted), JankEvents=\(jankEventsDeleted), Alerts=\(alertsDeleted)"
            )
        } catch {
            app?.logger.error("Data cleanup failed: \(error)")
        }
    }
}

// MARK: - Cleanup Configuration API

struct CleanupController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let cleanup = routes.grouped("cleanup")

        cleanup.get("config", use: getConfig)
        cleanup.put("config", use: updateConfig)
        cleanup.post("run", use: runCleanup)
        cleanup.post("truncate", use: truncateAll)
    }

    func getConfig(req _: Request) async throws -> CleanupConfigDTO {
        CleanupConfigDTO(
            retentionDays: DataCleanupService.shared.retentionDays,
            cleanupIntervalSeconds: DataCleanupService.shared.cleanupIntervalSeconds
        )
    }

    func updateConfig(req: Request) async throws -> CleanupConfigDTO {
        let config = try req.content.decode(CleanupConfigDTO.self)
        DataCleanupService.shared.configure(
            retentionDays: config.retentionDays,
            cleanupIntervalSeconds: config.cleanupIntervalSeconds
        )
        return CleanupConfigDTO(
            retentionDays: DataCleanupService.shared.retentionDays,
            cleanupIntervalSeconds: DataCleanupService.shared.cleanupIntervalSeconds
        )
    }

    func runCleanup(req _: Request) async throws -> HTTPStatus {
        await DataCleanupService.shared.cleanupNow()
        return .ok
    }

    /// 清空所有数据（危险操作）
    func truncateAll(req: Request) async throws -> TruncateResult {
        req.logger.warning("Truncate all data requested")
        return await DataCleanupService.shared.truncateAll()
    }
}

struct CleanupConfigDTO: Content {
    let retentionDays: Int
    let cleanupIntervalSeconds: Int
}

struct TruncateResult: Content {
    let success: Bool
    let message: String
    var deletedCounts: DeletedCounts?

    struct DeletedCounts: Content {
        let http: Int
        let log: Int
        let wsFrame: Int
        let wsSession: Int
        let deviceSession: Int

        var total: Int {
            http + log + wsFrame + wsSession + deviceSession
        }
    }
}
