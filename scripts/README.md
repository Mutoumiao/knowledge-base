# 仓库脚本（可提交）

团队共享的工程/验收脚本。**本机私货**见 `local/`（已 gitignore）。

## 布局

| 路径 | 用途 | package.json |
|------|------|--------------|
| `kill-ports.cjs` | 释放 dev 端口 | `predev` |
| `cleanup-test-dbs.ts` | 清理集成测试库 | `db:cleanup` |
| `verify-db-cleanup.ts` | 验证清理逻辑 | `db:verify-cleanup` |
| `verify-rag-e2e.mjs` | RAG 端到端冒烟 | 手动 |
| `auth-verification.mjs` | 认证链路手验 | 手动 |
| `prod-acceptance/` | RAG + Companion + 观测 HTTP 验收；含 L1、**剧本 A**、intent live 一键重采与 stages 聚合 | 手动：目录 README；剧本 A → `docs/COMPANION-DEMO-SCRIPT-A.md`；intent live → `docs/COMPANION-INTENT-LIVE-RECOLLECT.md` / `run-companion-intent-live.mjs` |
| `packages/server/scripts/nest_dod_acceptance.mjs` | Nest ↔ Knowledge AI DoD | 手动 |

## 不在此目录

| 内容 | 位置 |
|------|------|
| DB inspect / 硬编码 ID 探查 | `local/scripts/db/` |
| 噪声记忆软删等写库运维 | `local/scripts/ops/` |
| L1 历史报告 / 裁判包全文 | `local/archive/prod-acceptance/` |
| 演示剧本与 prepare | `local/demo/` |

## prod-acceptance 提交约定

- **可提交**：`*.mjs`、`lib/`、`fixtures/`、`docs/`、说明 md、`reports/.gitignore`、`judge-packs/.gitignore`
- **勿提交**：`reports/*` 与 `judge-packs/*` 运行产物（ignore 已挡）
- **历史产物**：`local/archive/prod-acceptance/`
