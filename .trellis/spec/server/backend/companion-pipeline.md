# Companion Pipeline 开发指南

> **REFERENCE_ONLY**: 此文件记录开发指南（HOW）。业务规范权威源为 [openspec/specs/companion/spec.md](../../../../openspec/specs/companion/spec.md)（WHAT）。Route Rules / Policy Packs / Prompt Chain / Memory Fallback / LLM Call Budget / 节点回退值 / StateGraph 状态字段 / Memory 类型 应以 OpenSpec 为准。

---

## Purpose

帮助开发者在 Companion LangGraph pipeline 中高效工作：理解节点实现模式、调试技巧、回退策略与常见陷阱，避免重复踩坑。本指南不重复业务规则，仅记录开发智慧。

## Primary OpenSpec

- [openspec/specs/companion/spec.md](../../../../openspec/specs/companion/spec.md) — Companion 对话管线系统级规范（节点顺序、条件分支、LLM 预算、CompanionState、反馈/metadata/状态门闸）

## Related OpenSpec

- [openspec/specs/companion-persona/spec.md](../../../../openspec/specs/companion-persona/spec.md) — 人设 / defaultPrompt / 头像 / 开场白
- [openspec/specs/companion-care/spec.md](../../../../openspec/specs/companion-care/spec.md) — Care Plan / 手动 generate（**不**走 11 节点主路径）
- [openspec/specs/chat/spec.md](../../../../openspec/specs/chat/spec.md) — Chat SSE 双轨方案（streamMode 消费者契约）
- [openspec/specs/settings/spec.md](../../../../openspec/specs/settings/spec.md) — LLM Provider 配置（LlmConfigService 热更新源）

## Module Dependencies

- **LangChain 1.x** — ChatOpenAI 适配层；结构化输出由 `StructuredOutputService` 按模型启发式选择方法链（DeepSeek-like 默认仅 `jsonMode` / `json_object` 自管解析 + 全局 repair≤1）。权威契约见 [openspec/specs/companion/spec.md](../../../../openspec/specs/companion/spec.md)（StructuredOutput 方法链与 JSON 契约）；勿再假设固定 FC→jsonSchema→jsonMode 三方法穷举
- **LangGraph** — StateGraph 状态机，`streamMode: 'updates'` 产出逐节点状态补丁
- **Zod** — 结构化输出 Schema 校验
- **@goferbot/data** — CompanionState Schema 与共享类型

## Development Entry

- `packages/server/src/modules/companion/companion-chat-pipeline.service.ts` — **prepareContext / execute / persist** 编排入口
- `packages/server/src/modules/companion/companion-chat-stream.service.ts` — SSE 事件顺序（token → await persist → done）
- `packages/server/src/modules/companion/companion-sse.events.ts` — 服务端事件类型表
- `packages/server/src/modules/companion/langgraph/graph.ts` — StateGraph 定义、节点拓扑、条件边
- `packages/server/src/modules/companion/langgraph/nodes/` — 11 个节点实现
- `packages/server/src/modules/companion/langgraph/prompts.ts` — 6 个 PromptTemplates
- `packages/server/src/modules/companion/langgraph/nodes/_shared.ts` — SharedNodeFactory 统一调用入口
- `packages/server/src/modules/companion/langgraph/interfaces.ts` — CompanionState 与节点 IO 类型
- `packages/server/src/modules/companion/repositories/companion-message.repository.ts` — `findRecent` 最新 N 窗口
- `packages/server/src/modules/companion/companion-care.service.ts` — 关怀（模板生成，不入 Graph）
- `packages/server/src/modules/companion/companion-memory.service.ts` — 记忆 list/PATCH/软删
- 黄金/集成测：`packages/server/tests/modules/companion/`、`tests/integration/companion-*-parity.spec.ts`

## Implementation Notes

### prepareContext 顺序（设计 A）

**顺序不可调乱**：authorize → archived 门闸 → getOrCreate conversation → **并行加载** memories / `findRecent` / feedbacks → **再** `save(user)` → `incrementMessageCount` → 组装 `initialState`（含 **会话摘要读回**）。

| 字段 | 来源 | 禁止 |
|------|------|------|
| `userMessage` | 本轮请求正文 | 同时塞进 `recentMessages`（会重复进 prompt） |
| `recentMessages` | 落库 **前** 的最新窗口 | 用 `asc+take` 取「最旧 N 条」 |
| `messageCount` | 落库 user 后的会话累计 | 用 `recentMessages.length` 冒充（窗口≤18 且不含本轮 user） |
| `feedbacks` | FeedbackRepository 限额加载 | 写死 `[]` |
| `summary` | 库字段 `conversation.summary: String?` **显式映射**为 `{ text, updatedAt }` | 把 string 直接赋给 `state.summary`；图结束后用 `state.summary` 反推「是否读回」 |

半会话语义：safety 中断 / 管线失败后允许仅 user 落库；archived 在落库前抛 `ERR_COMPANION_ARCHIVED`，**不得脏写**。

### 三层模型工作记忆（长上下文）

模型每轮上下文 = **近窗原文**（`RECENT_MESSAGE_LIMIT` 默认 18）+ **会话滚动摘要**（`conversation.summary` 读回）+ **长期记忆**（默认 ≤12）。  
用户可见历史仍是全文落库；**不得**把「可见历史完整」说成「全历史每轮进 LLM」。

generate 节序：`#1 人设` → `#2 长期记忆` → **`#3 会话中线摘要`** → `#4 最近对话` → … → `#11 硬约束`（禁止 `#2.5`）。

### findRecent：最新 N + 正序

```text
orderBy createdAt/id DESC → take(limit) → reverse() → 时间正序
```

禁止 `orderBy: asc, take: limit`（那是会话开头的最旧 N 条）。

### relationship 与 messageCount

- Graph Annotation 含 `messageCount`；`relationship-stage-node` 必须用 `resolveRelationshipMessageCount(state)`（优先 `state.messageCount`）。
- 仅在未注入时降级到 recent 长度；**新代码禁止**再写 `recentMessages.length` 作为主路径。

### Quality 观测型 + 规则软修复（G-QL-01）

`quality → summary` 边恒连；fail **不** `end_guard` 跳过 summary/memory。Safety `refuse`/`crisis_support` 仍硬中断。

QualityGuard **零 LLM**，在打分之外可对 `assistantReply` 做规则软修复（写入 patch 后继续下游）：

1. 破沉浸（「作为一个 AI…」）→ 按 route 的 presence 兜底短句  
2. `adviceLimit===0` 或先接路由 → 剥建议句  
3. 问句超 `questionLimit` → 限问 / 去问号  
4. 句数超 `sentenceBudget.max` → 截断  
5. 先接路由 + adviceLimit=0 → 调整开场，避免建议句打头  

`lastFallback = 'quality-soft-repair'` 仅作观测；**不要**因 soft-repair 再调一次 LLM 改写（除非产品明确要 LLM rewrite 二期）。

### SSE：先 persist 助手 + await 记忆，再 done

`CompanionChatStreamService` 成功路径顺序：

1. `await persistAssistantMessage`（非空 reply）  
2. **`await persistMemories`**（extracted 非空）— **禁止** `queueMicrotask` / 不 await  
3. `yield done` → 可选 `summary` / `memories` 侧车  

`persistAssistantMessage`：content + `buildPipelineMetadataSnapshot`（quality 必含；**不含**完整 system prompt）+ messageCount+1 + `lastAssistantMessage*` 刷新。

竞态：若不 await 记忆，下一轮 `prepareContext` 读库与 L1 轮询会看到「记忆未写入」。

### 节点 / LLM 既有约定

- **SharedNodeFactory.invokeStructured**：所有调 LLM 的节点走 `buildVariables → prompt.invoke → invokeWithFallback → fallback`。禁止裸 `llm.invoke`。
- **LLM 失败不抛错**：返回 fallback，保证管线不中断。
- **纯规则节点**：Route / Policy / QualityGuard 零 LLM。
- **Memory 关键词回退**：正则强制 `shouldExtract`，见 OpenSpec；**回忆探针例外**（见下）。
- **关怀 generate**：模板路径，**禁止**调完整 11 节点 Graph。

### Route 分层匹配（软匹配）

`route-node.ts` 的 `matchRule`：**priority 3（三元组）> 2（intent+emotion）> 1（仅 intent/仅 emotion）**；同 priority 字段越严越优先。

- 历史坑：只做三元组精确 → 多数情感轮落到 `gentle_clarification`，`deep_comfort` 策略包几乎不生效。  
- `intent=memory_update` → route `memory_ack`（短确认）。  
- 新增规则时写清 `priority`，宽松默认放 priority 1，精确情感场景放 3。

### 记忆去噪与注入排序

统一入口：`SharedNodeFactory`（`_shared.ts`）

| 方法 | 用途 |
|------|------|
| `isRecallProbe` | 「你还记得…吗」只读；同句含「记住」写入则不算纯探针 |
| `sanitizeMemoryFact` / `sanitizeMemoryFacts` | 落库前去噪；问句/残片/空话 → null |
| `shouldSkipMemoryCandidateFast` | 探针 / 寒暄 / 重复 / 敏感 → 跳过 LLM 抽取 |
| `heuristicMemoryFacts` | 显式「记住…/记住哦」切分兜底；支持「另外/还有」多要点；探针返回 [] |
| `isMemoryContentCovered` | 落库/补齐去重（子串近似） |
| `filterInjectableMemories` | 注入前再滤历史噪声 |
| `rankMemoriesForPrompt` | **相关度优先**（token/双字滑窗）+ importance；避免无关高 importance 霸榜 |
| `formatMemoriesForPrompt` | filter → rank → 格式化为 prompt 列表 |

候选与抽取节点：**双保险**都走 sanitize；pipeline `prepareContext` 注入也必须 filter。

**O8 漏抽补齐（2026-07-24）**：`memoryExtractionNode` 在 LLM **空抽或部分条数**时用 `padWithCandidateFacts` 合并 candidate/heuristic 未覆盖事实（上限 `MEMORY_EXTRACTION_LIMIT`）；`isMemoryContentCovered` 含软归一（用户/我 近义）；pad **优先 important_fact**。candidate 仅关键词强制 `shouldExtract`（禁止闲聊「A。另外 B」误强制）。禁止加 repair / 改图拓扑。

历史噪声清理（运维，非热路径）：`packages/server/scripts/cleanup-noisy-memories.mjs`（Prisma 从 `packages/server` 解析）。

### Generate 先接后推

`generate-node.buildHardConstraints`：

- openingMove ∈ comfort/mirror/acknowledge → 第一句必须承接  
- route ∈ deep_comfort / calm_deescalation / quiet_presence / relationship_repair → 前两句禁止方法论  
- adviceLimit=0 → 全文禁方案句  
- 回忆探针 + 已有记忆 → 点具体内容或诚实不确定  

Policy 的 sentence/question/advice 预算 MUST 写进 prompt 正文，不要只写在 metadata。

## Testing Checklist

- [ ] 每个节点单独测试（mock LLM 响应，覆盖成功与失败两条路径）
- [ ] Safety `refuse` / `crisis_support` 中断：图 END、**不**落助手、user 可已落库（设计 A）
- [ ] Quality 观测型：fail 时主回复仍落库，图继续 summary/memory
- [ ] Quality 软修复：adviceLimit=0 剥建议句；破沉浸兜底；`assistantReply` 被 patch
- [ ] Route 分层：emotional_support+sad 在非 trusted 关系仍应倾向 deep_comfort 类，而非默认 clarify
- [ ] 记忆去噪：`UT-MEM-denoise`（探针不写、sanitize 丢问句、filter/rank）
- [ ] 记忆漏抽补齐：`UT-MEM-pad` / `UT-MEM-cover`（LLM 部分条数 + 近义不占坑 + 跳槽补齐）
- [ ] 记忆 await：stream 路径 done 前库中已有本轮 extracted（集成/L1 同会话记忆）
- [ ] `messageCount`：relationship 使用累计数，非 `recent.length`（`UT-REL-msg-count` / `IT-REL-message-count`）
- [ ] `findRecent`：最新 N 条正序（`IT-CTX-recent-limit`）
- [ ] 反馈注入非空 + 限额 8（`IT-FB-inject`）
- [ ] metadata 快照含 quality（`UT-MD-shape` / `IT-MD-persist`）
- [ ] archived 门闸无脏写（`IT-ST-archived-403`）；draft 可聊（`IT-ST-draft-ok`）
- [ ] 记忆 list/write/forbidden（`IT-MM-*`）；Care GET 不插库 / PATCH / generate（`IT-CA-*`）
- [ ] Memory extraction 条件跳过；纯规则节点零 LLM；`streamMode: 'updates'` 顺序

## Review Checklist

- [ ] prepareContext 是否仍「先 load 再 save user」且 archived 在落库前
- [ ] relationship 是否仍用 `messageCount` 而非 recent 窗口
- [ ] done 前是否 await 助手落库 **且** await 记忆落库
- [ ] 注入记忆是否 filter + rank（相关度），而非只按 importance 截断
- [ ] 回忆探针是否双节点禁止写入；sanitize 是否覆盖问句/残片
- [ ] Route 是否分层匹配；memory_update → memory_ack
- [ ] generate 硬约束是否含先接路由与 adviceLimit
- [ ] Quality 是否仍零 LLM，软修复是否写回 assistantReply
- [ ] 新节点是否走 SharedNodeFactory；Route/Policy/Quality 是否零 LLM
- [ ] 业务行为变更是否已回写 OpenSpec companion / companion-care / companion-persona
- [ ] 关怀路径是否误接入完整 Graph

## Common Pitfalls

### messageCount vs recent 窗口

**症状**：关系阶段长期停在早期、prompt「会话消息数量」卡在 ≤18。  
**原因**：用 `recentMessages.length` 或把本轮 user 既放 `userMessage` 又放进 recent。  
**正确**：累计数来自 conversation.messageCount；recent 为落库前窗口。

### findRecent 取成最旧 N 条

**症状**：长会话 prompt 永远是开场几句。  
**原因**：`orderBy: { createdAt: 'asc' }, take: 18`。  
**正确**：desc take 再 reverse。

### 先 done 后落库

**症状**：连发第二句时上下文缺上轮助手；刷新前历史空白；或「刚记住」下一轮读不到。  
**正确**：`await persistAssistantMessage` → `await persistMemories` → `yield done`。

### 反馈写死空数组

**症状**：赞踩从不进 generate「# 8. 历史反馈」。  
**正确**：prepareContext 从 FeedbackRepository 加载，遵守 `MESSAGE_FEEDBACK_INJECTION_LIMIT`。

### Quality fail 当硬中断

**症状**：低质回复被丢弃、memory 不跑。  
**正确**：观测型——仍下发/落库 + 继续 summary/memory；可先规则软修复再落库。

### 仅三元组精确路由

**症状**：用户 sad/anxious 仍进 gentle_clarification，先接策略从不生效。  
**原因**：要求 intent+emotion+relationship 全等才命中。  
**正确**：分层 soft match（priority 3→2→1）。

### 回忆探针写入记忆库

**症状**：库中出现「你还记得我加班…」类噪声；generate 被污染。  
**原因**：关键词「记得」误触发抽取，或 sanitize 漏问句。  
**正确**：`isRecallProbe` 在 candidate/extraction 短路；sanitize + filterInjectable；运维脚本软删历史噪声。

### 记忆 fire-and-forget

**症状**：L1/连发下一轮「不记得」刚写入的事实。  
**原因**：`persistMemories` 未 await 就 `done`。  
**正确**：stream 路径 `await persistMemories` 再 yield done。

### 注入只按 importance

**症状**：回忆时答非所问，高重要无关条目霸占 prompt。  
**正确**：`rankMemoriesForPrompt(userMessage)` 相关度优先。

### 安全硬中断写助手气泡凑观测

**症状**：会话历史出现「被拦截」助手行；与设计 A 冲突。  
**正确**：`ERR_SAFETY_BLOCKED` 不 `persistAssistantMessage`；侧信道 `CompanionObsEventRepository.recordSafetyHardStop`；写失败吞错。  
**详见**：[admin-dashboard-observability.md](./admin-dashboard-observability.md)

### 助手定稿漏 latencyMs

**症状**：Admin Hub P95 长期样本不足（窗内仅有旧消息）。  
**正确**：stream 成功路径 `Date.now()-startedAt` 传入 `persistAssistantMessage(..., { latencyMs })` 写入 metadata。

### 静默空 done / 空助手气泡

**症状**：SSE 以空 `fullReply` 的成功 `done` 结束；客户端空气泡或 L1 aborted 空文；观测显示 status=ok。  
**原因**：generate 空输出 / 超时后仍走成功路径落库。  
**正确**：非 safety 硬中断时 `assistantReply` 与 partial 皆空 → `ERR_EMPTY_REPLY` + flags.`empty_reply`；Abort → `ERR_LLM_TIMEOUT` + flags.`timeout`；**禁止**空串 `persistAssistantMessage`。  
**陷阱**：catch 路径 **禁止**先 `done`（非空 fallback）再 `error`——Web Transport 在 `done` 上 `finishReason: stop` 并关闭，后续 `error` 被丢弃；失败只发 `error`。

### 记忆 type 误标 preference

**症状**：管理面/注入把「加班失眠」标成 preference；回忆只吸事实。  
**原因**：LLM type 直写落库，未做内容启发式。  
**正确**：落库前 `resolvedType = inferStrongMemoryTypeFromContent || llm || default`（`memory-extraction-node.resolveMemoryType`）。无强信号时 **保留 LLM type**，禁止 `inferMemoryTypeFromContent` 默认 `important_fact` 压扁分类。  
**禁止**：`persistMemories` 热路径扫 active 记忆全量 type 自愈（会覆盖管理面手改、串行 N 次 update）。

### intent enum 与 route 必联动

**症状**：intent Zod 通过率上升，但 `roleplay` / 新 primary 仍落到粗默认；或删并 primary 后 ROUTE_RULES 残留 `when.intent` 永远不可达。  
**原因**：route 用 **精确字符串**匹配 `intent.primary`；schema / EXAMPLE / alias / ROUTE_RULES 四源漂移。  
**正确**：改 enum 面时同步 `ROUTE_RULES` + 单测；第一波优先 enum 值 alias + EXAMPLE 合法列表；未知值不得静默→`unclear`；三态写 `ctx.structuredStages` 再挂 `spanAttrs`。

### summary 写库后 prepare 必须读回（F2）

**症状**：summary 节点每轮写 `conversation.summary`，但超窗后模型仍像「失忆」；relationship / memory_* 的 `{conversationSummary}` 长期「暂无」。  
**原因**：`prepareContext` 只装 recent/memories/feedbacks，**不**把库摘要映射进 `initialState.summary`；generate 也不消费摘要。  
**正确**：`if (conversation.summary?.trim()) initialState.summary = { text: conversation.summary, updatedAt: conversation.updatedAt }`；generate 注入 `# 3 会话中线摘要`。  
**禁止**：只写库不读回；用扩大近窗假装已解决超窗。

### relationship 读的是上轮固化摘要（勿改拓扑）

**症状**：同轮 relationship 的摘要看起来「旧一拍」。  
**原因**：图序 relationship ≪ summary 节点；本轮 summary 在 generate/quality 之后才写。  
**正确语义**：relationship / 本轮 generate 读的是 **prepare 载入的上轮固化摘要**，不是本轮新摘要。  
**禁止**：为「修」此时序去改 11 节点拓扑或把 summary 挪到 relationship 之前（另 change 评估）。

### summaryLoaded 在 prepare 捕获，obs 阶段消费

**症状**：观测上 `summaryLoaded` 几乎总为 true，掩盖「未读回」回归。  
**原因**：图结束后 `fullState.summary` 常被本轮 summary 节点写满，用其非空反推会假阳性。  
**正确**：prepare 固化 `prepObs.summaryLoaded / recentMessageCount / summaryChars`，`writeCompanionObs` 只消费该对象。  
**禁止**：`summaryLoaded = Boolean(fullState.summary?.text)`。

### 其它既有陷阱

- LLM 超时未设 fallback → 整条 pipeline 崩。
- Prompt 变量名与 `buildVariables` key 不一致 → 静默空串。
- 纯规则节点顺手调 LLM → 破坏 Budget。
- 热更新事件在请求时才订阅 → 配置不生效。

## Reusable Patterns

- **SharedNodeFactory 统一 LLM 调用模式** — 11 个节点共用一个工厂方法，统一错误处理、回退、日志、降级链。新增 LLM 节点直接复用。
- **纯规则引擎节点模式** — 查找表/分层匹配替代 LLM 分类，零成本、确定性、可测试。适用于输入维度有限、规则可枚举的决策点。
- **Route 分层 soft match** — 精确三元组不够用时降级到 intent+emotion / 仅 intent，避免默认 clarify 吞掉情感轮。
- **质量规则软修复** — 观测型评分 + 确定性文本修补（剥句/截断/兜底），不阻塞 summary/memory，不增 LLM 预算。
- **记忆读写分离** — 探针只读、写入经 sanitize 双保险；注入 filter + 相关度 rank。
- **事件驱动配置热更新** — LlmConfigService 通过事件总线广播配置变更，节点订阅事件而非每次请求读取，避免缓存陈旧。
- **关键词回退绕过 LLM** — 正则匹配强制触发特定行为（如记忆提取），作为 LLM 判断的兜底；探针路径必须显式排除。
- **Prompt 变量链式注入** — 上游节点输出作为下游 Prompt 的上下文变量，通过 `buildVariables` 统一构建，避免散落的字符串拼接。
- **done 前双 await** — 助手消息 + 记忆均 await 落库后再发完成事件，消灭客户端/下一轮竞态。
