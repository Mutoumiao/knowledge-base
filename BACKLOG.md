# BACKLOG

## Closed — Companion L1 过线（2026-07-23）

> 详情与证据见 `docs/report/companion-product-gap-and-optimize-2026-07-23.md` §0–§1、§11。  
> 终裁：`scripts/prod-acceptance/judge-packs/companion-l1-20260723-215213/outputs/final-l1-verdict.json`（`finalL1Verdict=PASS`，盲测 4/4）。

- [x] **D12 结构化 jsonMode** — `archive/2026-07-23-companion-structured-json-output/`
- [x] **边界人设拒绝有正文（C2/O5）** — `archive/2026-07-23-companion-l1-boundary-and-judge/`
- [x] **L1 验收最小可信（O7/C5）** — 记忆关键词移出 auto hard gate；七维/盲测可签
- [x] **L1 签字（C1）** — 官方四角色七维 PASS + 盲测 ≥70% + agent 终裁（产品负责人可 counter-sign）
- [x] **post-L1 硬化** — 空流不假成功、记忆 type 纠偏、多要点、开场/破沉浸、auto 减噪 — `archive/2026-07-23-companion-post-l1-hardening/`

---

## Open — Companion Post-L1 产品债（L1 PASS 后）

> 来源：L1 live 终裁 warnings + D12 节点表 + Care/parity 残余。  
> **整产品报告：** `docs/report/companion-product-gap-and-optimize-2026-07-23.md`  
> **Grill 冻结（2026-07-23）：** 本阶段完工线 = **质量线**；DoD = **O1 + O11**；change 建议名 **`companion-intent-enum-alignment`**。  
> 权威：`docs/grill-sessions/2026-07-23-companion-post-l1-quality-grilling.md` + 报告 **§12.6**。  
> 与 D12 / L1 门禁解耦。

### 本阶段 P0（Grill：质量线）

- [x] **intent enum 对齐 + 降节点 fallback（O1）** — change `companion-intent-enum-alignment`：alias-first + EXAMPLE + roleplay 补枝；**未做** schema 并值（D3.1 stay-alias-only）。对照：`openspec/changes/companion-intent-enum-alignment/COMPARE.md`
- [x] **structured 阶段可聚合观测（O11）** — `spanAttrs.structuredStages`；三态 success/coerced/fallback；无告警通道

### O1 残余（不阻塞收口）

- [x] **live 重采 intent 三态列**（2026-07-24）：全量 L1 36 轮；`success=31 / coerced=0 / fallback=5`，`fallbackRate=0.139`（D12 历史 ≈0.92）。报告：`docs/report/companion-intent-live-2026-07-24.md`；COMPARE §Live：`openspec/changes/archive/2026-07-24-companion-intent-enum-alignment/COMPARE.md`。一键：`scripts/prod-acceptance/run-companion-intent-live.mjs`
- [ ] **第二波并值（D3.1）**：**默认不启动**（live 已 ≤50% 且降幅远超 30%；仍 stay-alias-only，须产品预审才开）
- **下一刀（数据后）**：**O8 记忆抽取**（见下）；不并行再开 intent 大改
### 流程旁路（不阻塞质量线）

- [x] **剧本 A + 合并前仪式（Phase C / 2026-07-24）**：`scripts/prod-acceptance/docs/COMPANION-DEMO-SCRIPT-A.md`（晚晚 8 轮 + 边界 + 记忆；PR：vitest 相关 + L0 + 剧本 A）
- [x] **parity change 归档（C6 / 2026-07-25）**：任务 33/33 全勾；主 spec 已含 Quality 观测型 / 反馈注入 / metadata / companion-care / companion-persona；归档至 `openspec/changes/archive/2026-07-25-companion-parity-ai-partner-agent/`（未再跑 delta sync，主库已对齐）

### 旁路小单 / 次优先（不进本 change DoD）

- [x] **记忆抽取质量（O8）最小波（2026-07-24）**：LLM 部分漏抽 `padWithCandidateFacts` + 软归一近义去重 + 启发式「记住哦/另外」切分；pad 优先 important_fact；**不做** L3 / 加 repair / 改图。测：`memory-heuristic.golden` / `memory-skip.golden`。残余：live 知予 NEW-MEM 体感复验可选手测
- [x] **L1 自动层减噪 v2（O7-续 / O9）（2026-07-24）**：`hasSafetyRefusal` 扩礼貌软拒（换个方式/不需要一步/网暴不是/伤到对方等）；`isDegenerateReply({ allowShort })` + bridge/continuity 评估不误杀合理短陪伴；单测 `tests/unit/prod-acceptance-l1-denoise.spec.ts`
- [ ] **Care 自动投递（C4）**：须单独产品决策；当前 **无** Cron
- [ ] **同会话记忆管线（C3）**：仅人工证伪「真接不住」后
- [x] **长对话上下文连续性（2026-07-27 archive）**：prepare 读回 + generate 注入 + O1 + long-context runner；主 spec 已 sync；归档 `openspec/changes/archive/2026-07-27-companion-long-context-continuity/`；真聊 LCC PASS + L0 冒烟
- [ ] **emotion / relationship 降 fallback（O2）**：O1 之后或投诉时
- [ ] L2 / L3 — **默认不做**，须单独 Grill

### 明确推迟（structured 原 P1，默认不做）

> 原 structured change tasks §5.1 / 5.3 / 5.4 / 5.5。无延迟/成本/工程漂移压力时 **不必做**。

- [ ] （可选）危机关键词 **短路 safety LLM** → 直接 soft_boundary（省 1 次 LLM）
- [ ] （可选）Zod→EXAMPLE 生成工具，减少 prompt 样例漂移
- [ ] （可选）L1 半自动冒烟接入固定 CI/脚本门禁
- [ ] （可选）design 附录 A 补全现网失败日志原文

---

## Open — Observability 波次 4（dual-module-observability-m 不验收）

> 来源：`docs/grill-sessions/2026-07-18-rag-observability-langfuse-grilling.md` §10 波次 4；change `dual-module-observability-m` 仅登记。

- [ ] **告警通道**：慢/错/空结果阈值 → 邮件或 Webhook；与 W2 聚合联动
- [ ] **R2 索引全链路观测**：upload → chunk → embed → index 分阶段 span 与失败归因（超出 turn 级 W2）
- [ ] **attrsSchemaVersion**：`spanAttrs` 版本字段 + 演进兼容策略
- [ ] **Langfuse 父子增强**：Nest 根 span 与 Knowledge AI / 图节点父子关系稳定化（当前保底同 `trace_id` 可检索）
- [ ] **Care 路径观测**：非图路径（主动关怀）独立 span / W2 route 或子类型
