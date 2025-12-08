你现在扮演一名具备 iOS / Swift / WebSocket / 后端 / Web 前端经验的资深架构师与实现工程师。

需要对这两个项目做“增量式插件化改造”：

- 客户端：DebugProbe
- 服务端： DebugHub
- 前端：WebUI

⚠️ 重要前提（必须遵守）：

1. 现有功能已经基本可用：HTTP 抓包、日志、WebSocket、DB Inspector、Replay、域名规则等。
2. 不允许推翻重写，只能“抽象出插件机制 + 渐进迁移现有模块”。
3. 改造目标：
   - 引入统一的“插件接口 / 插件生命周期 / 消息路由”，让任何新功能都以“插件”形式接入：
     - iOS 端：Probe 插件
     - 服务端：Backend 插件
     - Web UI：Frontend 插件（视图 Tab / 面板）
   - Probe / Backend / WebUI 三端都具备统一插件体系；
   - 先把现有功能整理为内置插件（network / log / db 等），再支持后续扩展。
   - 后续新增 DB 变更追踪、UI Inspector、性能监控等，都只需新增插件，不改核心。

----

一、总体目标：三层统一插件架构
================================================

请先完整阅读两个仓库源码，弄清目前的：

- iOS 端：
  - DebugEvent / DebugBridgeClient / 各种模块（network、log等）是如何发送事件的；
- 服务端：
  - 是如何处理来自设备的事件；
  - API / WebSocket 协议现在长什么样；
- Web UI：
  - 是如何组织 Tab、视图和与后端交互的。

1. Probe Plugin（iOS 插件）

- 负责：数据采集、事件上报、命令执行；

- 示例：

- NetworkPlugin

- LogPlugin

- DBPlugin

- RulePlugin（Mock/白黑名单）

2. Backend Plugin（服务端插件）

- 负责：

- 接收某类插件事件；

- 持久化；

- 提供 REST API；

- 向 WebUI 推送实时数据。

3. Frontend Plugin（WebUI 插件）

- 负责：

- 一个完整功能模块的 UI；

- 作为一个 Tab / 子路由存在；

- 通过插件自己的 API 与后端交互。

**要求最终达到：**

- **插件之间零耦合，只共享一套基础设施（连接、路由、存储抽象）；**
- **插件可独立启停；**
- **核心框架不再感知“network / log / db”等具体业务；**
- **如果现有实现与插件化的设计架构冲突，你需要给出此实现应用插件改造的最佳实践方案；**
- **为未来新功能预留统一扩展点（性能监控、UI Inspector、崩溃分析等）。**

----

二、iOS 端插件机制设计（DebugProbe）
================================================

### 2.1 设计一个统一的 “Probe 插件协议”

在 DebugProbe 中，引入类似这样的协议（具体命名可根据当前代码风格微调，但语义保持一致）：

```swift
/// 所有 DebugProbe 插件必须实现的协议
public protocol DebugProbePlugin {
    /// 插件唯一 ID，例如 "network", "log", "db", "perf", "ui"
    var pluginId: String { get }

    /// 插件初始化完成后被调用，适合做内部准备工作
    func start(context: DebugProbeContext)

    /// 当 DebugPlatform 下发与该插件相关的命令时，调用此方法
    func handleCommand(_ command: PluginCommand)

    /// 插件需要定期上报状态/心跳时，可选择性实现
    func teardown()
}
```

其中：

- DebugProbeContext 提供插件可用的“能力”与“环境”：
  - 发送消息的方法；
  - 设备/应用信息；
  - 配置读取等。

例如：

```swift
public protocol DebugProbeContext {
    func sendPluginEvent(_ event: PluginEvent)
    var deviceId: String { get }
    // 其它可重用工具、logger等
}
```

PluginCommand / PluginEvent 是插件级的统一封装：

```swift
public struct PluginCommand: Codable {
    public let pluginId: String
    public let commandType: String
    public let payload: Data?   // 或 [String: Any] 外层再编码
}

public struct PluginEvent: Codable {
    public let pluginId: String
    public let eventType: String
    public let payload: Data?
}
```

### **2.2 插件注册与生命周期管理**

引入一个 DebugProbePluginManager（或整合进已有核心对象中）：

- 负责：
  - 注册所有 Probe 插件；
  - 在 DebugProbe 启动时依次调用 plugin.start(context:)；
  - 收到来自 DebugPlatform 的“插件命令消息”时，找到 pluginId 对应插件，分发给 handleCommand；
  - 为插件提供 sendPluginEvent 的实现（包装成底层的 DebugBridge 消息发送）。

伪代码示例：

```swift
public final class DebugProbePluginManager {
    private var plugins: [String: DebugProbePlugin] = [:]
    private let context: DebugProbeContextImpl

    init(bridge: DebugBridgeClient, deviceInfo: DeviceInfo) {
        self.context = DebugProbeContextImpl(bridge: bridge, deviceInfo: deviceInfo)
    }

    public func register(plugin: DebugProbePlugin) {
        precondition(plugins[plugin.pluginId] == nil, "Duplicate pluginId")
        plugins[plugin.pluginId] = plugin
    }

    public func startAll() {
        plugins.values.forEach { $0.start(context: context) }
    }

    public func handleIncomingPluginCommand(_ command: PluginCommand) {
        guard let plugin = plugins[command.pluginId] else { return }
        plugin.handleCommand(command)
    }

    // 用于上报事件
    private final class DebugProbeContextImpl: DebugProbeContext {
        // ...
        func sendPluginEvent(_ event: PluginEvent) {
            // 将 PluginEvent 编码成 DebugBridge 消息，发送到 DebugPlatform
        }
    }
}
```
要求：

- 对现有的 network/log/db/perf 逻辑进行封装，将其变成实现 DebugProbePlugin 的插件；
- 原有的 DebugEvent / DebugBridge 协议可以做一个向后兼容层：
  - 新插件统一走 PluginEvent；
  - 老的 event 类型可以逐步迁移到插件事件；
  - 在第一阶段可以保留老逻辑，但新功能优先通过插件接口实现。

### **2.3 现有模块如何迁移为插件（举例）**

现有模块（例如 Network 和 Log）示例改造：

- NetworkPlugin：
  - pluginId = “network”
  - start 时，注册 URLProtocol / hook；
  - 每当拦截到一条网络请求/响应，将其封装为 PluginEvent(pluginId: "network", eventType: "http_event", payload: ...) 发出。
  - 支持接收命令，例如：
    - “set_config”：上传新的过滤规则、白名单等。
- LogPlugin：
  - pluginId = “log”
  - start 时，初始化日志捕获（重定向 stdout / 订阅 CocoaLumberjack / os_log）；
  - 每次产生日志，封装为 eventType: "log_event" 上报；
  - 支持命令：例如调整日志级别过滤。

请在回答中给出具体的 Swift 代码示例，展示：

- 如何实现一个简单 NetworkPlugin / LogPlugin；
- 如何从原来的“硬编码发送事件”改为通过 DebugProbeContext.sendPluginEvent(_:)。

----

#  # **三、服务端插件机制设计（DebugPlatform）**

### **3.1 统一的插件事件路由层**

在 DebugPlatform 现有“接收设备消息”的位置，增加一层统一路由：

- iOS 端发送来的消息在 JSON / Protobuf 中应当有：
  - type: "plugin_event"（或类似）；
  - pluginId；
  - eventType；
  - payload。

例如：

```json
{
  "type": "plugin_event",
  "deviceId": "xxxx",
  "pluginId": "network",
  "eventType": "http_event",
  "payload": { ... } // 由具体插件定义
}
```

DebugPlatform 引入 BackendPlugin 协议：

```swift
protocol BackendPlugin {
    var pluginId: String { get }

    /// 初始化时被调用，可以注册路由、初始化存储等
    func boot(context: BackendPluginContext)

    /// 处理来自某个设备的插件事件
    func handleEvent(from deviceId: String, eventType: String, payload: Data)

    ///（可选）提供该插件对外暴露的 REST 路由注册函数
    func registerRoutes(on router: Router)
}
```

BackendPluginContext 提供：

- 访问存储（例如数据库抽象 / Repository）；
- 向 WebUI 广播消息的能力（通过 WebSocket）；
- 日志工具等。

有一个 BackendPluginRegistry：

- 保存所有插件实例；
- 在服务启动时，依次调用 boot(context:)；
- 在收到 plugin_event 消息时，根据 pluginId 分发给对应插件；
- 在配置 HTTP 路由时，调用插件的 registerRoutes(on:)，把插件相关路由挂到主路由树上。

### **3.2 插件化现有模块（示例）**

你需要：

- 在 DebugPlatform 中找到现有的网络、日志、DB 等处理逻辑；
- 为其中两个以上模块实现对应的 BackendPlugin，例如：

1. NetworkBackendPlugin
   - pluginId = “network”
   - 持久化 HTTP 事件（已有逻辑迁入）；
   - 暴露路由：
     - GET /api/devices/{id}/network/requests
     - GET /api/devices/{id}/network/requests/{requestId}
   - 收到 eventType == "http_event" 时进行解析和存储。
2. LogBackendPlugin
   - pluginId = “log”
   - 持久化日志；
   - 路由：
     - GET /api/devices/{id}/logs
   - 收到 eventType == "log_event" 时存储/转发。

请在回答中给出 Swift（或该项目实际使用语言）的代码示例：

- BackendPlugin 接口定义；
- BackendPluginRegistry；
- 一个插件如何注册路由；
- 如何从原来“单一逻辑”迁移到“插件 + 路由载入”。

### **3.3 插件级命令下发**

服务端需要能给某个设备的某个插件下发命令：

- 定义统一的“插件命令消息”：

```json
{
  "type": "plugin_command",
  "deviceId": "xxxx",
  "command": {
    "pluginId": "network",
    "commandType": "set_config",
    "payload": { ... }
  }
}
```

- DebugPlatform 的“设备连接管理”层要提供：
  - sendPluginCommand(deviceId: String, command: PluginCommand)
- WebUI 通过调用某个 REST API（例如 POST /api/devices/{id}/plugins/{pluginId}/commands）来触发命令下发。

----

# **四、Web UI 插件机制设计（Frontend Plugin）**

### **4.1 全局插件注册表**

在前端（应该是 React 或类似框架）引入一个“插件注册表”，用于声明：

- 插件 ID（pluginId）
- 插件显示名称
- 插件对应的路由或 Tab
- 插件的 React 组件（或 Vue/Svelte 等）

示意：

```ts
export interface FrontendPlugin {
  pluginId: string;
  displayName: string;
  routePath: string; // 例如 "/devices/:id/network"
  render: (props: PluginRenderProps) => JSX.Element;
}

const plugins: FrontendPlugin[] = [
  NetworkPluginUI,
  LogPluginUI,
  DBPluginUI,
  // ...
];
```

PluginRenderProps 至少包含：

- 当前 deviceId
- 对应 Backend Plugin 暴露的 REST API 地址
- 统一的 HTTP client 实例

### **4.2 导航与渲染**

在设备详情页上：

- 动态根据已注册插件生成 Tab / 侧边导航；
- 例如：

```tsx
<Tabs>
  {plugins.map(plugin => (
    <Tab key={plugin.pluginId} title={plugin.displayName} path={plugin.routePath} />
  ))}
</Tabs>
```

- 当切换到某个 Tab 时，渲染对应插件的 render 组件。

### **4.3 现有模块迁移为前端插件（示例）**

你需要：

- 把现有的 Network / Log / DB UI 页面改造成 FrontendPlugin 形式；
- 即每个模块不再直接写死在主路由里，而是通过插件注册。

请在回答中给出：

- FrontendPlugin 接口定义（TypeScript）；
- 插件注册与动态路由示例；
- 至少一个具体插件的 UI 组件示例（例如 NetworkPluginUI）。

----

# **五、兼容性与迁移策略**

非常关键：**一次性把所有旧逻辑全砍掉**，全部迁移为新方案。

**迁移所有模块到插件体系**

- 网络、日志、DB 等现有功能全部以插件方式实现；

- 将所有功能都迁移后，完全移除旧路径。

----

# **六、输出要求**

你的回答必须包含以下内容：

1. **整体插件架构图（文字描述即可）**
   - 描述 ProbePlugin / BackendPlugin / FrontendPlugin 三者如何协作；
   - 描述消息流向：iOS → 服务端 → WebUI 之间的插件事件/命令。
2. **iOS 端具体改造方案**
   - DebugProbePlugin 协议完整定义；
   - DebugProbeContext / PluginCommand / PluginEvent 定义；
   - PluginManager 管理/路由逻辑示例；
   - 至少一个现有模块（network 或 log）的“插件化”代码片段。
3. **服务端具体改造方案**
   - BackendPlugin 协议定义；
   - BackendPluginRegistry；
   - 插件如何注册路由；
   - 插件事件路由的关键代码；
   - 插件命令下发接口。
4. **前端具体改造方案**
   - FrontendPlugin 接口定义（TypeScript）；
   - 插件注册表；
   - 动态导航与渲染示例；
   - 至少一个插件页面的基础实现。
5. **兼容性策略 + 风险点说明**
   - 如何保证现有用户不被破坏；
   - 可能的坑（例如插件ID冲突、消息格式升级）以及规避方案。

所有设计与示例代码必须基于当前这两个仓库的实际结构和技术栈，而不是凭空新建工程。