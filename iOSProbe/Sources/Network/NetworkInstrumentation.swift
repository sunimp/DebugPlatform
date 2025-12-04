// NetworkInstrumentation.swift
// DebugPlatform
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Foundation

/// 网络捕获模式
public enum NetworkCaptureMode {
    /// 自动模式（推荐）
    /// 通过 Swizzle URLSessionConfiguration 自动拦截所有网络请求
    /// 无需修改任何业务代码，对 Alamofire、自定义 URLSession 都生效
    case automatic

    /// 手动模式
    /// 需要手动将 protocolClasses 注入到 URLSessionConfiguration
    /// 适用于不希望使用 Swizzle 的场景
    case manual
}

/// 网络捕获范围
public struct NetworkCaptureScope: OptionSet {
    public let rawValue: Int

    public init(rawValue: Int) {
        self.rawValue = rawValue
    }

    /// HTTP/HTTPS 请求
    public static let http = NetworkCaptureScope(rawValue: 1 << 0)

    /// WebSocket 连接
    public static let webSocket = NetworkCaptureScope(rawValue: 1 << 1)

    /// 全部（HTTP + WebSocket）
    public static let all: NetworkCaptureScope = [.http, .webSocket]
}

/// 网络层仪表化，负责拦截和记录 HTTP 请求
public final class NetworkInstrumentation {
    // MARK: - Singleton

    public static let shared = NetworkInstrumentation()

    // MARK: - Public Properties

    /// 获取需要注入的 URLProtocol 类型列表（手动模式使用）
    ///
    /// 使用方式：
    /// ```swift
    /// // 在 Alamofire/自定义 URLSession 初始化之前
    /// let protocols = NetworkInstrumentation.protocolClasses
    /// configuration.protocolClasses = protocols + (configuration.protocolClasses ?? [])
    /// ```
    public static var protocolClasses: [AnyClass] {
        [CaptureURLProtocol.self]
    }

    // MARK: - State

    public private(set) var isEnabled: Bool = false
    public private(set) var captureMode: NetworkCaptureMode?
    public private(set) var captureScope: NetworkCaptureScope = []

    // MARK: - Lifecycle

    private init() {}

    /// 获取干净的 .default configuration（不包含 CaptureURLProtocol）
    /// 用于 CaptureURLProtocol 内部创建 URLSession，避免循环
    public static func cleanDefaultConfiguration() -> URLSessionConfiguration {
        URLSessionConfigurationSwizzle.cleanDefaultConfiguration()
    }

    // MARK: - Start / Stop

    /// 启动网络捕获
    ///
    /// - Parameters:
    ///   - mode: 捕获模式，默认为 `.automatic`（推荐）
    ///   - scope: 捕获范围，默认为 `.all`（HTTP + WebSocket）
    ///
    /// ## 自动模式 (推荐)
    /// ```swift
    /// // 捕获所有网络请求（HTTP + WebSocket）
    /// NetworkInstrumentation.shared.start(mode: .automatic, scope: .all)
    ///
    /// // 仅捕获 HTTP 请求
    /// NetworkInstrumentation.shared.start(mode: .automatic, scope: .http)
    ///
    /// // 仅捕获 WebSocket
    /// NetworkInstrumentation.shared.start(mode: .automatic, scope: .webSocket)
    /// ```
    ///
    /// ## 手动模式
    /// ```swift
    /// NetworkInstrumentation.shared.start(mode: .manual)
    /// // 需要手动注入到每个 URLSessionConfiguration
    /// ```
    public func start(mode: NetworkCaptureMode = .automatic, scope: NetworkCaptureScope = .all) {
        guard !isEnabled else { return }

        captureMode = mode
        captureScope = scope

        // HTTP 捕获
        if scope.contains(.http) {
            switch mode {
            case .automatic:
                // 启用 Swizzle，自动拦截所有 URLSessionConfiguration
                URLSessionConfigurationSwizzle.enable()
                // 同时注册全局 URLProtocol（用于 URLSession.shared）
                URLProtocol.registerClass(CaptureURLProtocol.self)

            case .manual:
                // 仅注册全局 URLProtocol
                URLProtocol.registerClass(CaptureURLProtocol.self)
            }
        }

        // WebSocket 捕获（仅自动模式支持）
        if scope.contains(.webSocket), mode == .automatic {
            WebSocketInstrumentation.shared.start()
        }

        isEnabled = true

        let scopeDesc = scope == .all ? "HTTP + WebSocket" : (scope.contains(.http) ? "HTTP" : "WebSocket")
        let modeDesc = mode == .automatic ? "AUTOMATIC" : "MANUAL"
        DebugLog.info(.network, "Started in \(modeDesc) mode - capturing: \(scopeDesc)")
    }

    /// 注入到自定义 URLSessionConfiguration（手动模式使用）
    ///
    /// - Parameter configuration: 要注入的 URLSessionConfiguration
    ///
    /// 使用示例：
    /// ```swift
    /// let config = URLSessionConfiguration.default
    /// NetworkInstrumentation.shared.injectInto(configuration: config)
    /// let session = URLSession(configuration: config)
    /// ```
    public func injectInto(configuration: URLSessionConfiguration) {
        var protocols = configuration.protocolClasses ?? []
        if !protocols.contains(where: { $0 == CaptureURLProtocol.self }) {
            protocols.insert(CaptureURLProtocol.self, at: 0)
            configuration.protocolClasses = protocols
            DebugLog.debug(.network, "Injected into custom URLSessionConfiguration")
        }
    }

    /// 停止网络捕获
    public func stop() {
        guard isEnabled else { return }

        // 停止 HTTP 捕获
        if captureScope.contains(.http) {
            if captureMode == .automatic {
                URLSessionConfigurationSwizzle.disable()
            }
            URLProtocol.unregisterClass(CaptureURLProtocol.self)
        }

        // 停止 WebSocket 捕获
        if captureScope.contains(.webSocket) {
            WebSocketInstrumentation.shared.stop()
        }

        isEnabled = false
        captureMode = nil
        captureScope = []
        DebugLog.info(.network, "Stopped")
    }
}

// MARK: - Capture URL Protocol

/// 自定义 URLProtocol，用于拦截 HTTP/HTTPS 请求
public final class CaptureURLProtocol: URLProtocol {
    // MARK: - Constants

    private static let handledKey = "com.sunimp.debugplatform.handled"

    // MARK: - Properties

    private var dataTask: URLSessionDataTask?
    private var urlSession: URLSession?
    private var receivedData: Data = .init()
    private var response: URLResponse?
    private var startTime: Date = .init()
    private var requestId: String = ""
    private var traceId: String?
    private var isMocked: Bool = false
    private var mockRuleId: String?
    private var taskMetrics: URLSessionTaskMetrics?

    // MARK: - URLProtocol Override

    override public class func canInit(with request: URLRequest) -> Bool {
        // 防止循环拦截
        if URLProtocol.property(forKey: handledKey, in: request) != nil {
            return false
        }

        // 只拦截 HTTP/HTTPS 请求
        guard let scheme = request.url?.scheme?.lowercased() else { return false }
        guard scheme == "http" || scheme == "https" else { return false }

        // 跳过 WebSocket 升级请求（这些由 WebSocketInstrumentation 处理）
        // WebSocket 握手请求包含 Upgrade: websocket 头
        if
            let upgradeHeader = request.value(forHTTPHeaderField: "Upgrade"),
            upgradeHeader.lowercased() == "websocket" {
            return false
        }

        // 检查 URL 是否以 /debug-bridge 结尾（DebugProbe 自身的 WebSocket 连接）
        if let path = request.url?.path, path.hasSuffix("/debug-bridge") {
            return false
        }

        return true
    }

    override public class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override public func startLoading() {
        startTime = Date()
        requestId = UUID().uuidString
        traceId = request.value(forHTTPHeaderField: "X-Trace-Id")

        // 1. 处理 Mock 规则
        let (modifiedRequest, mockResponse, ruleId) = MockRuleEngine.shared.processHTTPRequest(request)
        mockRuleId = ruleId

        if let mockResponse {
            // 直接返回 Mock 响应
            isMocked = true
            handleMockResponse(mockResponse, for: modifiedRequest)
            return
        }

        // 2. 处理故障注入 (Chaos)
        let chaosResult = ChaosEngine.shared.evaluate(request: modifiedRequest)
        switch chaosResult {
        case .none:
            break
        case let .delay(milliseconds):
            // 延迟后继续
            DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(milliseconds)) { [weak self] in
                self?.proceedWithRequest(modifiedRequest)
            }
            return
        case .timeout:
            // 模拟超时
            let error = NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut, userInfo: nil)
            client?.urlProtocol(self, didFailWithError: error)
            recordHTTPEvent(request: modifiedRequest, response: nil, data: nil, error: error, duration: 0)
            return
        case .connectionReset:
            // 模拟连接重置
            let error = NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost, userInfo: nil)
            client?.urlProtocol(self, didFailWithError: error)
            recordHTTPEvent(request: modifiedRequest, response: nil, data: nil, error: error, duration: 0)
            return
        case let .errorResponse(statusCode):
            // 返回指定状态码的响应
            let response = HTTPEvent.Response(
                statusCode: statusCode,
                headers: [:],
                body: "Chaos injected status code: \(statusCode)".data(using: .utf8),
                endTime: Date(),
                duration: 0,
                errorDescription: nil
            )
            handleMockResponse(response, for: modifiedRequest)
            return
        case let .corruptedData(data):
            // 返回损坏的数据
            let response = HTTPEvent.Response(
                statusCode: 200,
                headers: [:],
                body: data,
                endTime: Date(),
                duration: 0,
                errorDescription: nil
            )
            handleMockResponse(response, for: modifiedRequest)
            return
        case .drop:
            // 丢弃请求，不响应
            return
        }

        // 3. 处理断点 (异步)
        if BreakpointEngine.shared.isEnabled {
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                let result = await BreakpointEngine.shared.checkRequestBreakpoint(
                    requestId: self.requestId,
                    request: modifiedRequest
                )
                switch result {
                case let .proceed(finalRequest):
                    self.proceedWithRequest(finalRequest)
                case .abort:
                    let error = NSError(domain: "DebugProbe", code: -1, userInfo: [NSLocalizedDescriptionKey: "Request aborted by breakpoint"])
                    self.client?.urlProtocol(self, didFailWithError: error)
                    self.recordHTTPEvent(request: modifiedRequest, response: nil, data: nil, error: error, duration: 0)
                case let .mockResponse(snapshot):
                    let response = HTTPEvent.Response(
                        statusCode: snapshot.statusCode,
                        headers: snapshot.headers,
                        body: snapshot.body,
                        endTime: Date(),
                        duration: Date().timeIntervalSince(self.startTime),
                        errorDescription: nil
                    )
                    self.handleMockResponse(response, for: modifiedRequest)
                }
            }
            return
        }

        // 正常流程
        proceedWithRequest(modifiedRequest)
    }
    
    /// 实际发送请求
    private func proceedWithRequest(_ request: URLRequest) {
        // 标记请求已处理，防止循环拦截
        guard let mutableRequest = (request as NSURLRequest).mutableCopy() as? NSMutableURLRequest else {
            return
        }
        URLProtocol.setProperty(true, forKey: Self.handledKey, in: mutableRequest)

        // 创建内部 URLSession 发起真实请求
        // 使用干净的 configuration，避免被 swizzle 污染导致循环
        let config = URLSessionConfigurationSwizzle.cleanDefaultConfiguration()
        urlSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        dataTask = urlSession?.dataTask(with: mutableRequest as URLRequest)
        dataTask?.resume()
    }

    override public func stopLoading() {
        dataTask?.cancel()
        dataTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
    }

    // MARK: - Mock Response Handling

    private func handleMockResponse(_ mockResponse: HTTPEvent.Response, for request: URLRequest) {
        let endTime = Date()
        let duration = endTime.timeIntervalSince(startTime)

        // 构造 URLResponse
        let httpResponse = HTTPURLResponse(
            url: request.url!,
            statusCode: mockResponse.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: mockResponse.headers
        )!

        // 记录事件
        recordHTTPEvent(
            request: request,
            response: httpResponse,
            data: mockResponse.body,
            error: nil,
            duration: duration
        )

        // 返回给调用方
        client?.urlProtocol(self, didReceive: httpResponse, cacheStoragePolicy: .notAllowed)

        if let body = mockResponse.body {
            client?.urlProtocol(self, didLoad: body)
        }

        client?.urlProtocolDidFinishLoading(self)
    }

    // MARK: - Event Recording

    private func recordHTTPEvent(
        request: URLRequest,
        response: HTTPURLResponse?,
        data: Data?,
        error: Error?,
        duration: TimeInterval
    ) {
        // 构建请求模型
        var queryItems: [String: String] = [:]
        if
            let urlComponents = URLComponents(url: request.url!, resolvingAgainstBaseURL: false),
            let items = urlComponents.queryItems {
            for item in items {
                queryItems[item.name] = item.value ?? ""
            }
        }

        let httpRequest = HTTPEvent.Request(
            id: requestId,
            method: request.httpMethod ?? "GET",
            url: request.url?.absoluteString ?? "",
            queryItems: queryItems,
            headers: request.allHTTPHeaderFields ?? [:],
            body: truncateBody(request.httpBody),
            startTime: startTime,
            traceId: traceId
        )

        // 构建响应模型
        var httpResponse: HTTPEvent.Response?
        if let response {
            httpResponse = HTTPEvent.Response(
                statusCode: response.statusCode,
                headers: (response.allHeaderFields as? [String: String]) ?? [:],
                body: truncateBody(data),
                endTime: Date(),
                duration: duration,
                errorDescription: error?.localizedDescription
            )
        } else if let error {
            httpResponse = HTTPEvent.Response(
                statusCode: 0,
                body: nil,
                endTime: Date(),
                duration: duration,
                errorDescription: error.localizedDescription
            )
        }

        // 构建性能时间线
        let timing = extractTiming(from: taskMetrics)

        // 创建事件并入队
        let event = HTTPEvent(
            request: httpRequest,
            response: httpResponse,
            timing: timing,
            isMocked: isMocked,
            mockRuleId: mockRuleId
        )

        DebugEventBus.shared.enqueue(.http(event))
    }

    // MARK: - Timing Extraction

    private func extractTiming(from metrics: URLSessionTaskMetrics?) -> HTTPEvent.Timing? {
        guard let metrics, let transaction = metrics.transactionMetrics.last else {
            return nil
        }

        // DNS 解析耗时
        let dnsLookup: TimeInterval? = {
            guard
                let start = transaction.domainLookupStartDate,
                let end = transaction.domainLookupEndDate else {
                return nil
            }
            return end.timeIntervalSince(start)
        }()

        // TCP 连接耗时
        let tcpConnection: TimeInterval? = {
            guard
                let start = transaction.connectStartDate,
                let end = transaction.connectEndDate else {
                return nil
            }
            return end.timeIntervalSince(start)
        }()

        // TLS 握手耗时
        let tlsHandshake: TimeInterval? = {
            guard
                let start = transaction.secureConnectionStartDate,
                let end = transaction.secureConnectionEndDate else {
                return nil
            }
            return end.timeIntervalSince(start)
        }()

        // 首字节时间 (TTFB)
        let timeToFirstByte: TimeInterval? = {
            guard
                let start = transaction.requestStartDate,
                let end = transaction.responseStartDate else {
                return nil
            }
            return end.timeIntervalSince(start)
        }()

        // 内容下载耗时
        let contentDownload: TimeInterval? = {
            guard
                let start = transaction.responseStartDate,
                let end = transaction.responseEndDate else {
                return nil
            }
            return end.timeIntervalSince(start)
        }()

        // 地址信息
        var localAddress: String?
        var remoteAddress: String?
        if #available(iOS 13.0, macOS 10.15, *) {
            localAddress = transaction.localAddress
            remoteAddress = transaction.remoteAddress
        }

        // 传输字节数
        var requestBytesSent: Int64?
        var responseBytesReceived: Int64?
        if #available(iOS 13.0, macOS 10.15, *) {
            requestBytesSent = transaction.countOfRequestBodyBytesSent
            responseBytesReceived = transaction.countOfResponseBodyBytesReceived
        }

        return HTTPEvent.Timing(
            dnsLookup: dnsLookup,
            tcpConnection: tcpConnection,
            tlsHandshake: tlsHandshake,
            timeToFirstByte: timeToFirstByte,
            contentDownload: contentDownload,
            connectionReused: transaction.isReusedConnection,
            protocolName: transaction.networkProtocolName,
            localAddress: localAddress,
            remoteAddress: remoteAddress,
            requestBodyBytesSent: requestBytesSent,
            responseBodyBytesReceived: responseBytesReceived
        )
    }

    /// 截断过大的 body 数据
    private func truncateBody(_ data: Data?, maxSize: Int = 1024 * 100) -> Data? {
        guard let data else { return nil }
        if data.count > maxSize {
            return data.prefix(maxSize)
        }
        return data
    }
}

// MARK: - URLSessionDataDelegate

extension CaptureURLProtocol: URLSessionDataDelegate {
    public func urlSession(
        _: URLSession,
        dataTask _: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        self.response = response
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        completionHandler(.allow)
    }

    public func urlSession(_: URLSession, dataTask _: URLSessionDataTask, didReceive data: Data) {
        receivedData.append(data)
        client?.urlProtocol(self, didLoad: data)
    }

    public func urlSession(_: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        taskMetrics = metrics
    }

    public func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
        let endTime = Date()
        let duration = endTime.timeIntervalSince(startTime)

        recordHTTPEvent(
            request: request,
            response: response as? HTTPURLResponse,
            data: receivedData,
            error: error,
            duration: duration
        )

        if let error {
            client?.urlProtocol(self, didFailWithError: error)
        } else {
            client?.urlProtocolDidFinishLoading(self)
        }
    }
}
