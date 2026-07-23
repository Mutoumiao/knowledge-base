/**
 * UT-GEN-constraints: 回忆多要点 + 身份开场 + 禁 AI 自曝
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const generatePath = path.resolve(
  __dirname,
  '../../../src/modules/companion/langgraph/nodes/generate-node.ts',
)

describe('UT-GEN-constraints: buildHardConstraints 关键规则', () => {
  const src = readFileSync(generatePath, 'utf-8')

  it('含回忆探针多要点（同会话与跨会话）约束', () => {
    expect(src).toMatch(/同会话与跨会话均适用/)
    expect(src).toMatch(/禁止只答生活事实而漏掉回应偏好/)
    expect(src).toMatch(/禁止编造列表外细节/)
  })

  it('含身份开场名称或人设锚点', () => {
    expect(src).toMatch(/身份开场/)
    expect(src).toMatch(/伴侣名称/)
    expect(src).toMatch(/人设气质锚点/)
  })

  it('非安全轮禁止 AI 客服式自曝', () => {
    expect(src).toMatch(/AI 助手/)
    expect(src).toMatch(/智能客服/)
    expect(src).toMatch(/破沉浸/)
  })

  it('保留先接后推与 adviceLimit=0 既有约束', () => {
    expect(src).toMatch(/先接后推/)
    expect(src).toMatch(/adviceLimit=0/)
    expect(src).toMatch(/禁止用建议或清单开场/)
  })
})
