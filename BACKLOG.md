# BACKLOG

## Open — Companion 结构化后产品债（D12 Pass 后）

> 来源：`companion-structured-json-output` D12 预发（2026-07-23，deepseek-v4-flash + L1 全量）。  
> Change 已归档：`openspec/changes/archive/2026-07-23-companion-structured-json-output/`。  
> 证据：`docs/report/companion-structured-json-output-preflight-result-2026-07-23.md`。  
> **整产品结论报告（Complete vs Optimize + 建议 change 切分）：**  
> `docs/report/companion-product-gap-and-optimize-2026-07-23.md`（立项 OpenSpec 时优先引用）。  
> **不**阻塞结构化 jsonMode 发版；与 D12 门禁解耦。

### 优先（影响路由 / 用户体感）

- [ ] **intent enum 对齐**：DeepSeek 常输出非法 `requestedAgentAction` / `userNeed` 等 → intent **高 fallback**（D12 样本约 23/36）。收紧 prompt enum + 有限别名，或放宽 Zod 到可映射子集；目标降低 intent fallback，**不**以 100% Zod 为门禁
- [ ] **违法硬拒有正文**：`safety_blocked`（如辱骂文案 / 网暴方法）现 SSE **error + 空正文**；评估改为「人设语气拒绝 + 可继续聊」的 soft 产品路径，避免 L1 BOUND 空流（危机 soft 已 OK，勿与自伤 soft 混改）

### 次优先（验收工具 / 成本）

- [ ] **L1 记忆关键词启发式**：QING-MEM-R 等「关键词数」易误杀（语义已覆盖仍 FAIL）；改语义/裁判或放宽阈值，避免 auto gate 假 FAIL
- [ ] **L1 人工七维**：本轮 L1 自动 `PENDING_HUMAN_REVIEW`；产品最终 PASS 仍依赖裁判包/人工，与结构化 D12 分开签字

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
