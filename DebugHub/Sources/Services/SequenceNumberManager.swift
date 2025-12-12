// SequenceNumberManager.swift
// DebugHub
//
// Created by Sun on 2025/12/21.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent
import Foundation

/// 序号类型
enum SequenceType: String, Hashable {
    case http
    case log
    case wsFrame
}

/// 设备维度的序号管理器
/// 为每个设备的每种事件类型维护递增序号
actor SequenceNumberManager {
    static let shared = SequenceNumberManager()

    /// 设备+类型 -> 当前最大序号
    private var sequences: [String: Int64] = [:]

    private init() {}

    /// 获取序号缓存 key
    private func key(deviceId: String, type: SequenceType) -> String {
        "\(deviceId)_\(type.rawValue)"
    }

    /// 获取下一个序号
    /// - Parameters:
    ///   - deviceId: 设备 ID
    ///   - type: 序号类型
    ///   - db: 数据库连接（首次需要查询当前最大值）
    /// - Returns: 下一个序号
    func nextSeqNum(for deviceId: String, type: SequenceType, db: Database) async -> Int64 {
        let cacheKey = key(deviceId: deviceId, type: type)

        if let current = sequences[cacheKey] {
            let next = current + 1
            sequences[cacheKey] = next
            return next
        }

        // 首次需要查询数据库获取当前最大值
        let maxSeqNum = await fetchMaxSeqNum(for: deviceId, type: type, db: db)

        let next = maxSeqNum + 1
        sequences[cacheKey] = next
        return next
    }

    /// 从数据库查询当前最大序号
    private func fetchMaxSeqNum(for deviceId: String, type: SequenceType, db: Database) async -> Int64 {
        do {
            switch type {
            case .http:
                let maxEvent = try await HTTPEventModel.query(on: db)
                    .filter(\.$deviceId == deviceId)
                    .sort(\.$seqNum, .descending)
                    .first()
                return maxEvent?.seqNum ?? 0

            case .log:
                let maxEvent = try await LogEventModel.query(on: db)
                    .filter(\.$deviceId == deviceId)
                    .sort(\.$seqNum, .descending)
                    .first()
                return maxEvent?.seqNum ?? 0

            case .wsFrame:
                let maxEvent = try await WSFrameModel.query(on: db)
                    .filter(\.$deviceId == deviceId)
                    .sort(\.$seqNum, .descending)
                    .first()
                return maxEvent?.seqNum ?? 0
            }
        } catch {
            print("[SequenceNumberManager] Failed to fetch max seq_num: \(error)")
            return 0
        }
    }

    /// 重置指定设备的序号缓存（当清空数据时调用）
    func reset(for deviceId: String) {
        for type in [SequenceType.http, .log, .wsFrame] {
            let cacheKey = key(deviceId: deviceId, type: type)
            sequences.removeValue(forKey: cacheKey)
        }
    }

    /// 重置所有缓存（当清空全部数据时调用）
    func resetAll() {
        sequences.removeAll()
    }
}
