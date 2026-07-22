# BACKLOG

## Open — Observability 波次 4（dual-module-observability-m 不验收）

> 来源：`docs/grill-sessions/2026-07-18-rag-observability-langfuse-grilling.md` §10 波次 4；change `dual-module-observability-m` 仅登记。

- [ ] **告警通道**：慢/错/空结果阈值 → 邮件或 Webhook；与 W2 聚合联动
- [ ] **R2 索引全链路观测**：upload → chunk → embed → index 分阶段 span 与失败归因（超出 turn 级 W2）
- [ ] **attrsSchemaVersion**：`spanAttrs` 版本字段 + 演进兼容策略
- [ ] **Langfuse 父子增强**：Nest 根 span 与 Knowledge AI / 图节点父子关系稳定化（当前保底同 `trace_id` 可检索）
- [ ] **Care 路径观测**：非图路径（主动关怀）独立 span / W2 route 或子类型
