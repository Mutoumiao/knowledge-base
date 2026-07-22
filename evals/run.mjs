/**
 * Offline eval runner (rule-anchor MVP).
 * Does NOT call production judge by default.
 * Naming isolation: reports "scenePassRate", never "onlineAccuracy".
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadJson(rel) {
  return JSON.parse(readFileSync(join(__dirname, rel), 'utf8'))
}

function scoreRagCase(c) {
  // Dry-run: structural validity only until wired to live RAG
  const ok =
    typeof c.id === 'string' &&
    typeof c.query === 'string' &&
    Array.isArray(c.mustIncludeAny) &&
    c.mustIncludeAny.length > 0
  return { id: c.id, pass: ok, mode: 'structure' }
}

function scoreCompanionCase(c) {
  const ok =
    typeof c.id === 'string' &&
    Array.isArray(c.expectNodes) &&
    c.expectNodes.length > 0 &&
    !c.expectNodes.includes('vector_search_empty_shell')
  return { id: c.id, pass: ok, mode: 'structure' }
}

const rag = loadJson('rag/cases.json')
const companion = loadJson('companion/cases.json')

const ragResults = rag.cases.map(scoreRagCase)
const companionResults = companion.cases.map(scoreCompanionCase)

const report = {
  generatedAt: new Date().toISOString(),
  namingNote: 'scenePassRate is offline only; not Admin online accuracy',
  rag: {
    rubricVersion: rag.rubricVersion,
    total: ragResults.length,
    passed: ragResults.filter((r) => r.pass).length,
    scenePassRate: ragResults.filter((r) => r.pass).length / Math.max(1, ragResults.length),
    results: ragResults,
  },
  companion: {
    rubricVersion: companion.rubricVersion,
    total: companionResults.length,
    passed: companionResults.filter((r) => r.pass).length,
    scenePassRate:
      companionResults.filter((r) => r.pass).length / Math.max(1, companionResults.length),
    results: companionResults,
  },
}

const outDir = join(__dirname, 'reports')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'latest.json')
writeFileSync(outPath, JSON.stringify(report, null, 2))

console.log(
  JSON.stringify(
    {
      ok: report.rag.passed === report.rag.total && report.companion.passed === report.companion.total,
      ragScenePassRate: report.rag.scenePassRate,
      companionScenePassRate: report.companion.scenePassRate,
      report: outPath,
    },
    null,
    2,
  ),
)

if (report.rag.total < 20 || report.companion.total < 8) {
  process.exitCode = 1
  console.error('Insufficient cases: need rag>=20 companion>=8')
}
