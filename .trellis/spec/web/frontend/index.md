# Web 前端开发指南索引

> **Purpose**：本索引是 Web 前端开发的导航中枢。Trellis 记录"如何开发"（HOW），OpenSpec 记录"系统是什么"（WHAT）。
> AI Agent 在此找到对应的开发指南；如需业务规则、API 契约、组件树业务约束，请按下方映射跳转 OpenSpec 权威源。

---

## 通用开发指南

> 适用于 Web 前端所有模块的开发约定。

| 指南 | 描述 |
|------|------|
| [目录结构](./directory-structure.md) | Feature-Sliced Architecture 目录布局 |
| [组件指南](./component-guidelines.md) | shadcn/ui 组合模式、Props 约定、无障碍 |
| [Hook 指南](./hook-guidelines.md) | alova useRequest 用法、自定义 Hook 模式 |
| [状态管理](./state-management.md) | Zustand 分层、Chat 双层 Store、Companion 流式 Store |
| [质量指南](./quality-guidelines.md) | Biome 配置、禁止模式、性能优化 lint |
| [类型安全](./type-safety.md) | @goferbot/data 共享类型、Zod 校验、类型守卫 |

---

## 模块开发指南

> 每个业务模块的开发指南（Module Development Guide），含 10 个章节：Purpose / Primary OpenSpec / Related OpenSpec / Module Dependencies / Development Entry / Implementation Notes / Testing Checklist / Review Checklist / Common Pitfalls / Reusable Patterns。
>
> **重要**：业务规则、API 契约、组件树业务约束不在 Trellis 中。请查阅对应 OpenSpec capability spec.md。

| 模块 | Trellis 开发指南 | OpenSpec 权威源 |
|------|-----------------|----------------|
| Chat SSE | [sse-streaming-architecture.md](./sse-streaming-architecture.md) | [openspec/specs/chat/spec.md](../../../openspec/specs/chat/spec.md) |
| Chat 工作台 UI | [chat-workspace-ui.md](./chat-workspace-ui.md) | [openspec/specs/chat/spec.md](../../../openspec/specs/chat/spec.md) · [settings](../../../openspec/specs/settings/spec.md)（providers） |
| Overlay Portal | [overlay-portal-system.md](./overlay-portal-system.md) | （无对应 capability，4 层架构为实现模式，详见指南内 NOTE 标头） |
| Companion UI | [companion-ui-rendering.md](./companion-ui-rendering.md) | [companion](../../../openspec/specs/companion/spec.md) · [persona](../../../openspec/specs/companion-persona/spec.md) · [care](../../../openspec/specs/companion-care/spec.md) |
| KnowledgeBase UI | [knowledge-base-ui.md](./knowledge-base-ui.md) | [knowledge-base](../../../openspec/specs/knowledge-base/spec.md) · [document-lifecycle](../../../openspec/specs/knowledge-base/document-lifecycle.md) · [queue](../../../openspec/specs/queue/spec.md) |

---

## Progressive Knowledge Loading 流程

当你要实现/调试某个 Web 前端功能时：

1. **第一步**：在上方"模块开发指南"找到对应模块 → 阅读其 Trellis Development Guide
2. **第二步**：若需业务规则（如 chatMessagesChunkSchema 契约、Memory 类型、CompanionForm 字段）→ 点击该指南顶部"Primary OpenSpec"链接跳转
3. **第三步**：若涉及跨模块依赖 → 沿"Related OpenSpec"链接跳转

**示例流程**：实现 Companion 流式 UI
↓
读 `companion-ui-rendering.md`（开发指南）
↓
读 `openspec/specs/companion/spec.md`（Memory 类型、CompanionForm 字段）
↓
若涉及 SSE 契约
↓
读 `openspec/specs/chat/spec.md`

---

## OpenSpec 相关 capability 索引

Web 前端涉及的 OpenSpec 业务规范（按需查阅，不要预加载）：

- [auth](../../../openspec/specs/auth/spec.md) — 认证、Token 刷新、mustChangePassword 流
- [chat](../../../openspec/specs/chat/spec.md) — SSE 契约、chatMessagesChunkSchema、双轨 SSE 业务分轨
- [companion](../../../openspec/specs/companion/spec.md) — AI SDK 聊天、反馈、记忆管理、SSE/Transport
- [companion-persona](../../../openspec/specs/companion-persona/spec.md) — 人设表单、头像、开场白
- [companion-care](../../../openspec/specs/companion-care/spec.md) — 关怀配置与消息标记
- [knowledge-base](../../../openspec/specs/knowledge-base/spec.md) — 知识库业务规则
- [session](../../../openspec/specs/session/spec.md) — Session/Message 业务契约
- [settings](../../../openspec/specs/settings/spec.md) — 用户设置业务规则

---

**语言**：所有文档使用**简体中文**编写。
