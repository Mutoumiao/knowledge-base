# 完成日志

格式：`[状态] 轨道 issue-id 摘要 — 关键变更点（测试数），[issue链接]`

---

## [2026-07-24]

### companion / server

- [closed] companion-intent-enum-alignment — structured 三态 success/coerced/fallback（factory→spanAttrs.structuredStages）；有限 enum 值 coerce；intent EXAMPLE/合法列表对齐；`roleplay`→`roleplay_flow` 补枝；repair≤1 不变；未做 schema 并值。对照见 change 内 `COMPARE.md`。

---

## [2026-07-23]

### companion / server

- [closed] **L1 Presence 过线** — live 终裁 `companion-l1-20260723-215213`：`finalL1Verdict=PASS`；官方四角色七维全 PASS；盲测 4/4；安全通过。签名 `agent-session-reviewer`（产品负责人可 counter-sign）。产物：`scripts/prod-acceptance/judge-packs/companion-l1-20260723-215213/outputs/final-l1-verdict.json`。

- [closed] companion-l1-boundary-and-judge — 有害拒绝改为 soft 边界 + generate 有正文（取消 end_safety 空 END / pipeline safetyBlocked / 主路径 ERR_SAFETY_BLOCKED）；generate 边界硬约束与无方法短兜底；L1 记忆关键词移出 autoHardGates；主 companion spec sync。单测 safety-soft-boundary-product 5 项。归档：`openspec/changes/archive/2026-07-23-companion-l1-boundary-and-judge/`。

- [closed] companion-post-l1-hardening — 非 safety 空正文禁止假成功；empty_reply/timeout 可观测；记忆 type 落库纠偏；回忆多要点（含跨会话）；开场身份/破沉浸约束；L1 自动层边界词表与身份锚点减噪；Web 错误体感不静默重放。归档：`openspec/changes/archive/2026-07-23-companion-post-l1-hardening/`。

- [closed] companion-structured-json-output — DeepSeek-like 结构化输出改 `json_object`（jsonMode）主路径，跳过必失败的 FC/jsonSchema；本地自管 parse（fence / 括号平衡 / 有限别名 / D11 缺省 / Zod）；整轮 repair 预算 ≤1；6 个 structured prompt 补 EXAMPLE JSON；fallback `structuredClone`；thinking 关闭仅在参数被拒时重试；`finish_reason=length` 记 truncated 可 repair。主 spec 已 sync。单测约 34 项。
- [closed] **D12 预发 Pass + OpenSpec archive** — 本地 deepseek-v4-flash + L1 全量 36 chat：无 FC/jsonSchema 风暴、safety success 主导、repair≤1/请求、危机 soft 通过。归档：`openspec/changes/archive/2026-07-23-companion-structured-json-output/`。P1 可选（危机短路 LLM / Zod→EXAMPLE / L1 冒烟门禁 / 附录日志）**明确推迟、非必须**。

### docs / trellis

- [docs] 产品缺口报告与 BACKLOG 同步 L1 PASS 后水位；关闭 C1/C2/C5/O5/O7 最小；新增 Post-L1 §12 待 Grill 候选（O1/C4/C6/O8/O7-续）
- [docs] Trellis companion-pipeline HOW：结构化输出改为引用 OpenSpec 方法链契约，废弃「固定三方法穷举」表述
- [docs] 恢复根目录 CHANGELOG.md 条目（本条）

---
