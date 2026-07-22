/**
 * IT-PS-inject：generate 注入链须纳入 companionDefaultPrompt
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '../../../src/modules/companion')

describe('IT-PS-inject defaultPrompt into generate', () => {
  it('pipeline 传入 companionDefaultPrompt，generate 组装使用', () => {
    const pipeline = readFileSync(path.join(root, 'companion-chat-pipeline.service.ts'), 'utf-8')
    const generate = readFileSync(path.join(root, 'langgraph/nodes/generate-node.ts'), 'utf-8')
    const graph = readFileSync(path.join(root, 'langgraph/graph.ts'), 'utf-8')
    const service = readFileSync(path.join(root, 'companion.service.ts'), 'utf-8')

    // Web 创建/更新走 resolvePersonaPrompt；pipeline 注入运行时权威 prompt（非库内陈旧 defaultPrompt）
    expect(service).toMatch(/resolvePersonaPrompt/)
    expect(pipeline).toMatch(/companionDefaultPrompt:\s*resolvedPrompt/)
    expect(pipeline).toMatch(/resolvePromptForChat/)
    expect(graph).toMatch(/companionDefaultPrompt/)
    expect(generate).toMatch(/companionDefaultPrompt/)
  })
})
