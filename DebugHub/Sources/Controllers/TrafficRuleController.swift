//
//  TrafficRuleController.swift
//  DebugHub
//
//  Created by Sun on 2025/12/04.
//

import Fluent
import Vapor

struct TrafficRuleController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let rules = routes.grouped("api", "traffic-rules")
        rules.get(use: listRules)
        rules.post(use: createOrUpdateRule)
        rules.delete(":ruleId", use: deleteRule)
        
        // Device specific overrides
        let deviceRules = routes.grouped("api", "devices", ":deviceId", "traffic-rules")
        deviceRules.get(use: listDeviceRules)
    }
    
    // MARK: - List Rules (Global or All)
    
    func listRules(req: Request) async throws -> [TrafficRuleModel] {
        return try await TrafficRuleModel.query(on: req.db)
            .sort(\.$priority, .descending)
            .sort(\.$createdAt, .descending)
            .all()
    }
    
    // MARK: - List Device Rules
    
    func listDeviceRules(req: Request) async throws -> [TrafficRuleModel] {
        guard let deviceId = req.parameters.get("deviceId") else {
            throw Abort(.badRequest, reason: "Missing deviceId")
        }
        
        // Return both global (deviceId is nil) and device specific
        return try await TrafficRuleModel.query(on: req.db)
            .group(.or) { group in
                group.filter(\.$deviceId == nil)
                group.filter(\.$deviceId == deviceId)
            }
            .sort(\.$priority, .descending)
            .sort(\.$createdAt, .descending)
            .all()
    }
    
    // MARK: - Create or Update Rule
    
    func createOrUpdateRule(req: Request) async throws -> TrafficRuleModel {
        let dto = try req.content.decode(TrafficRuleDTO.self)
        
        if let id = dto.id, let existing = try await TrafficRuleModel.find(id, on: req.db) {
            // Update existing
            existing.name = dto.name
            existing.matchType = dto.matchType
            existing.matchValue = dto.matchValue
            existing.action = dto.action
            existing.color = dto.color
            existing.isEnabled = dto.isEnabled
            existing.priority = dto.priority
            try await existing.save(on: req.db)
            return existing
        } else {
            // Create new - generate UUID if not provided
            let newId = dto.id ?? UUID().uuidString
            let rule = TrafficRuleModel(
                id: newId,
                deviceId: dto.deviceId,
                name: dto.name,
                matchType: dto.matchType,
                matchValue: dto.matchValue,
                action: dto.action,
                color: dto.color,
                isEnabled: dto.isEnabled,
                priority: dto.priority
            )
            try await rule.save(on: req.db)
            return rule
        }
    }
    
    // MARK: - Delete Rule
    
    func deleteRule(req: Request) async throws -> HTTPStatus {
        guard let ruleId = req.parameters.get("ruleId") else {
            throw Abort(.badRequest)
        }
        
        guard let rule = try await TrafficRuleModel.find(ruleId, on: req.db) else {
            throw Abort(.notFound)
        }
        
        try await rule.delete(on: req.db)
        return .ok
    }
}

struct TrafficRuleDTO: Content {
    let id: String?
    let deviceId: String?
    let name: String
    let matchType: TrafficRuleMatchType
    let matchValue: String
    let action: TrafficRuleAction
    let color: String?
    let isEnabled: Bool
    let priority: Int
}
