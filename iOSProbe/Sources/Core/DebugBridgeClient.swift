// DebugBridgeClient.swift
// DebugPlatform
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Foundation

/// Debug Bridge 客户端，负责与 Mac mini Debug Hub 通信
public final class DebugBridgeClient: NSObject {
    // MARK: - Configuration

    public struct Configuration {
        public let hubURL: URL
        public let token: String

        /// 初始重连间隔（秒）
        public var reconnectInterval: TimeInterval = 3.0

        /// 最大重连间隔（秒）- 指数退避上限
        public var maxReconnectInterval: TimeInterval = 30.0

        /// 最大重连尝试次数（0 = 无限）
        public var maxReconnectAttempts: Int = 0

        /// 心跳间隔（更频繁的心跳可以更快检测连接问题）
        public var heartbeatInterval: TimeInterval = 15.0

        public var batchSize: Int = 100
        public var flushInterval: TimeInterval = 1.0

        /// 是否启用事件持久化（断线时保存到本地）
        public var enablePersistence: Bool = true

        /// 重连后恢复发送的批量大小
        public var recoveryBatchSize: Int = 50

        /// 持久化队列配置
        public var persistenceConfig: EventPersistenceQueue.Configuration = .init()

        public init(hubURL: URL, token: String) {
            self.hubURL = hubURL
            self.token = token
        }
    }

    // MARK: - State

    public enum ConnectionState {
        case disconnected
        case connecting
        case connected
        case registered
    }

    public private(set) var state: ConnectionState = .disconnected
    public private(set) var sessionId: String?

    // MARK: - Callbacks

    public var onStateChanged: ((ConnectionState) -> Void)?
    public var onMockRulesReceived: (([MockRule]) -> Void)?
    public var onCaptureToggled: ((Bool, Bool) -> Void)?
    public var onError: ((Error) -> Void)?

    // MARK: - Private Properties

    private var configuration: Configuration?
    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var heartbeatTimer: Timer?
    private var flushTimer: Timer?
    private var reconnectTimer: Timer?
    private var recoveryTimer: Timer?
    private let workQueue = DispatchQueue(label: "com.sunimp.debugplatform.bridge", qos: .utility)
    private var isManualDisconnect = false
    private var eventBusSubscriptionId: String?
    private var isRecovering = false
    private var pendingEventIds: [String] = [] // 正在发送中的事件ID

    /// 重连尝试次数
    private var reconnectAttempts = 0

    /// 当前重连间隔（指数退避）
    private var currentReconnectInterval: TimeInterval = 5.0

    /// 是否正在重连中
    private var isReconnecting = false
    private var isFlushing = false

    // MARK: - Lifecycle

    override public init() {
        super.init()
    }

    deinit {
        disconnect()
    }

    // MARK: - Connection Management

    /// 连接到 Debug Hub
    public func connect(configuration: Configuration) {
        self.configuration = configuration

        workQueue.async { [weak self] in
            self?.internalConnect()
        }
    }

    /// 断开连接
    public func disconnect() {
        isManualDisconnect = true
        workQueue.async { [weak self] in
            self?.internalDisconnect()
        }
    }

    private func internalConnect() {
        guard let configuration, state == .disconnected else { return }

        updateState(.connecting)
        isManualDisconnect = false

        // 初始化持久化队列
        if configuration.enablePersistence {
            EventPersistenceQueue.shared.initialize(configuration: configuration.persistenceConfig)
        }

        // 创建 WebSocket 连接
        var request = URLRequest(url: configuration.hubURL)
        request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")

        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        urlSession = session
        webSocketTask = session.webSocketTask(with: request)
        webSocketTask?.resume()

        // 开始接收消息
        receiveMessage()
    }

    private func internalDisconnect() {
        stopTimers()

        if let subscriptionId = eventBusSubscriptionId {
            DebugEventBus.shared.unsubscribe(id: subscriptionId)
            eventBusSubscriptionId = nil
        }

        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        sessionId = nil

        updateState(.disconnected)
    }

    // MARK: - Message Handling

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case let .success(message):
                self?.handleMessage(message)
                self?.receiveMessage() // 继续接收下一条消息
            case let .failure(error):
                self?.handleError(error)
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case let .string(text):
            data = Data(text.utf8)
        case let .data(d):
            data = d
        @unknown default:
            return
        }

        do {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let bridgeMessage = try decoder.decode(BridgeMessage.self, from: data)
            handleBridgeMessage(bridgeMessage)
        } catch {
            DebugLog.error(.bridge, "Failed to decode message: \(error)")
        }
    }

    private func handleBridgeMessage(_ message: BridgeMessage) {
        switch message {
        case let .registered(sessionId):
            self.sessionId = sessionId
            updateState(.registered)
            startTimers()

            // 连接成功，重置重连状态
            resetReconnectState()

            // 连接成功后，开始恢复发送持久化的事件
            if configuration?.enablePersistence == true {
                startRecovery()
            }

        case let .toggleCapture(network, log):
            DispatchQueue.main.async { [weak self] in
                self?.onCaptureToggled?(network, log)
            }

        case let .updateMockRules(rules):
            DispatchQueue.main.async { [weak self] in
                self?.onMockRulesReceived?(rules)
            }
            
        case let .updateBreakpointRules(rules):
            DebugLog.info(.bridge, "Received \(rules.count) breakpoint rules")
            // 更新断点引擎规则
            BreakpointEngine.shared.updateRules(rules)
            
        case let .updateChaosRules(rules):
            DebugLog.info(.bridge, "Received \(rules.count) chaos rules")
            // 更新故障注入引擎规则
            ChaosEngine.shared.updateRules(rules)
            
        case let .replayRequest(payload):
            DebugLog.info(.bridge, "Received replay request for \(payload.url)")
            executeReplayRequest(payload)
            
        case let .breakpointResume(payload):
            DebugLog.info(.bridge, "Received breakpoint resume for \(payload.requestId)")
            // 恢复断点
            Task {
                await BreakpointEngine.shared.resumeBreakpoint(
                    requestId: payload.requestId,
                    action: mapBreakpointAction(payload)
                )
            }
            
        case let .dbCommand(command):
            DebugLog.info(.bridge, "Received DB command: \(command.kind.rawValue)")
            handleDBCommand(command)

        case let .error(code, errorMessage):
            let error = NSError(domain: "DebugBridge", code: code, userInfo: [NSLocalizedDescriptionKey: errorMessage])
            handleError(error)

        default:
            // 其他消息类型（如 register, heartbeat, events 等是发送消息，不应接收）
            break
        }
    }
    
    /// 执行请求重放
    private func executeReplayRequest(_ payload: ReplayRequestPayload) {
        guard let url = URL(string: payload.url) else {
            DebugLog.error(.bridge, "Invalid URL for replay: \(payload.url)")
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = payload.method
        
        // 设置请求头
        for (key, value) in payload.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        
        // 设置请求体
        request.httpBody = payload.bodyData
        
        // 使用非监控的 session 执行请求，避免重放请求也被记录
        let session = URLSession(configuration: .ephemeral)
        
        DebugLog.info(.bridge, "Executing replay request: \(payload.method) \(payload.url)")
        
        session.dataTask(with: request) { data, response, error in
            if let error = error {
                DebugLog.error(.bridge, "Replay request failed: \(error.localizedDescription)")
                return
            }
            
            if let httpResponse = response as? HTTPURLResponse {
                DebugLog.info(.bridge, "Replay request completed: \(httpResponse.statusCode)")
            }
            
            // 可选：发送重放结果回服务端
            // self?.sendReplayResult(id: payload.id, response: response, data: data, error: error)
        }.resume()
    }
    
    /// 将 BreakpointResumePayload 转换为 BreakpointAction
    private func mapBreakpointAction(_ payload: BreakpointResumePayload) -> BreakpointAction {
        switch payload.action.lowercased() {
        case "continue", "resume":
            return .resume
        case "abort":
            return .abort
        case "modify":
            // 处理修改请求
            if let mod = payload.modifiedRequest {
                let request = BreakpointRequestSnapshot(
                    method: mod.method ?? "GET",
                    url: mod.url ?? "",
                    headers: mod.headers ?? [:],
                    body: mod.bodyData
                )
                return .modify(BreakpointModification(request: request, response: nil))
            }
            // 处理修改响应
            if let mod = payload.modifiedResponse {
                let response = BreakpointResponseSnapshot(
                    statusCode: mod.statusCode ?? 200,
                    headers: mod.headers ?? [:],
                    body: mod.bodyData
                )
                return .modify(BreakpointModification(request: nil, response: response))
            }
            return .resume
        case "mockresponse":
            // 处理 Mock 响应
            if let mod = payload.modifiedResponse {
                let response = BreakpointResponseSnapshot(
                    statusCode: mod.statusCode ?? 200,
                    headers: mod.headers ?? [:],
                    body: mod.bodyData
                )
                return .mockResponse(response)
            }
            return .resume
        default:
            return .resume
        }
    }
    
    // MARK: - DB Inspector Commands
    
    /// 处理数据库检查命令
    private func handleDBCommand(_ command: DBCommand) {
        Task {
            let response = await executeDBCommand(command)
            send(.dbResponse(response))
        }
    }
    
    /// 执行数据库命令并返回响应
    private func executeDBCommand(_ command: DBCommand) async -> DBResponse {
        let inspector = SQLiteInspector.shared
        
        do {
            switch command.kind {
            case .listDatabases:
                let databases = try await inspector.listDatabases()
                let payload = DBListDatabasesResponse(databases: databases)
                return try DBResponse.success(requestId: command.requestId, data: payload)
                
            case .listTables:
                guard let dbId = command.dbId else {
                    return DBResponse.failure(requestId: command.requestId, error: .invalidQuery("dbId is required"))
                }
                let tables = try await inspector.listTables(dbId: dbId)
                let payload = DBListTablesResponse(dbId: dbId, tables: tables)
                return try DBResponse.success(requestId: command.requestId, data: payload)
                
            case .describeTable:
                guard let dbId = command.dbId, let table = command.table else {
                    return DBResponse.failure(requestId: command.requestId, error: .invalidQuery("dbId and table are required"))
                }
                let columns = try await inspector.describeTable(dbId: dbId, table: table)
                let payload = DBDescribeTableResponse(dbId: dbId, table: table, columns: columns)
                return try DBResponse.success(requestId: command.requestId, data: payload)
                
            case .fetchTablePage:
                guard let dbId = command.dbId, let table = command.table else {
                    return DBResponse.failure(requestId: command.requestId, error: .invalidQuery("dbId and table are required"))
                }
                let result = try await inspector.fetchTablePage(
                    dbId: dbId,
                    table: table,
                    page: command.page ?? 1,
                    pageSize: command.pageSize ?? 50,
                    orderBy: command.orderBy,
                    ascending: command.ascending ?? true
                )
                return try DBResponse.success(requestId: command.requestId, data: result)
                
            case .executeQuery:
                guard let dbId = command.dbId, let query = command.query else {
                    return DBResponse.failure(requestId: command.requestId, error: .invalidQuery("dbId and query are required"))
                }
                let result = try await inspector.executeQuery(dbId: dbId, query: query)
                return try DBResponse.success(requestId: command.requestId, data: result)
            }
        } catch let error as DBInspectorError {
            return DBResponse.failure(requestId: command.requestId, error: error)
        } catch {
            return DBResponse.failure(requestId: command.requestId, error: .internalError(error.localizedDescription))
        }
    }

    private func handleError(_ error: Error) {
        // 过滤掉预期的断开错误，减少日志噪音
        let nsError = error as NSError
        let isExpectedDisconnect = nsError.domain == NSPOSIXErrorDomain && nsError.code == 57 // Socket is not connected

        if !isExpectedDisconnect {
            DispatchQueue.main.async { [weak self] in
                self?.onError?(error)
            }
        }

        if !isManualDisconnect, state != .disconnected {
            scheduleReconnect()
        }
    }

    // MARK: - Sending Messages

    /// 发送断点命中事件
    public func sendBreakpointHit(_ hit: BreakpointHit) {
        send(.breakpointHit(hit))
    }

    private func send(_ message: BridgeMessage, completion: ((Error?) -> Void)? = nil) {
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(message)

            webSocketTask?.send(.data(data)) { [weak self] error in
                if let error {
                    self?.handleError(error)
                }
                completion?(error)
            }
        } catch {
            DebugLog.error(.bridge, "Failed to encode message: \(error)")
            completion?(error)
        }
    }

    /// 发送设备注册消息
    private func sendRegister() {
        guard let configuration else { return }

        #if canImport(UIKit)
            let deviceInfo = DeviceInfo.current()
        #else
            let deviceInfo = DeviceInfo(
                deviceId: UUID().uuidString,
                deviceName: Host.current().localizedName ?? "Unknown",
                systemName: "macOS",
                systemVersion: ProcessInfo.processInfo.operatingSystemVersionString,
                appName: "Debug Client",
                appVersion: "1.0.0",
                buildNumber: "1"
            )
        #endif

        send(.register(deviceInfo, token: configuration.token))
    }

    /// 发送心跳
    private func sendHeartbeat() {
        send(.heartbeat)
    }

    /// 批量发送事件
    private func flushEvents() {
        guard let configuration else { return }
        guard !isFlushing else { return }

        let events = DebugEventBus.shared.peek(count: configuration.batchSize)
        guard !events.isEmpty else { return }

        // 如果已连接，直接发送
        if state == .registered {
            isFlushing = true
            DebugLog.debug(.bridge, "Flushing \(events.count) events to hub")
            
            send(.events(events)) { [weak self] error in
                guard let self else { return }
                if error == nil {
                    DebugEventBus.shared.removeFirst(events.count)
                } else {
                    DebugLog.error(.bridge, "Failed to flush events, keeping in queue")
                }
                
                self.workQueue.async {
                    self.isFlushing = false
                }
            }
        } else {
            DebugLog.debug(.bridge, "Not registered (state=\(state)), events pending: \(events.count)")
            if configuration.enablePersistence {
                // 未连接时，将事件存入持久化队列
                // 注意：这里假设持久化是可靠的，所以直接取出并保存
                let eventsToSave = DebugEventBus.shared.dequeueAll()
                if !eventsToSave.isEmpty {
                    EventPersistenceQueue.shared.enqueue(eventsToSave)
                    DebugLog.debug(.persistence, "Persisted \(eventsToSave.count) events (offline)")
                }
            }
        }
    }

    // MARK: - Recovery (断线恢复)

    /// 开始恢复发送持久化的事件
    private func startRecovery() {
        guard let configuration, configuration.enablePersistence else { return }

        let pendingCount = EventPersistenceQueue.shared.queueCount
        guard pendingCount > 0 else {
            DebugLog.debug(.bridge, "No pending events to recover")
            return
        }

        DebugLog.debug(.bridge, "Starting recovery of \(pendingCount) persisted events")
        isRecovering = true

        // 使用定时器分批恢复，避免一次性发送太多
        DispatchQueue.main.async { [weak self] in
            self?.recoveryTimer = Timer.scheduledTimer(
                withTimeInterval: 0.5, // 每 500ms 发送一批
                repeats: true
            ) { [weak self] _ in
                self?.workQueue.async {
                    self?.recoverBatch()
                }
            }
        }
    }

    /// 恢复一批事件
    private func recoverBatch() {
        guard let configuration, state == .registered, isRecovering else {
            stopRecovery()
            return
        }

        let events = EventPersistenceQueue.shared.dequeueBatch(maxCount: configuration.recoveryBatchSize)

        if events.isEmpty {
            // 恢复完成
            stopRecovery()
            DebugLog.debug(.bridge, "Recovery completed")
            return
        }

        // 发送事件
        send(.events(events))
        DebugLog.debug(
            .bridge,
            "Recovered \(events.count) events, remaining: \(EventPersistenceQueue.shared.queueCount)"
        )
    }

    /// 停止恢复
    private func stopRecovery() {
        isRecovering = false
        DispatchQueue.main.async { [weak self] in
            self?.recoveryTimer?.invalidate()
            self?.recoveryTimer = nil
        }
    }

    // MARK: - Timers

    private func startTimers() {
        guard let configuration else { return }

        // 心跳定时器
        DispatchQueue.main.async { [weak self] in
            self?.heartbeatTimer = Timer.scheduledTimer(
                withTimeInterval: configuration.heartbeatInterval,
                repeats: true
            ) { [weak self] _ in
                self?.sendHeartbeat()
            }

            // 事件刷新定时器
            self?.flushTimer = Timer
                .scheduledTimer(withTimeInterval: configuration.flushInterval, repeats: true) { [weak self] _ in
                    self?.workQueue.async {
                        self?.flushEvents()
                    }
                }
        }
    }

    private func stopTimers() {
        DispatchQueue.main.async { [weak self] in
            self?.heartbeatTimer?.invalidate()
            self?.heartbeatTimer = nil
            self?.flushTimer?.invalidate()
            self?.flushTimer = nil
            self?.reconnectTimer?.invalidate()
            self?.reconnectTimer = nil
            self?.recoveryTimer?.invalidate()
            self?.recoveryTimer = nil
        }
        isRecovering = false
    }

    private func scheduleReconnect() {
        guard let configuration, !isManualDisconnect, !isReconnecting else { return }

        // 检查是否超过最大重试次数
        if configuration.maxReconnectAttempts > 0, reconnectAttempts >= configuration.maxReconnectAttempts {
            DebugLog.error(.bridge, "Max reconnect attempts (\(configuration.maxReconnectAttempts)) reached, giving up")
            return
        }

        isReconnecting = true
        reconnectAttempts += 1

        // 计算当前重连间隔（指数退避）
        if reconnectAttempts > 1 {
            currentReconnectInterval = min(
                currentReconnectInterval * 2,
                configuration.maxReconnectInterval
            )
        } else {
            currentReconnectInterval = configuration.reconnectInterval
        }

        DebugLog.debug(.bridge, "Scheduling reconnect in \(currentReconnectInterval)s (attempt \(reconnectAttempts))")

        internalDisconnect()

        DispatchQueue.main.async { [weak self] in
            self?.reconnectTimer = Timer.scheduledTimer(
                withTimeInterval: self?.currentReconnectInterval ?? 5.0,
                repeats: false
            ) { [weak self] _ in
                self?.isReconnecting = false
                self?.workQueue.async {
                    self?.internalConnect()
                }
            }
        }
    }

    /// 重置重连状态（连接成功后调用）
    private func resetReconnectState() {
        reconnectAttempts = 0
        currentReconnectInterval = configuration?.reconnectInterval ?? 5.0
        isReconnecting = false
    }

    // MARK: - State Management

    private func updateState(_ newState: ConnectionState) {
        state = newState
        DispatchQueue.main.async { [weak self] in
            self?.onStateChanged?(newState)
        }
    }
}

// MARK: - URLSessionWebSocketDelegate

extension DebugBridgeClient: URLSessionWebSocketDelegate {
    public func urlSession(
        _: URLSession,
        webSocketTask _: URLSessionWebSocketTask,
        didOpenWithProtocol _: String?
    ) {
        updateState(.connected)
        sendRegister()
    }

    public func urlSession(
        _: URLSession,
        webSocketTask _: URLSessionWebSocketTask,
        didCloseWith _: URLSessionWebSocketTask.CloseCode,
        reason _: Data?
    ) {
        if !isManualDisconnect {
            scheduleReconnect()
        }
    }
}
