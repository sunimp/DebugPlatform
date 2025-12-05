// deviceIcons.ts
// 设备图标工具函数
//
// Created by Sun on 2025/12/05.
// Copyright © 2025 Sun. All rights reserved.
//

/**
 * 根据平台获取设备图标
 */
export const platformIcons: Record<string, string> = {
  iOS: '📱',
  iPadOS: '📱',
  macOS: '💻',
  watchOS: '⌚',
  tvOS: '📺',
}

/**
 * 获取平台图标
 * @param platform 平台名称
 * @returns 对应的 emoji 图标
 */
export function getPlatformIcon(platform: string): string {
  return platformIcons[platform] || '📱'
}

/**
 * 模拟器标识图标
 */
export const SIMULATOR_ICON = '🔲'
