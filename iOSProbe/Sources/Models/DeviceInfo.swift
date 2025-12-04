// DeviceInfo.swift
// DebugPlatform
//
// Created by Sun on 2025/12/02.
// Copyright © 2025 Sun. All rights reserved.
//

import Foundation

#if canImport(UIKit)
    import UIKit
#endif

/// 设备信息模型，用于向 Debug Hub 注册设备
public struct DeviceInfo: Codable {
    public let deviceId: String
    public let deviceName: String
    public let systemName: String
    public let systemVersion: String
    public let appName: String
    public let appVersion: String
    public let buildNumber: String
    public let platform: String
    public var captureEnabled: Bool
    public var logCaptureEnabled: Bool

    public init(
        deviceId: String,
        deviceName: String,
        systemName: String,
        systemVersion: String,
        appName: String,
        appVersion: String,
        buildNumber: String,
        platform: String = "iOS",
        captureEnabled: Bool = true,
        logCaptureEnabled: Bool = true
    ) {
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appName = appName
        self.appVersion = appVersion
        self.buildNumber = buildNumber
        self.platform = platform
        self.captureEnabled = captureEnabled
        self.logCaptureEnabled = logCaptureEnabled
    }

    #if canImport(UIKit)
        /// 从当前设备自动获取设备信息
        public static func current() -> DeviceInfo {
            let device = UIDevice.current
            let bundle = Bundle.main

            return DeviceInfo(
                deviceId: device.identifierForVendor?.uuidString ?? UUID().uuidString,
                deviceName: device.name,
                systemName: device.systemName,
                systemVersion: device.systemVersion,
                appName: bundle.infoDictionary?["CFBundleDisplayName"] as? String ?? bundle.infoDictionary?["CFBundleName"] as? String ?? "Unknown",
                appVersion: bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
                buildNumber: bundle.infoDictionary?[kCFBundleVersionKey as String] as? String ?? "0",
                platform: "iOS"
            )
        }
    #endif
}
