//
//  StatsController.swift
//  DebugHub
//
//  Created by Sun on 2025/12/05.
//

import Fluent
import FluentSQL
import Vapor

// 用于解析 PostgreSQL pg_database_size 返回结果
struct DatabaseSizeRow: Decodable {
    let size: Int64
}

struct StatsController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let stats = routes.grouped("stats")
        stats.get(use: getStats)
    }
    
    // MARK: - Get Server Stats
    
    func getStats(req: Request) async throws -> ServerStatsDTO {
        // 获取各表的记录数
        let httpCount = try await HTTPEventModel.query(on: req.db).count()
        let logCount = try await LogEventModel.query(on: req.db).count()
        let wsSessionCount = try await WSSessionModel.query(on: req.db).count()
        let wsFrameCount = try await WSFrameModel.query(on: req.db).count()
        let mockRuleCount = try await MockRuleModel.query(on: req.db).count()
        let breakpointRuleCount = try await BreakpointRuleModel.query(on: req.db).count()
        let chaosRuleCount = try await ChaosRuleModel.query(on: req.db).count()
        let trafficRuleCount = try await TrafficRuleModel.query(on: req.db).count()
        let deviceSessionCount = try await DeviceSessionModel.query(on: req.db).count()
        
        // 获取数据库大小
        var databaseSizeBytes: Int64?
        let databaseMode = Environment.get("DATABASE_MODE")?.lowercased() ?? "postgres"
        
        if databaseMode == "sqlite" {
            // SQLite: 获取文件大小
            let dataDir = getDataDirectory()
            let dbPath = Environment.get("SQLITE_PATH") ?? "\(dataDir)/debug_hub.sqlite"
            let fileManager = FileManager.default
            if let attrs = try? fileManager.attributesOfItem(atPath: dbPath),
               let fileSize = attrs[.size] as? Int64 {
                databaseSizeBytes = fileSize
            }
        } else {
            // PostgreSQL: 使用 pg_database_size 获取数据库大小
            let dbName = Environment.get("DATABASE_NAME") ?? "debug_hub"
            if let rawSQL = req.db as? SQLDatabase {
                let result = try? await rawSQL.raw("SELECT pg_database_size('\(unsafeRaw: dbName)') as size").first(decoding: DatabaseSizeRow.self)
                databaseSizeBytes = result?.size
            }
        }
        
        // 在线设备数量
        let onlineDeviceCount = DeviceRegistry.shared.getAllSessions().count
        
        return ServerStatsDTO(
            httpEventCount: httpCount,
            logEventCount: logCount,
            wsSessionCount: wsSessionCount,
            wsFrameCount: wsFrameCount,
            mockRuleCount: mockRuleCount,
            breakpointRuleCount: breakpointRuleCount,
            chaosRuleCount: chaosRuleCount,
            trafficRuleCount: trafficRuleCount,
            deviceSessionCount: deviceSessionCount,
            onlineDeviceCount: onlineDeviceCount,
            databaseSizeBytes: databaseSizeBytes,
            databaseMode: databaseMode
        )
    }
}

// MARK: - DTOs

struct ServerStatsDTO: Content {
    let httpEventCount: Int
    let logEventCount: Int
    let wsSessionCount: Int
    let wsFrameCount: Int
    let mockRuleCount: Int
    let breakpointRuleCount: Int
    let chaosRuleCount: Int
    let trafficRuleCount: Int
    let deviceSessionCount: Int
    let onlineDeviceCount: Int
    let databaseSizeBytes: Int64?
    let databaseMode: String
}
