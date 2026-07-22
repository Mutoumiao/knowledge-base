/**
 * 离线 eval 命名隔离：scenePassRate ≠ 在线「准确率」
 * 脚手架结构 + 禁止词 + 用例数量门槛
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '../..')

describe('evals naming isolation + scaffold', () => {
  it('run.mjs produces scenePassRate and never onlineAccuracy', () => {
    execFileSync(process.execPath, [join(root, 'evals/run.mjs')], {
      cwd: root,
      encoding: 'utf8',
    })
    const reportPath = join(root, 'evals/reports/latest.json')
    expect(existsSync(reportPath)).toBe(true)
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      namingNote?: string
      rag: { scenePassRate: number; total: number; passed: number }
      companion: { scenePassRate: number; total: number; passed: number }
    }
    expect(report.namingNote).toMatch(/offline|scenePassRate|准确率/i)
    expect(typeof report.rag.scenePassRate).toBe('number')
    expect(typeof report.companion.scenePassRate).toBe('number')
    expect(report.rag.total).toBeGreaterThanOrEqual(20)
    expect(report.companion.total).toBeGreaterThanOrEqual(8)
    expect(JSON.stringify(report)).not.toMatch(/onlineAccuracy/)
    expect(JSON.stringify(report)).not.toMatch(/"accuracy"/)
  })

  it('runner source uses scenePassRate not accuracy label for online KPI', () => {
    const src = readFileSync(join(root, 'evals/run.mjs'), 'utf8')
    expect(src).toContain('scenePassRate')
    expect(src).toMatch(/not Admin online accuracy|naming isolation|offline/i)
  })
})
