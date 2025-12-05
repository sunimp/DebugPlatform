/**
 * protobufDescriptor.ts
 * Protobuf Descriptor Set 解析和 BLOB 解码工具
 * 
 * 使用 .desc 文件（protoc --descriptor_set_out 生成）解析数据库中的 BLOB 字段
 */

import protobuf from 'protobufjs'

// 动态导入 descriptor 扩展以添加 Root.fromDescriptor 方法
// 这个导入有副作用，会给 Root 添加 fromDescriptor 静态方法
import 'protobufjs/ext/descriptor'

// 扩展 Root 类型以包含 fromDescriptor 方法
declare module 'protobufjs' {
    namespace Root {
        function fromDescriptor(descriptor: Uint8Array | ArrayBuffer | unknown): protobuf.Root
    }
}

export interface ProtobufDescriptor {
    /** 描述符名称（通常是文件名） */
    name: string
    /** 所有可用的消息类型 */
    messageTypes: string[]
    /** protobufjs Root 对象 */
    root: protobuf.Root
    /** 上传时间 */
    uploadedAt: Date
}

export interface ColumnProtobufConfig {
    /** 数据库 ID */
    dbId: string
    /** 表名 */
    tableName: string
    /** 列名 */
    columnName: string
    /** 消息类型全名（如 "im.proto.Message"） */
    messageType: string
    /** 描述符名称 */
    descriptorName: string
}

/**
 * 从 .desc 文件加载 Protobuf 描述符
 */
export async function loadDescriptorFromFile(file: File): Promise<ProtobufDescriptor> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()

        reader.onload = async () => {
            try {
                const buffer = reader.result as ArrayBuffer
                const bytes = new Uint8Array(buffer)

                // 使用 Root.fromDescriptor 解析 FileDescriptorSet
                // 该方法由 protobufjs/ext/descriptor 扩展提供
                const root = protobuf.Root.fromDescriptor(bytes)

                // 收集所有消息类型
                const messageTypes = collectMessageTypes(root)

                resolve({
                    name: file.name,
                    messageTypes,
                    root,
                    uploadedAt: new Date(),
                })
            } catch (error) {
                reject(new Error(`解析描述符文件失败: ${error instanceof Error ? error.message : String(error)}`))
            }
        }

        reader.onerror = () => {
            reject(new Error('读取文件失败'))
        }

        reader.readAsArrayBuffer(file)
    })
}

/**
 * 从 Base64 编码的 .desc 数据加载描述符
 */
export async function loadDescriptorFromBase64(base64Data: string, name: string): Promise<ProtobufDescriptor> {
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }

    // 使用 Root.fromDescriptor 解析
    const root = protobuf.Root.fromDescriptor(bytes)
    const messageTypes = collectMessageTypes(root)

    return {
        name,
        messageTypes,
        root,
        uploadedAt: new Date(),
    }
}/**
 * 递归收集所有消息类型
 */
function collectMessageTypes(root: protobuf.Root): string[] {
    const types: string[] = []

    function traverse(namespace: protobuf.NamespaceBase, prefix: string) {
        for (const nested of namespace.nestedArray) {
            const fullName = prefix ? `${prefix}.${nested.name}` : nested.name

            if (nested instanceof protobuf.Type) {
                types.push(fullName)
                // 递归检查嵌套类型
                traverse(nested, fullName)
            } else if (nested instanceof protobuf.Namespace) {
                traverse(nested, fullName)
            }
        }
    }

    traverse(root, '')
    return types.sort()
}

/**
 * 解码 BLOB 数据为 Protobuf 消息
 */
export function decodeBlob(
    descriptor: ProtobufDescriptor,
    messageType: string,
    blobData: string | Uint8Array
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
    try {
        // 查找消息类型
        const MessageType = descriptor.root.lookupType(messageType)

        // 转换数据
        let bytes: Uint8Array
        if (typeof blobData === 'string') {
            // Base64 编码
            const binaryString = atob(blobData)
            bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i)
            }
        } else {
            bytes = blobData
        }

        // 解码
        const message = MessageType.decode(bytes)
        const object = MessageType.toObject(message, {
            longs: String,      // 将 long 转为字符串
            enums: String,      // 将枚举转为字符串
            bytes: String,      // 将嵌套 bytes 转为 base64
            defaults: false,    // 不包含默认值
            arrays: true,       // 始终初始化数组
            objects: true,      // 始终初始化对象
        })

        return { success: true, data: object }
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

/**
 * 尝试自动检测并解码 BLOB（使用 wire format）
 */
export function tryAutoDecode(blobData: string | Uint8Array): Record<string, unknown> | null {
    try {
        let bytes: Uint8Array
        if (typeof blobData === 'string') {
            const binaryString = atob(blobData)
            bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i)
            }
        } else {
            bytes = blobData
        }

        // 使用通用 Reader 尝试解析
        const reader = new protobuf.Reader(bytes)
        const result: Record<string, unknown> = {}

        while (reader.pos < reader.len) {
            const tag = reader.uint32()
            const fieldNumber = tag >>> 3
            const wireType = tag & 7

            let value: unknown
            switch (wireType) {
                case 0: // Varint
                    value = reader.int64().toString()
                    break
                case 1: // Fixed64
                    value = reader.fixed64().toString()
                    break
                case 2: // Length-delimited
                    const data = reader.bytes()
                    // 尝试解析为字符串
                    try {
                        const str = new TextDecoder('utf-8', { fatal: true }).decode(data)
                        if (isPrintable(str)) {
                            value = str
                        } else {
                            value = `[${data.length} bytes]`
                        }
                    } catch {
                        value = `[${data.length} bytes]`
                    }
                    break
                case 5: // Fixed32
                    value = reader.fixed32()
                    break
                default:
                    reader.skipType(wireType)
                    continue
            }

            const key = `field_${fieldNumber}`
            if (key in result) {
                // 重复字段
                if (Array.isArray(result[key])) {
                    (result[key] as unknown[]).push(value)
                } else {
                    result[key] = [result[key], value]
                }
            } else {
                result[key] = value
            }
        }

        return Object.keys(result).length > 0 ? result : null
    } catch {
        return null
    }
}

function isPrintable(str: string): boolean {
    return /^[\x20-\x7E\u4E00-\u9FFF\u3000-\u303F\s]+$/.test(str)
}

/**
 * 格式化解码后的消息为可读字符串
 */
export function formatDecodedMessage(data: Record<string, unknown>, indent = 0): string {
    const spaces = '  '.repeat(indent)
    const lines: string[] = []

    for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined) {
            continue
        }

        if (Array.isArray(value)) {
            if (value.length === 0) continue
            lines.push(`${spaces}${key}: [`)
            for (const item of value) {
                if (typeof item === 'object' && item !== null) {
                    lines.push(`${spaces}  {`)
                    lines.push(formatDecodedMessage(item as Record<string, unknown>, indent + 2))
                    lines.push(`${spaces}  }`)
                } else {
                    lines.push(`${spaces}  ${formatValue(item)}`)
                }
            }
            lines.push(`${spaces}]`)
        } else if (typeof value === 'object') {
            lines.push(`${spaces}${key}: {`)
            lines.push(formatDecodedMessage(value as Record<string, unknown>, indent + 1))
            lines.push(`${spaces}}`)
        } else {
            lines.push(`${spaces}${key}: ${formatValue(value)}`)
        }
    }

    return lines.join('\n')
}

function formatValue(value: unknown): string {
    if (typeof value === 'string') {
        // 检查是否是时间戳
        const num = Number(value)
        if (!isNaN(num)) {
            if (num > 1000000000000 && num < 2000000000000) {
                return `${value} (${new Date(num).toISOString()})`
            }
            if (num > 1000000000 && num < 2000000000) {
                return `${value} (${new Date(num * 1000).toISOString()})`
            }
        }
        return `"${value}"`
    }
    return String(value)
}
