/**
 * UT-STREAM-empty: 空回复不得静默成功 done；须 error + 可观测
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const streamPath = path.resolve(
  __dirname,
  '../../../src/modules/companion/companion-chat-stream.service.ts',
)
const typesPath = path.resolve(
  __dirname,
  '../../../src/modules/companion/companion-chat.types.ts',
)

describe('UT-STREAM-empty: 空完成防护契约', () => {
  const streamSrc = readFileSync(streamPath, 'utf-8')
  const typesSrc = readFileSync(typesPath, 'utf-8')

  it('定义 ERR_EMPTY_REPLY 错误码', () => {
    expect(typesSrc).toMatch(/ERR_EMPTY_REPLY/)
  })

  it('空 reply 路径发出 error 且不伪造成功助手落库', () => {
    expect(streamSrc).toMatch(/ERR_EMPTY_REPLY/)
    expect(streamSrc).toMatch(/empty_reply|emptyReply/)
    // 空分支在 persistAssistantMessage 之前 return
    const emptyBlock = streamSrc.slice(
      streamSrc.indexOf('// 非 safety 场景：禁止静默空成功'),
      streamSrc.indexOf('// 先落库再 done'),
    )
    expect(emptyBlock).toMatch(/ERR_EMPTY_REPLY/)
    expect(emptyBlock).toMatch(/emptyReply:\s*true/)
    expect(emptyBlock).not.toMatch(/persistAssistantMessage/)
  })

  it('Abort/超时写入 timeout 观测标记', () => {
    expect(streamSrc).toMatch(/timeout:\s*isAbort/)
    expect(streamSrc).toMatch(/empty_reply/)
  })
})
