// Migrations.swift
// DebugHub
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Fluent

// MARK: - HTTP Event Migration

struct CreateHTTPEvent: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("http_events")
            .field("id", .string, .identifier(auto: false))
            .field("device_id", .string, .required)
            .field("method", .string, .required)
            .field("url", .string, .required)
            .field("query_items", .string, .required)
            .field("request_headers", .string, .required)
            .field("request_body", .data)
            .field("status_code", .int)
            .field("response_headers", .string)
            .field("response_body", .data)
            .field("start_time", .datetime, .required)
            .field("end_time", .datetime)
            .field("duration", .double)
            .field("error_description", .string)
            .field("is_mocked", .bool, .required)
            .field("mock_rule_id", .string)
            .field("trace_id", .string)
            .create()

        // Note: No need to add .unique(on: "id") constraint separately
        // The id field with .identifier(auto: false) is already the primary key
        // and primary keys are inherently unique

        // // 创建索引
        // try await database.schema("http_events")
        //     .unique(on: "id")
        //     .update()
    }

    func revert(on database: Database) async throws {
        try await database.schema("http_events").delete()
    }
}

// MARK: - WebSocket Session Migration

struct CreateWSSession: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("ws_sessions")
            .field("id", .string, .identifier(auto: false))
            .field("device_id", .string, .required)
            .field("url", .string, .required)
            .field("request_headers", .string, .required)
            .field("subprotocols", .string, .required)
            .field("connect_time", .datetime, .required)
            .field("disconnect_time", .datetime)
            .field("close_code", .int)
            .field("close_reason", .string)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("ws_sessions").delete()
    }
}

// MARK: - WebSocket Frame Migration

struct CreateWSFrame: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("ws_frames")
            .field("id", .string, .identifier(auto: false))
            .field("device_id", .string, .required)
            .field("session_id", .string, .required)
            .field("direction", .string, .required)
            .field("opcode", .string, .required)
            .field("payload", .data, .required)
            .field("payload_preview", .string)
            .field("timestamp", .datetime, .required)
            .field("is_mocked", .bool, .required)
            .field("mock_rule_id", .string)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("ws_frames").delete()
    }
}

// MARK: - Log Event Migration

struct CreateLogEvent: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("log_events")
            .field("id", .string, .identifier(auto: false))
            .field("device_id", .string, .required)
            .field("source", .string, .required)
            .field("timestamp", .datetime, .required)
            .field("level", .string, .required)
            .field("subsystem", .string)
            .field("category", .string)
            .field("logger_name", .string)
            .field("thread", .string)
            .field("file", .string)
            .field("function", .string)
            .field("line", .int)
            .field("message", .string, .required)
            .field("tags", .string, .required)
            .field("trace_id", .string)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("log_events").delete()
    }
}

// MARK: - Mock Rule Migration

struct CreateMockRule: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("mock_rules")
            .field("id", .string, .identifier(auto: false))
            .field("device_id", .string)
            .field("name", .string, .required)
            .field("target_type", .string, .required)
            .field("condition_json", .string, .required)
            .field("action_json", .string, .required)
            .field("priority", .int, .required)
            .field("enabled", .bool, .required)
            .field("created_at", .datetime)
            .field("updated_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("mock_rules").delete()
    }
}

// MARK: - Add HTTP Timing Migration

struct AddHTTPTiming: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("http_events")
            .field("timing_json", .string)
            .update()
    }

    func revert(on database: Database) async throws {
        try await database.schema("http_events")
            .deleteField("timing_json")
            .update()
    }
}

// MARK: - Breakpoint Rule Migration

struct CreateBreakpointRule: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("breakpoint_rules")
            .field("id", .string, .identifier(auto: false))
            .field("device_id", .string, .required)
            .field("name", .string, .required)
            .field("url_pattern", .string)
            .field("method", .string)
            .field("phase", .string, .required)
            .field("enabled", .bool, .required)
            .field("priority", .int, .required)
            .field("created_at", .datetime)
            .field("updated_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("breakpoint_rules").delete()
    }
}

// MARK: - Chaos Rule Migration

struct CreateChaosRule: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("chaos_rules")
            .field("id", .string, .identifier(auto: false))
            .field("device_id", .string, .required)
            .field("name", .string, .required)
            .field("url_pattern", .string)
            .field("method", .string)
            .field("probability", .double, .required)
            .field("chaos_json", .string, .required)
            .field("enabled", .bool, .required)
            .field("priority", .int, .required)
            .field("created_at", .datetime)
            .field("updated_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("chaos_rules").delete()
    }
}

// MARK: - Add HTTP Event Favorite Migration

struct AddHTTPEventFavorite: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("http_events")
            .field("is_favorite", .bool, .required, .sql(.default(false)))
            .update()
    }

    func revert(on database: Database) async throws {
        try await database.schema("http_events")
            .deleteField("is_favorite")
            .update()
    }
}

// MARK: - Add HTTP Body Params Migration

struct AddHTTPBodyParams: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("http_events")
            .field("body_params", .string)
            .update()
    }

    func revert(on database: Database) async throws {
        try await database.schema("http_events")
            .deleteField("body_params")
            .update()
    }
}

// MARK: - Create HTTP Event Param Migration

struct CreateHTTPEventParam: AsyncMigration {
    func prepare(on database: Database) async throws {
        // Create Table with composite index
        try await database.schema("http_event_params")
            .field("id", .string, .identifier(auto: false))
            .field("event_id", .string, .required) // 关联 http_events.id
            .field("param_key", .string, .required)
            .field("param_value", .string, .required)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("http_event_params").delete()
    }
}

// MARK: - Create Traffic Rule Migration

struct CreateTrafficRule: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("traffic_rules")
            .field("id", .string, .identifier(auto: false))
            .field("device_id", .string)
            .field("name", .string, .required)
            .field("match_type", .string, .required)
            .field("match_value", .string, .required)
            .field("action", .string, .required)
            .field("color", .string)
            .field("is_enabled", .bool, .required)
            .field("priority", .int, .required)
            .field("created_at", .datetime)
            .field("updated_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("traffic_rules").delete()
    }
}

// MARK: - Create Domain Policy Migration

struct CreateDomainPolicy: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("domain_policies")
            .field("id", .string, .identifier(auto: false))
            .field("device_id", .string)
            .field("domain", .string, .required)
            .field("status", .string, .required)
            .field("note", .string)
            .field("created_at", .datetime)
            .field("updated_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("domain_policies").delete()
    }
}

// MARK: - Add HTTP Event Replay Flag Migration

struct AddHTTPEventReplay: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("http_events")
            .field("is_replay", .bool, .required, .sql(.default(false)))
            .update()
    }

    func revert(on database: Database) async throws {
        try await database.schema("http_events")
            .deleteField("is_replay")
            .update()
    }
}

// MARK: - Add Sequence Number Migration

/// 为 HTTP 事件、Log 事件、WebSocket 帧添加序号字段
/// 序号在设备维度递增，删除数据后原有数据的序号不变
struct AddSequenceNumber: AsyncMigration {
    func prepare(on database: Database) async throws {
        // HTTP 事件添加序号
        try await database.schema("http_events")
            .field("seq_num", .int64, .required, .sql(.default(0)))
            .update()

        // Log 事件添加序号
        try await database.schema("log_events")
            .field("seq_num", .int64, .required, .sql(.default(0)))
            .update()

        // WebSocket 帧添加序号
        try await database.schema("ws_frames")
            .field("seq_num", .int64, .required, .sql(.default(0)))
            .update()
    }

    func revert(on database: Database) async throws {
        try await database.schema("http_events")
            .deleteField("seq_num")
            .update()

        try await database.schema("log_events")
            .deleteField("seq_num")
            .update()

        try await database.schema("ws_frames")
            .deleteField("seq_num")
            .update()
    }
}
