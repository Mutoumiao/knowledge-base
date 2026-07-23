# 完成日志

格式：`[状态] 轨道 issue-id 摘要 — 关键变更点（测试数），[issue链接]`

---

## [2026-07-23]

### companion / server

- [closed] companion-l1-boundary-and-judge — 有害拒绝改为 soft 边界 + generate 有正文（取消 end_safety 空 END / pipeline safetyBlocked / 主路径 ERR_SAFETY_BLOCKED）；generate 边界硬约束与无方法短兜底；L1 记忆关键词移出 autoHardGates；主 companion spec sync。单测 safety-soft-boundary-product 5 项。

- [closed] companion-structured-json-output — DeepSeek-like 结构化输出改 `json_object`（jsonMode）主路径，跳过必失败的 FC/jsonSchema；本地自管 parse（fence / 括号平衡 / 有限别名 / D11 缺省 / Zod）；整轮 repair 预算 ≤1；6 个 structured prompt 补 EXAMPLE JSON；fallback `structuredClone`；thinking 关闭仅在参数被拒时重试；`finish_reason=length` 记 truncated 可 repair。主 spec 已 sync。单测约 34 项。
- [closed] **D12 预发 Pass + OpenSpec archive** — 本地 deepseek-v4-flash + L1 全量 36 chat：无 FC/jsonSchema 风暴、safety success 主导、repair≤1/请求、危机 soft 通过。归档：`openspec/changes/archive/2026-07-23-companion-structured-json-output/`。P1 可选（危机短路 LLM / Zod→EXAMPLE / L1 冒烟门禁 / 附录日志）**明确推迟、非必须**；产品债（intent enum、违法硬拒有正文、L1 启发式）记入 `BACKLOG.md`。证据见 `docs/report/companion-structured-json-output-preflight-result-2026-07-23.md`（本地 gitignore 时可能不入库）。

### docs / trellis

- [docs] Trellis companion-pipeline HOW：结构化输出改为引用 OpenSpec 方法链契约，废弃「固定三方法穷举」表述
- [docs] 恢复根目录 CHANGELOG.md 条目（本条）

---
