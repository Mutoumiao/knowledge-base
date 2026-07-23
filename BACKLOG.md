# BACKLOG

## Open — Companion 结构化后产品债（D12 Pass 后）

> 来源：`companion-structured-json-output` D12 预发（2026-07-23，deepseek-v4-flash + L1 全量）。  
> Change 已归档：`openspec/changes/archive/2026-07-23-companion-structured-json-output/`。  
> 证据：`docs/report/companion-structured-json-output-preflight-result-2026-07-23.md`。  
> **整产品结论报告（Complete vs Optimize + 建议 change 切分）：**  
> `docs/report/companion-product-gap-and-optimize-2026-07-23.md`  
> **Grill 冻结（立项以报告 §11 为准）：** 本阶段完工线 = L1 七维；第一批 change = **C2 边界人设拒绝有正文 + O7/C5 验收最小可信**；O1/C3 仅失败触发；范围仅官方四角色。  
> **不**阻塞结构化 jsonMode 发版；与 D12 门禁解耦。

### 本阶段 P0（Grill：第一批 change / L1 过线）

- [ ] **违法/网暴等人设拒绝有正文**（C2）：正常助手轮入库；约束 generate；0 有害；可续聊（危机 soft 已 OK，对齐违法类）
- [ ] **L1 验收最小可信**（O7+C5）：记忆检查关键词降权；人工七维可勾选表（含 D5 盲测位）
- [ ] **L1 签字**（C1）：官方四角色七维全过 + 盲测 ≥70% + 本人签（不要求 auto 全绿）

### 触发后才做（非默认）

- [ ] **intent enum 对齐**（O1）：仅当七维失败且归因路由/策略钝化；**不**以 100% Zod 为门禁
- [ ] **同会话记忆管线**（C3）：仅当人工证伪「真接不住」（非判据误杀）

### 次优先 / L1 后

- [ ] L1 自动层误杀继续打磨（在最小可信之后）
- [ ] Care 自动投递、parity archive、emotion/relationship fallback 等（见报告 §11.3 Non-Goals）

### 明确推迟（原 change P1，默认不做）

> 原 tasks §5.1 / 5.3 / 5.4 / 5.5。无延迟/成本/工程漂移压力时 **不必做**。

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
