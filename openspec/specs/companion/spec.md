# Companion - AI 伴侣对话

## Purpose（目的）

定义 GoferBot AI 伴侣（Companion）的对话管线系统级规范。覆盖 LangGraph 状态图结构、节点执行顺序、条件路由、LLM 调用约束、安全中断机制、LangChain 适配层（StructuredOutput 启发式方法链 + jsonMode 自管解析 + LlmConfigService 热更新）。

> Companion 与 **Knowledge AI / Chat 知识库问答** 隔离：独立路由、独立 SSE 契约；MUST NOT 调用 Knowledge AI 文档索引/知识检索/知识问答作为伴侣主路径。

## Requirements（需求）

### Requirement: Companion 与 Knowledge AI 隔离

AI Companion MUST 保持为独立产品能力：独立路由、独立 API、独立生成链路。Companion MUST NOT 调用 Knowledge AI 的文档索引/知识库检索/知识问答 API 作为记忆或对话实现；Companion 记忆 MUST NOT 写入 `knowledge.chunks` 或知识库 `kb_id` 文档索引。

#### Scenario: 伴侣对话不经 Knowledge AI

- **WHEN** 用户发送 Companion 消息
- **THEN** 系统 MUST 走 Companion 既有（Nest）管线生成回复，MUST NOT 将请求转发至 Knowledge AI `/stream` 作为伴侣主路径

### Requirement: LangGraph StateGraph Execution Order

系统应按照以下固定顺序执行 Companion 对话管线，作为一个包含 11 个节点的 LangGraph StateGraph：safety → intent → emotion → relationship → route → policy → generate → quality → summary → memory_candidate → memory_extraction。

证据来源：
- `packages/server/src/modules/companion/langgraph/graph.ts#L130-L221`

#### Scenario: Complete pipeline execution

- **WHEN** 用户向 AI 伴侣发送消息
- **THEN** 系统按顺序执行所有 11 个节点，每个节点接收所有前置节点的输出作为上下文

#### Scenario: Per-node stream emission

- **WHEN** StateGraph 执行每个节点时
- **THEN** 系统通过 `streamMode: 'updates'` 产生逐节点状态补丁，允许外部消费者观察中间结果

### Requirement: Conditional Branching

系统应在 StateGraph 管线中支持条件分支；Safety 硬中断与 Memory 跳过保持；Quality 结果 MUST 采用观测型语义，不得因 quality fail 丢弃主回复或跳过 summary/memory。

证据来源：
- `packages/server/src/modules/companion/langgraph/graph.ts`
- 行为权威：ai-partner-agent inbox QualityGuard（评测后仍保存助手消息）

#### Scenario: Safety block termination

- **WHEN** safety 节点输出的 `boundaryAction` 等于 `'refuse'` 或 `'crisis_support'`
- **THEN** 图应立即终止（END），返回包含 `safetyReason` 的安全中断响应，且 MUST NOT 持久化正常情感向助手回复

#### Scenario: Quality check failure is observational

- **WHEN** quality guard 节点将回复标为 `status: 'fail'`（或等价未通过）
- **THEN** 系统 MUST 仍保留 `assistantReply` 供下发与落库（经软修复后的文本若存在则用修复版）
- **AND** 系统 MUST 将 quality 结果纳入消息 metadata
- **AND** 系统 MUST NOT 仅因 quality fail 而跳过 summary 与 memory_candidate/memory_extraction 路径
- **AND** safety `refuse` / `crisis_support` 仍为硬中断（与 quality 观测语义独立）

#### Scenario: Quality 规则软修复（G-QL-01）

- **WHEN** quality 节点检测到建议超预算、问句过多、句数超标、破沉浸或「先接后推」开场违规时
- **THEN** 系统 MAY 用规则（剥建议句、限问句、截句数、破沉浸兜底句、调整开场）改写 `assistantReply`
- **AND** 改写后 MUST 仍走观测型路径（继续 summary/memory），MUST NOT 因软修复失败而丢弃整轮回复
- **AND** 软修复 MUST 保持零 LLM（QualityGuard 仍为纯规则节点）

#### Scenario: Memory extraction skip

- **WHEN** memory candidate 节点判定没有有意义的记忆应被提取（`shouldExtract === false`）
- **THEN** 图应跳过 memory_extraction 节点并终止（END）

### Requirement: LLM Call Budget

系统每轮对话最多调用 7 次 LLM。Route、Policy 和 QualityGuard 节点必须作为纯规则引擎实现，零 LLM 成本。

证据来源：
- `packages/server/src/modules/companion/langgraph/nodes/route-node.ts#L192-L198`
- `packages/server/src/modules/companion/langgraph/nodes/policy-node.ts#L209-L233`
- `packages/server/src/modules/companion/langgraph/nodes/quality-guard-node.ts#L38-L62`

#### Scenario: LLM nodes

- **WHEN** 管线执行时
- **THEN** 只有 safety、intent、emotion、relationship、summary、memory_candidate 和 memory_extraction 节点应调用 LLM
- **AND** memory_extraction 是条件性的（仅在 shouldExtract 为 true 时调用）

#### Scenario: Rule engine nodes

- **WHEN** route 节点解析对话策略时
- **THEN** 它应通过纯规则将（intent、emotion、relationship）与硬编码 ROUTE_RULES 做**分层匹配**（见「Route Rules 分层匹配」），无需调用 LLM

#### Scenario: Policy lookup

- **WHEN** policy 节点确定回复参数时
- **THEN** 它应根据路由名称查找 10 个硬编码的 POLICY_PACKS（deep_comfort / calm_deescalation / relationship_repair / playful_flirt / light_companion / quiet_presence / practical_support / gentle_clarification / memory_ack / roleplay_flow）

### Requirement: CompanionState Schema

系统应在整个管线生命周期中维护一个 CompanionState 对象，包含核心字段：userId、companionId、conversationId、userMessage、messageCount、safety、intent、emotion、relationship、route、policy、quality、memoryCandidate、extractedMemories、summary、assistantReply、partialTokens、existingMemories、recentMessages、feedbacks、lastFallback。

证据来源：
- `packages/server/src/modules/companion/langgraph/interfaces.ts`
- `packages/server/src/modules/companion/langgraph/graph.ts`

#### Scenario: State field lifecycle

- **WHEN** 管线中的每个节点执行时
- **THEN** 它应将输出写入 CompanionState 中对应的字段，通过 LangGraph 的状态传播机制使其对所有下游节点可用

#### Scenario: messageCount 累计语义

- **WHEN** prepareContext 完成本轮用户消息落库后
- **THEN** `state.messageCount` MUST 为会话累计消息数（含本轮 user），MUST NOT 用 `recentMessages.length` 冒充累计数
- **AND** relationship 节点 Prompt 注入 MUST 使用该累计数

#### Scenario: NodeExecutionContext injection

- **WHEN** 图被调用时
- **THEN** 伴侣配置文件（name、personality、tone、boundaries、guardrails、defaultPrompt）应通过 LangGraph 的 `configurable` / NodeExecutionContext 通道注入，而非作为状态字段

### Requirement: Safety Interrupt in Pipeline Service

外部管线编排器应监控 LangGraph 流，并在安全边界被触发时中止执行。

证据来源：
- `packages/server/src/modules/companion/companion-chat-pipeline.service.ts#L84-L108`

#### Scenario: Safety-driven stream termination

- **WHEN** 管线服务在流式状态补丁中检测到 `boundaryAction === 'refuse'` 或 `'crisis_support'`
- **THEN** 它应跳出流循环，产生 `{ patch, safetyBlocked: true, safetyReason }`，且不持久化助手消息
- **AND** 系统 MUST 尝试写入侧信道观测事件（`type=safety_hard_stop`），供 Admin 聚合硬中断率
- **AND** 观测写入失败 MUST NOT 阻断向客户端返回安全错误事件

#### Scenario: Normal completion

- **WHEN** 流在没有安全中断的情况下完成
- **THEN** 管线服务应验证 7 个关键状态字段（safety、intent、emotion、route、policy、quality、assistantReply），持久化记忆，并保存助手消息

### Requirement: LangChain 适配层

Companion 的 LLM 调用 SHALL 通过 LangChain ChatOpenAI 适配层完成。结构化节点 MUST 经 `StructuredOutputService` 产出可通过 Zod 校验的对象；generate 路径 MUST 与结构化路径在参数策略上分离（温度、thinking、response_format）。summary 节点 MAY 继续使用纯文本 `invoke`，MUST NOT 被强制套用 json_object。

证据来源：
- `packages/server/src/modules/companion/langchain/langchain-llm.service.ts`
- `packages/server/src/modules/companion/langchain/structured-output.service.ts`
- `packages/server/src/modules/companion/langgraph/nodes/_shared.ts`

#### Scenario: LLM 适配层分工

- **WHEN** 系统需要调用 LLM 时
- **THEN** Companion 使用 LangChain ChatOpenAI；Chat 与 RAG 路径保持既有分工（本 requirement 不扩展 Chat/RAG）

#### Scenario: 统一结构化调用入口

- **WHEN** LangGraph 节点需要调用 LLM 进行结构化输出时
- **THEN** 节点通过 `SharedNodeFactory.invokeStructured<T>(schema, config, fallback, state, ctx)` 统一调用
- **AND** 成功时返回通过 Zod 校验的 `T`
- **AND** 结构化调用最终失败时 MUST 返回 **fallback 的独立副本**（不得与模块级 fallback 单例共享可变引用），以保证管线不中断且后续轮次不被污染

#### Scenario: generate 与 structured 参数分离

- **WHEN** 系统创建用于结构化节点的 Chat 模型时
- **THEN** 配置 MUST 面向确定性 JSON：包括启用 `response_format: { type: 'json_object' }`（或等价）、为该调用设置足以容纳完整 JSON 的 `max_tokens`，以及在供应商支持时关闭 Thinking
- **AND** generate 节点 MUST NOT 被强制套用 json_object（人设口语生成）
- **AND** summary 节点 MUST NOT 被强制套用 json_object（会话摘要为纯文本）

### Requirement: StructuredOutput 方法链与 JSON 契约

系统 SHALL 按 **供应商/模型启发式（及可选 env 覆盖）** 选择结构化输出方法链，而非对所有模型固定三方法穷举。对 DeepSeek 类或不兼容 FC/jsonSchema 的模型，结构化主路径 MUST 为 `json_object` / `jsonMode`，且 MUST **自管** raw content 的归一与 Zod 校验（不得仅依赖会在内部吞掉 raw 的解析路径导致无法做别名/清洗）。每种成功路径 MUST 经 Zod 校验。

证据来源：
- `packages/server/src/modules/companion/langchain/structured-output.service.ts`
- `packages/server/src/modules/companion/langchain/resolve-structured-methods.ts`
- `packages/server/src/modules/companion/langchain/structured-json-parse.ts`

#### Scenario: DeepSeek-like 仅 jsonMode

- **WHEN** 当前 Companion 模型识别为 DeepSeek-like（如模型名含 deepseek）或 env 指定仅 jsonMode
- **THEN** 系统 MUST NOT 每轮尝试 `functionCalling` / `jsonSchema`
- **AND** 系统 MUST 仅使用 `jsonMode`（json_object）作为结构化方法

#### Scenario: 全能力供应商仍可多方法

- **WHEN** 供应商明确支持 json_schema 和/或 function calling 且无 Thinking 冲突时
- **THEN** 系统 MAY 按启发式或 env 尝试 `jsonSchema` 与/或 `functionCalling`，并在失败后回退到 `jsonMode` 自管解析
- **AND** 方法顺序 MUST 可被启发式推导或 env 覆盖（`COMPANION_STRUCTURED_METHODS`），不得写死为「所有模型同一顺序」而无判断

#### Scenario: jsonMode 自管解析

- **WHEN** 使用 json_object / jsonMode 主路径时
- **THEN** 系统 MUST 取得模型返回的文本 content，并在 Zod 前执行归一：去除常见 markdown fence、提取首个括号平衡的 JSON 对象、应用有限字段别名
- **AND** MUST NOT 静默接受括号不闭合的半截 JSON 作为成功结果
- **AND** 系统 MUST 使用 schema 的 parse/safeParse 确保类型与 enum 合法

#### Scenario: Prompt 必须含 json 与 EXAMPLE

- **WHEN** 使用 `invokeStructured` 的节点构建 system 或 user prompt 时
- **THEN** 文本 MUST 包含 `json` 字样（大小写不敏感亦可，但 MUST 明确要求 JSON 输出）
- **AND** MUST 包含与目标 Zod schema **字段名一致**的 EXAMPLE JSON OUTPUT
- **AND** MUST 指示模型只输出 JSON 对象

#### Scenario: 全局 repair 预算

- **WHEN** 初次解析或 Zod 校验失败时
- **THEN** 系统 MAY 使用同一 json_object 约束发起 repair（附带错误摘要与 EXAMPLE）
- **AND** 每一轮 Companion 管线执行中，所有结构化节点合计 repair LLM 调用 MUST NOT 超过 1 次
- **AND** 预算耗尽或 repair 仍失败后 MUST 走节点 fallback，MUST NOT 无限重试

#### Scenario: 结构化最终失败不炸穿 HTTP 管线

- **WHEN** StructuredOutputService 对某节点最终失败时
- **THEN** SharedNodeFactory MUST 捕获失败并采用 fallback 副本继续图执行
- **AND** 系统 MUST 记录可观测的 fallback 信号（日志至少 warn 级）
- **AND** MUST NOT 因单节点结构化失败而默认中断整个 Companion HTTP/SSE 请求（安全硬中断语义仍仅由 safety.boundaryAction 决定）

#### Scenario: 已知能力不匹配的日志级别

- **WHEN** 某方法因供应商明确不支持而 400（如 Thinking 不支持 tool_choice、json_schema unavailable）时
- **THEN** 系统 SHOULD 避免对每次尝试打印 ERROR 级「全链路故障」噪音
- **AND** 仅在 json_object 主路径与（若有）repair 均失败时 MUST 以 warn/error 明确节点 fallback

#### Scenario: safety 禁止乐观缺省

- **WHEN** safety 节点模型输出缺少 `safetyLevel`、`category`、`boundaryAction` 或 `allowMemoryExtraction` 等关键字段时
- **THEN** 系统 MUST NOT 用乐观默认值（例如 safe + continue）补全这些字段以伪造成功
- **AND** 系统 MUST 在 repair 预算允许时尝试 repair，否则走 fallback

#### Scenario: memory_candidate 薄输出可补全

- **WHEN** 模型仅返回 `{ "shouldExtract": false }` 且缺少其余 required 字段时
- **THEN** 系统 MAY 在 Zod 前用节点级默认值补全
- **AND** 补全后 MUST 仍通过 schema 校验，或明确走 fallback

### Requirement: LlmConfigService 配置热更新

系统 SHALL 通过事件驱动机制支持 Companion LLM 配置的热更新，MUST 在配置变更时自动重建 ChatOpenAI 实例。

证据来源：
- `packages/server/src/modules/companion/config/llm-config.service.ts`

#### Scenario: 配置初始化链

- **WHEN** LlmConfigService 创建 LangChain ChatOpenAI 实例时
- **THEN** 系统执行配置链：`SystemConfigService.getDecryptedSystemConfig()` → `settings.companion.provider`（`{providerId}#{modelName}` 格式）→ `ModelProviderService.resolveProvider("companion.provider", "llm")` → `ResolvedProvider{apiKey, model, baseURL, isCompleteUrl, timeoutMs}` → `resolveLlmBaseURL()` → `new ChatOpenAI(...)`

#### Scenario: 配置热更新

- **WHEN** 系统配置发生变更（`config.changed` 事件）且变更分类为 `companion` 或 `providers` 时
- **THEN** 系统自动重建 LangChain ChatOpenAI 实例，无需重启服务

#### Scenario: 未配置 Provider

- **WHEN** Companion LLM Provider 未配置时
- **THEN** 系统抛 `MODEL_PROVIDER_ERROR_CODES.NOT_CONFIGURED` 错误

### Requirement: 核心常量约束

系统 SHALL 使用以下常量约束 Companion 对话的上下文窗口和记忆容量：

证据来源：
- `packages/server/src/modules/companion/langchain/constants.ts`

#### Scenario: 上下文窗口限制

- **WHEN** 构建 LLM 调用上下文时
- **THEN** 系统限制最近消息注入数量为 RECENT_MESSAGE_LIMIT=18，记忆注入条数为 MEMORY_INJECTION_LIMIT=12，反馈注入条数为 MESSAGE_FEEDBACK_INJECTION_LIMIT=8

#### Scenario: 摘要长度限制

- **WHEN** 生成对话摘要时
- **THEN** CONVERSATION_SUMMARY_MAX_LENGTH 限制为 1600 字符

### Requirement: Route Rules 分层匹配规则结构

RouteNode SHALL 作为纯规则引擎，通过 intent / emotion / relationship 与硬编码 ROUTE_RULES 的**分层匹配**确定对话路线与行为标志，MUST 零 LLM 成本。

证据来源：
- `packages/server/src/modules/companion/langgraph/nodes/route-node.ts`（ROUTE_RULES、`matchRule`）
- `.trellis/spec/server/backend/companion-pipeline.md`

#### Scenario: 三维度匹配输入

- **WHEN** route 节点解析对话策略时
- **THEN** 系统 SHALL 接收三个维度作为匹配输入：`intent`、`emotion`、`relationship`（阶段）

#### Scenario: 分层优先级（禁止仅三元组精确）

- **WHEN** 规则表中同时存在精确三元组与更宽松规则时
- **THEN** 系统 MUST 按 priority 分层：`3` = intent+emotion+relationship 全约束；`2` = intent+emotion；`1` = 仅 intent 或仅 emotion 等默认
- **AND** 同 priority 时 MUST 优先字段约束更严的规则（intent 权重大于 emotion 大于 relationship）
- **AND** MUST NOT 仅做三元组精确匹配后一律落到 `gentle_clarification` 默认（历史 bug：情感轮无法命中 deep_comfort 等先接策略）

#### Scenario: memory_update 路由到 memory_ack

- **WHEN** intent 为 `memory_update`（用户要求记住某事）
- **THEN** 系统 MUST 将 route 解析为 `memory_ack`（短确认、少建议）

#### Scenario: 六字段规则输出

- **WHEN** 分层匹配命中一条 ROUTE_RULES 时
- **THEN** 系统 SHALL 输出结构化 route 结果（含 `route`、`responseLength`、`shouldAskQuestion`、`shouldGiveAdvice`、`shouldUsePetName`、`shouldMirrorEmotion`、`routeGuidance` 等约定字段）

#### Scenario: 确定性规则匹配

- **WHEN** 相同的 (intent, emotion, relationship) 输入
- **THEN** 系统 MUST 返回相同的路由结果（确定性查找，不依赖 LLM）

### Requirement: Policy Packs 策略包字段结构

PolicyNode SHALL 作为纯查找表，MUST 将路由名称映射到包含九个字段的详细回复策略，MUST 零 LLM 成本。

证据来源：
- `d:\projects\ai-stared-project\knowledge-base\.trellis\spec\server\backend\companion-pipeline.md`（Policy Packs 章节）
- `packages/server/src/modules/companion/langgraph/nodes/policy-node.ts#L30-L199`

#### Scenario: 九字段策略包定义

- **WHEN** policy 节点根据 route 名称查找 10 个 POLICY_PACKS 之一时
- **THEN** 系统 MUST 返回包含九个字段的策略包：`sentenceBudget`（响应最大句子数）、`rhythm`（响应节奏，如 pause_and_reflect/quick_back_and_forth）、`openingMove`（响应开始方式）、`allowedMoves`（允许的对话策略）、`forbiddenMoves`（禁止的策略）、`questionLimit`（每个响应最大问题数）、`adviceLimit`（最大建议数量）、`intimacyLevel`（low/medium/high）、`styleGuidance`（语气和风格指导）

#### Scenario: 十个策略包覆盖

- **WHEN** 系统初始化策略包时
- **THEN** 系统 SHALL 提供十个策略包覆盖所有对话场景：deep_comfort（深度情感慰藉）、calm_deescalation（焦虑缓解）、relationship_repair（冲突修复）、playful_flirt（轻松俏皮）、light_companion（日常陪伴）、quiet_presence（静默陪伴）、practical_support（实用建议）、gentle_clarification（温和澄清）、memory_ack（记忆确认）、roleplay_flow（角色扮演）

### Requirement: Prompt Injection Chain

LangChain PromptTemplates SHALL 以链式方式连接，每个节点的输出 MUST 作为上下文变量注入到后续节点的 Prompt 中，确保下游节点感知上游判断结果。

证据来源：
- `d:\projects\ai-stared-project\knowledge-base\.trellis\spec\server\backend\companion-pipeline.md`（Prompt Injection Chain 章节）
- `packages/server/src/modules/companion/langgraph/nodes/safety-node.ts`、`intent-node.ts`、`emotion-node.ts`、`relationship-stage-node.ts`

#### Scenario: 链式上下文注入

- **WHEN** 管线执行 safety、intent、emotion、relationship 节点时
- **THEN** 系统 SHALL 按链式顺序注入上下文：safety 节点独立执行输出 safetyResult；intent 节点注入 { safety: safetyResult } 输出 intentResult；emotion 节点注入 { safety, intent } 输出 emotionResult；relationship 节点注入 { safety, intent, emotion, messageCount, summary } 输出 relationshipResult

#### Scenario: PromptTemplates 数量

- **WHEN** 系统初始化 prompts.ts 时
- **THEN** 系统 MUST 定义六个 PromptTemplates：safety、intent、emotion、relationshipStage、memoryCandidate、memoryExtraction

### Requirement: Memory Keyword Fallback 与回忆探针

系统 SHALL 通过正则关键词触发强制记忆提取（显式「记住…」不被 LLM 漏掉）；同时 MUST 将「回忆探针」与写入命令区分，探针路径禁止写入新记忆。

证据来源：
- `packages/server/src/modules/companion/langgraph/nodes/_shared.ts`（`isRecallProbe` / `heuristicMemoryFacts` / `shouldSkipMemoryCandidateFast`）
- `packages/server/src/modules/companion/langgraph/nodes/memory-candidate-node.ts`
- `packages/server/src/modules/companion/langgraph/nodes/memory-extraction-node.ts`

#### Scenario: 关键词正则匹配

- **WHEN** memory_candidate 节点接收用户输入时
- **THEN** 系统 MUST 使用记忆关键词/信号正则匹配用户输入（如记住、以后、别再、我喜欢 等）

#### Scenario: 强制记忆提取

- **WHEN** 用户输入匹配写入类关键词且**不是**纯回忆探针时
- **THEN** 系统 SHALL 强制将 `shouldExtract` 设为 `true`（或启发式产出候选事实），确保 memory_extraction 可执行并落库

#### Scenario: 回忆探针只读不写

- **WHEN** 用户输入为「你还记得… / 记得吗…」类回忆探针（同句无显式「记住」写入指令）
- **THEN** memory_candidate 与 memory_extraction MUST 判定 `shouldExtract: false` / 空抽取
- **AND** MUST NOT 将探针问句本身写入长期记忆

#### Scenario: 无关键词时正常 LLM 判断

- **WHEN** 用户输入不匹配强制关键词且未命中快速跳过时
- **THEN** 系统 SHOULD 由 LLM 判断是否需要提取记忆（shouldExtract 由 LLM 决定）

### Requirement: SharedNodeFactory 节点回退值表

所有调用 LLM 的节点 SHALL 通过 SharedNodeFactory.invokeStructured 统一入口，MUST 在 LLM 失败时返回预定义回退值而非抛出异常，确保 pipeline 不中断。

证据来源：
- `d:\projects\ai-stared-project\knowledge-base\.trellis\spec\server\backend\companion-pipeline.md`（Shared LLM Node Factory 章节）
- `packages/server/src/modules/companion/langgraph/nodes/_shared.ts#L26-L49`

#### Scenario: 七节点回退值定义

- **WHEN** LLM 调用失败时
- **THEN** 系统 MUST 按节点返回预定义回退值：safety 返回默认安全结果；intent 返回 `casual_chat`；emotion 返回 `neutral`；relationship 保留当前阶段；summary 保留前一个摘要；memoryCandidate 返回 `shouldExtract: false`；memoryExtraction 返回空记忆列表

#### Scenario: 管线容错保证

- **WHEN** 任一 LLM 节点发生异常时
- **THEN** 系统 SHALL 通过回退值继续执行下游节点，MUST 不因 LLM 异常停止 pipeline

### Requirement: Memory 类型分类

Companion 记忆系统 SHALL 支持五种记忆类型分类，MUST 在记忆管理页面为每种类型提供中文标签。落库 type MUST 与内容语义一致，并在写入前做内容启发式纠偏（见「记忆 type 落库语义纠偏」）。

证据来源：
- `.trellis/spec/web/frontend/companion-ui-rendering.md`（Memory 类型 章节）
- `packages/web/src/features/companion/types.ts`
- `packages/server/src/modules/companion/langgraph/nodes/_shared.ts`

#### Scenario: 五种记忆类型

- **WHEN** 系统定义 MemoryType 时
- **THEN** 系统 MUST 支持五种类型：`preference`（偏好）、`boundary`（边界）、`relationship_goal`（关系目标）、`conversation_style`（对话风格）、`important_fact`（重要事实）

#### Scenario: 中文标签映射

- **WHEN** 前端渲染记忆管理页面时
- **THEN** 系统 SHALL 通过 MEMORY_TYPE_LABELS 映射提供中文标签：preference→偏好、boundary→边界、relationship_goal→关系目标、conversation_style→对话风格、important_fact→重要事实

#### Scenario: 落库 type 与内容一致

- **WHEN** 记忆被持久化时
- **THEN** 系统 MUST 应用内容启发式纠偏后再写入 type
- **AND** 管理 API 列表返回的 type MUST 反映纠偏后的值

### Requirement: 伴侣创建/编辑表单字段与入口

Companion **数据模型** MUST 继续支持完整人设字段集合（含 `headline`、`tone`、`boundaries` 等，见 companion-persona），但 **Web 用户创建/编辑主路径** MUST 使用**轻量简表**（非全字段创作者表单）。Admin 内置创建/编辑 MUST 使用完整人设表单。Web 自定义 MUST 以独立路由页（或等价全页）承载简表；SHALL 对文本字段执行空白清理。人设拼接与安全权威见 **`companion-persona`**。

证据来源：
- `packages/web/src/features/companion/components/CompanionFormPage.tsx`
- `packages/server/src/modules/companion/companion.service.ts`
- Admin 内置表单

#### Scenario: 核心属性字段（模型）

- **WHEN** 定义伴侣数据模型时
- **THEN** 系统 MUST 包含以下字段：`name`、`headline`、`description`、`personality`、`tone`、`boundaries`、`guardrailsPrompt`、`defaultPrompt`、`backgroundStory`、`openingMessage`、`avatarKey`、`visibility`、`status`、`source`、可空 `userId`

#### Scenario: Web 简表提交

- **WHEN** Web 用户提交自定义伴侣创建/更新时
- **THEN** 请求体 MUST 仅允许简表字段：`name`、`description`、`personality`、可选 `openingMessage`、可选 `avatarKey`（及实现约定的等价键）
- **AND** 系统 MUST 剥离忽略客户端提交的 `boundaries` / `guardrailsPrompt` / `defaultPrompt`（见 companion-persona）
- **AND** 创建成功后 `status` MUST 为 `published`（无需用户再点发布）

#### Scenario: 字段提交处理

- **WHEN** 用户提交伴侣信息时
- **THEN** 系统 SHALL 对文本字段执行空白清理，空字符串视为未设置

#### Scenario: 双模式操作

- **WHEN** 创建或编辑自定义伴侣时
- **THEN** 系统 MUST 支持创建模式与编辑模式，MUST 在操作成功后给出明确反馈
- **AND** Web 列表「新建/编辑」MUST 进入简表页面级流程（如 `/companions/new`、`/companions/:id/edit`）

### Requirement: Companion 前端功能范围

Companion 前端模块 SHALL 覆盖：**官方与自定义双轨列表**、轻量自定义生命周期、AI SDK 流式对话、记忆管理与主动关怀配置；MUST 与 Knowledge Chat 客户端栈隔离。

证据来源：
- `packages/web/src/features/companion/`

#### Scenario: 列表与管理

- **WHEN** 用户进入 Companion 模块时
- **THEN** 系统 SHALL 提供双 Tab 列表（官方推荐 / 我的伴侣）
- **AND** MUST 在「我的」提供创建入口
- **AND** 自定义侧 MUST 能区分 published 与归档后的不可见行为；官方侧 MUST 仅展示 published

#### Scenario: 创建与编辑

- **WHEN** 用户创建或编辑**自定义**伴侣时
- **THEN** 系统 SHALL 提供轻量简表（见 companion-persona），MUST 支持可选头像上传
- **AND** MUST NOT 要求填写 boundaries / guardrails / defaultPrompt 预览
- **AND** MUST NOT 对 system 伴侣提供 Web 人设编辑入口

#### Scenario: AI SDK 流式对话

- **WHEN** 用户与伴侣对话时
- **THEN** 系统 MUST 使用 Vercel AI SDK（如 `useChat`）作为 Companion 聊天客户端
- **AND** MUST 通过自定义 Transport（`CompanionChatTransport`）消费 Nest Companion 既有 SSE 事件
- **AND** MUST NOT 要求将 Knowledge Chat 改为 AI SDK

#### Scenario: 记忆管理

- **WHEN** 用户打开记忆管理时
- **THEN** 系统 SHALL 按类型展示记忆，MUST 支持编辑内容/重要性与软删除（见既有记忆要求）

#### Scenario: 主动关怀配置

- **WHEN** 用户配置主动关怀时
- **THEN** 系统 SHALL 在伴侣上下文提供 Care Plan 配置与手动生成入口（见 companion-care）

### Requirement: Companion SSE 流式语义

Companion 对话 SHALL 以流式方式呈现助手回复；**服务端**保持 Companion SSE 事件契约；**客户端**通过 AI SDK Transport 映射事件，MUST 支持打字机体感并在完成后固化消息。成功完成态 MUST 满足「非空正文或明确错误/安全中断」之一（见「流式完成不得静默空回复」）。

证据来源：
- `packages/server/src/modules/companion/companion-chat-stream.service.ts`
- `packages/server/src/modules/companion/companion-sse.events.ts`
- `packages/web/src/features/companion/companion-chat-transport.ts`

#### Scenario: 业务分轨理由

- **WHEN** 为对话模块选择传输方案时
- **THEN** Companion MUST 保持与 Knowledge Chat 独立的服务端流契约与产品定位（情感陪伴/打字机体感）
- **AND** Companion Web 客户端 MUST 使用 AI SDK，Knowledge Chat MUST NOT 被本能力强制迁移

#### Scenario: 服务端流式事件类型

- **WHEN** 服务端推送 Companion 流时
- **THEN** 系统 MUST 至少支持 `token`（增量文本）、`done`（结束，含完整回复）、`error`（错误码与消息）事件
- **AND** SHOULD 支持 `summary`、`memories`、`heartbeat` 等侧车事件供客户端副作用处理

#### Scenario: Transport 映射

- **WHEN** AI SDK Transport 接收 SSE 事件时
- **THEN** 系统 MUST 将 `token` 映射为助手消息文本增量，将 `done` 映射为消息完成，将 `error` 映射为可展示错误
- **AND** MUST NOT 在请求体中注入用户私有 LLM API Key

#### Scenario: 流式状态与错误恢复

- **WHEN** 流式过程中发生网络错误或服务端错误时
- **THEN** 系统 SHALL 向用户显示错误提示，MUST 保留已接收的部分内容（若协议允许），SHOULD 提供重试入口

#### Scenario: 助手落库先于 done

- **WHEN** 本轮产生非空助手回复并准备结束流时
- **THEN** 服务端 MUST 先持久化助手消息（含 metadata 快照），再推送 `done` 事件
- **AND** 以便客户端收到完成时历史已可读，并避免连发时 `findRecent` 缺上轮助手

#### Scenario: 记忆落库 await 于 done 之前

- **WHEN** 本轮 `extractedMemories` 非空并准备结束流时
- **THEN** 服务端 MUST `await persistMemories(...)` 完成后再推送 `done`（及可选的 `memories` 侧车事件）
- **AND** MUST NOT 使用 `queueMicrotask` / fire-and-forget 异步写记忆（会导致下一轮 prepareContext 与 API 轮询竞态丢记忆）

#### Scenario: 禁止静默空 done

- **WHEN** 本轮无非空助手正文且非 safety 硬中断时
- **THEN** 服务端 MUST 按「流式完成不得静默空回复」发出失败信号，MUST NOT 仅以空 content 的 `done` 结束

### Requirement: 行为权威与参考实现对齐

在 Companion 情感产品范围内，系统行为 MUST 与 ai-partner-agent 参考实现的产品语义对齐；实现结构 MUST 保留 GoferBot（11 节点 Graph、Prisma 字段名、服务端 LLM 配置、现 SSE）。冲突时按「行为 > 结构」裁决，并回写 OpenSpec。

#### Scenario: 差距矩阵驱动实现

- **WHEN** 实现或回归 Companion 行为对齐工作时
- **THEN** 工程 MUST 维护可执行差距矩阵（参考能力 → GoferBot 状态 → 测试 ID）
- **AND** 关闭差距项 MUST 有对应自动化测试或明确 E2E 场景

#### Scenario: 不对齐项显式记录

- **WHEN** 某项故意不对齐参考实现（如浏览器注入 API Key、群聊、Cron 关怀）时
- **THEN** 该项 MUST 记录在 Non-Goals 或差距矩阵的「明确不做」列，MUST NOT 静默漂移

### Requirement: 用户消息先落库（设计 A）

发送消息管线在进入 LangGraph 前 MUST 先持久化本轮用户消息并递增会话 `messageCount`；成功路径再落库助手消息；安全硬中断/管线失败时允许仅保留 user 的半会话。门闸失败（archived / not found）MUST NOT 落库用户消息。

证据来源：
- `packages/server/src/modules/companion/companion-chat-pipeline.service.ts`（prepareContext）
- `packages/server/src/modules/companion/companion-chat-stream.service.ts`

#### Scenario: 先加载历史再写 user

- **WHEN** prepareContext 构建本轮 initialState 时
- **THEN** 系统 MUST 先加载 `recentMessages`（不含本轮 user），再落库本轮 user
- **AND** 本轮正文仅出现在 `state.userMessage`，MUST NOT 同时出现在 `recentMessages` 中造成重复

#### Scenario: 成功路径双落库

- **WHEN** 管线成功产生非空助手回复时
- **THEN** 系统 MUST 已持久化 user，并再持久化 assistant（含 metadata）
- **AND** 会话 `messageCount` 最终 MUST 反映 user + assistant 各 +1

#### Scenario: 安全中断半会话

- **WHEN** safety 硬中断且 prepareContext 已成功时
- **THEN** 系统 MUST 保留已落库的 user 消息，MUST NOT 持久化正常情感向助手回复
- **AND** 客户端收到明确 safety/error 事件

#### Scenario: archived 门闸无脏写

- **WHEN** 伴侣状态为 `archived` 时
- **THEN** 系统 MUST 在用户消息落库前拒绝请求，会话 MUST NOT 新增脏消息

### Requirement: 历史反馈加载与 Prompt 注入

管线准备上下文时 MUST 加载当前会话/伴侣相关的历史消息反馈并写入 `CompanionState.feedbacks`；generate 阶段 MUST 将反馈注入 system prompt；前端 MUST 支持赞踩并可选填写 reason/note。

证据来源：
- `packages/server/src/modules/companion/companion-chat-pipeline.service.ts`
- `packages/server/src/modules/companion/langgraph/nodes/generate-node.ts`
- `packages/server/src/modules/companion/repositories/companion-feedback.repository.ts`

#### Scenario: 反馈不得空置

- **WHEN** 用户对历史助手消息存在已持久化反馈且管线开始新一轮生成时
- **THEN** `state.feedbacks` MUST 包含在注入限额内的反馈条目，MUST NOT 无条件使用空数组

#### Scenario: 注入限额

- **WHEN** 可注入反馈数量超过 `MESSAGE_FEEDBACK_INJECTION_LIMIT`（默认 8）时
- **THEN** 系统 MUST 仅注入限额内条目（按更新时间或约定排序）

#### Scenario: 前端提交反馈

- **WHEN** 用户对助手消息点赞或点踩时
- **THEN** 系统 MUST 持久化 rating，SHOULD 允许 reason/note
- **AND** 历史消息加载 MUST 能反映已有反馈状态

#### Scenario: 反馈 rating 规范枚举

- **WHEN** 客户端提交或服务端持久化消息反馈时
- **THEN** 持久化层 MUST 使用稳定枚举 `positive` | `negative`（与 Prisma `FeedbackRating` 一致）
- **AND** HTTP API 请求/响应 MUST 使用同一枚举字符串，MUST NOT 混用未文档化的 `up`/`down` 或裸 `1`/`-1` 作为契约主类型
- **AND** 若 UI 内部暂用 `up`/`down`，MUST 仅在客户端映射层转换，不得泄漏为 OpenAPI/DTO 主字段类型

### Requirement: 助手消息 Pipeline Metadata

持久化助手消息时 MUST 写入结构化 metadata 快照（至少含 quality，并应含 safety/intent/emotion/relationship/route 等已产出字段的摘要）；完整 system prompt 默认 MUST NOT 写入 metadata。quality 失败语义 MUST 保持观测型：MUST NOT 仅因 quality fail 丢弃主回复。成功定稿时 MUST 写入本轮端到端耗时 `latencyMs`（非负整数），供 Admin 计算时间窗内 P95 延迟。

证据来源：
- `packages/server/prisma/schema.prisma`（CompanionMessage.metadata）
- `packages/server/src/modules/companion/companion-chat-pipeline.service.ts`（buildPipelineMetadataSnapshot / persistAssistantMessage）
- `packages/server/src/modules/companion/repositories/companion-obs-event.repository.ts`
- `packages/server/prisma/migrations/20260716120000_companion_obs_event/`

#### Scenario: 落库快照

- **WHEN** 一轮对话成功产生助手回复并落库时
- **THEN** 消息记录 MUST 含 content 与 metadata JSON 快照，metadata MUST 可被测试解析断言

#### Scenario: quality 可解析

- **WHEN** 一轮 Companion 对话成功落库助手消息
- **THEN** metadata MUST 可被解析出 `quality.status`（或等价）
- **AND** Admin 聚合可将 `quality.status === 'fail'` 计入 fail 率

#### Scenario: latencyMs 落库

- **WHEN** 助手消息以 completed（或等价成功态）持久化
- **THEN** metadata MUST 包含 `latencyMs`（非负整数）
- **AND** 计时起点 MUST 为服务端处理本轮用户消息的开始，终点为定稿前
- **AND** 历史无 `latencyMs` 的消息 MUST 不计入 P95 样本；无样本时 Hub P95 MUST 为 `insufficient_samples` 而非虚构延迟

#### Scenario: 情绪字段可供详页

- **WHEN** emotion 节点产出结果并落库
- **THEN** metadata MUST 可解析主情绪与强度（或既有摘要字段）
- **AND** Admin Companion 详页 MAY 聚合情绪分布；Hub MUST NOT 依赖情绪作为必选黄金 KPI

#### Scenario: 用户 UI 不展示原始分析

- **WHEN** 用户在聊天界面查看消息时
- **THEN** 系统 MUST NOT 默认展示完整 pipeline 分析 JSON 作为气泡正文

### Requirement: 安全硬中断侧信道观测（设计 A 保持）

当 `boundaryAction` 为 `refuse` 或 `crisis_support` 导致安全硬中断时，系统 MUST 保持既有产品行为：MUST NOT 仅为观测而向会话写入助手消息气泡。系统 MUST 通过侧信道表 `companion_obs_events`（模型 `CompanionObsEvent`）写入硬中断事件，供 Admin 聚合硬中断率。

#### Scenario: 硬中断不污染会话历史

- **WHEN** 安全节点判定 refuse 或 crisis_support
- **THEN** 系统 MUST NOT 将硬中断伪造成功的助手聊天气泡写入会话历史（与设计 A 一致）
- **AND** 系统 MUST 尝试写入侧信道观测事件（`type=safety_hard_stop`、`boundaryAction`、时间戳及 companion/conversation/user 关联 id）
- **AND** 观测写入失败 MUST NOT 阻断向客户端返回安全错误事件

#### Scenario: 硬中断率聚合口径

- **WHEN** Admin 请求 safety 硬中断率且事件存储已就绪
- **THEN** 率 MUST 定义为：时间窗内硬中断事件数 / 时间窗内 Companion **用户消息**数
- **AND** 用户消息分母为 0 时 KPI status MUST 为 `insufficient_samples`
- **AND** 事件存储查询失败时 Hub KPI MUST 为 `pending_instrumentation`，MUST NOT 从助手 metadata 臆造硬中断率

### Requirement: 负反馈率分母固定

系统 MUST 保持 `CompanionMessageFeedback` 的 rating 可按时间窗统计。Admin Hub 负反馈率 MUST 定义为：时间窗内 `rating=negative` 条数 / 时间窗内 feedback 总条数。

#### Scenario: 负反馈率

- **WHEN** Admin 请求 Companion 负反馈率且时间窗内 feedback 条数 > 0
- **THEN** 系统 MUST 返回 negative / feedbackCount
- **AND** 时间窗内无 feedback 时 KPI status MUST 为 `insufficient_samples`

### Requirement: 伴侣状态对聊天的约束

系统 MUST 在进入聊天准备阶段按 **source × status × 调用方** 校验（**完整取代**旧「draft 与 published 一律允许所有者聊天」规则）：

| source | status | Web 开聊 |
|--------|--------|----------|
| system | published | 任意已认证用户 MUST 允许 |
| system | draft / archived | MUST 拒绝 |
| user | published | 仅所有者 MUST 允许 |
| user | draft | 仅所有者 MUST 允许（兼容存量草稿调试） |
| user / system | archived | MUST 拒绝 |

Web 新建自定义 MUST 直接 `published`，无需草稿发布步骤。Admin 对 system 的 draft 预览聊天非本期 Web 要求。

#### Scenario: 归档不可聊

- **WHEN** 伴侣 `status=archived` 时
- **THEN** 聊天准备 MUST 失败且 MUST NOT 落库用户消息

#### Scenario: 内置草稿 Web 不可聊

- **WHEN** Web 用户对 `source=system` 且 `status=draft` 的伴侣发起聊天时
- **THEN** 系统 MUST 拒绝

#### Scenario: 自定义草稿所有者可聊

- **WHEN** 所有者对 `source=user` 且 `status=draft` 的存量自定义伴侣发起聊天时
- **THEN** 系统 MUST 允许（与新建「创建即 published」不冲突）

#### Scenario: 自定义创建即可聊

- **WHEN** 用户刚完成自定义创建时
- **THEN** 该伴侣 MUST 为 `published` 且所有者 MUST 可立即开聊

### Requirement: 服务端 LLM 配置权威

Companion 管线 LLM 调用 MUST 仅通过服务端配置解析（LlmConfigService / companion.provider 链路）；MUST NOT 要求或信任浏览器提交的 API Key 作为主配置源。

#### Scenario: 无浏览器 Key

- **WHEN** 客户端发起 Companion 流式聊天请求时
- **THEN** 服务端 MUST 使用已配置的服务端凭据与模型解析结果调用 LLM
- **AND** MUST NOT 将客户端传入的 apiKey 作为默认生产路径

### Requirement: 近期消息窗口语义

`findRecent` MUST 取会话**最近** `RECENT_MESSAGE_LIMIT`（默认 18）条消息，并按时间正序返回供 prompt 注入；MUST NOT 使用 `orderBy asc + take`（那是最旧 N 条）。

#### Scenario: 最新窗口正序

- **WHEN** 构建 `state.recentMessages` 时
- **THEN** 系统 MUST 按 createdAt/id 降序 take 后 reverse 为正序
- **AND** 窗口长度 MUST NOT 超过 `RECENT_MESSAGE_LIMIT`

### Requirement: 记忆运行时与管理

记忆抽取 MUST 保持三级过滤语义（规则快速跳过 → 候选判断 → 抽取）；候选事实与抽取结果 MUST 经 `sanitizeMemoryFact` 去噪后方可进入 `extractedMemories` / 落库；落库 type MUST 经内容语义纠偏；注入 MUST 先 `filterInjectableMemories` 再按与本轮用户消息的**相关度优先**排序（相关度权重大于单纯 importance），回忆探针且用户提到偏好/回应时偏好类 MUST 优先于纯生活事实；并遵守 `MEMORY_INJECTION_LIMIT`（默认 12）；类型 MUST 为五种 MemoryType。管理面 MUST 支持按伴侣列出、更新内容/importance/status、删除（软删）。

证据来源：
- `packages/server/src/modules/companion/langgraph/nodes/_shared.ts`
- `packages/server/src/modules/companion/companion-chat-pipeline.service.ts`（注入过滤）
- `packages/server/src/modules/companion/companion-chat-stream.service.ts`（await persistMemories）

#### Scenario: 事实去噪

- **WHEN** 候选或抽取产出事实字符串时
- **THEN** 系统 MUST 丢弃：过短/过长、问句形态、回忆探针残片、敏感凭证、无稳定偏好实体的指令空话
- **AND** 清洗后为空的事实 MUST NOT 落库

#### Scenario: 注入限额与相关度排序

- **WHEN** 活跃记忆超过 `MEMORY_INJECTION_LIMIT` 或需要注入 system prompt 时
- **THEN** 注入条数 MUST NOT 超过该限额
- **AND** 排序 MUST 优先与本轮 `userMessage` 关键词/双字滑窗重叠高的条目，其次 importance
- **AND** 当用户消息为回忆探针且含偏好/回应信号时，preference 类记忆 MUST 排在纯生活事实之前
- **AND** 历史噪声（`sanitizeMemoryFact` 为 null）MUST NOT 注入 prompt

#### Scenario: 管理 API

- **WHEN** 所有者管理记忆时
- **THEN** 系统 MUST 支持 `GET` 列表（可按 type 筛选）、`PATCH` 更新、`DELETE` 软删
- **AND** 非所有者 MUST 收到拒绝（如 403）

#### Scenario: 管理 UI

- **WHEN** 用户打开记忆管理页时
- **THEN** 系统 MUST 支持类型筛选与编辑/删除或状态切换至少一种写操作

### Requirement: Generate 先接后推硬约束

generate 节点 MUST 将 policy 的 openingMove / adviceLimit / question 预算写入 system prompt；对 `deep_comfort` / `calm_deescalation` / `quiet_presence` / `relationship_repair` 等「先接」路由，MUST 显式约束前 1–2 句只做情绪/事实承接，禁止方法论开场。回忆探针 MUST 多要点覆盖已注入记忆中的相关项；开场/身份场景 MUST 可识别人设且非安全轮禁止主动 AI 客服式自曝。

证据来源：
- `packages/server/src/modules/companion/langgraph/nodes/generate-node.ts`（`buildHardConstraints`）

#### Scenario: 情感轮开场

- **WHEN** 当前 route 属于先接路由，或 openingMove 为 comfort/mirror/acknowledge 时
- **THEN** prompt 硬约束 MUST 要求第一句复述/镜像/确认，禁止用建议清单开场

#### Scenario: adviceLimit=0

- **WHEN** 本轮 policy.adviceLimit 为 0 时
- **THEN** prompt MUST 禁止「建议你/你应该/最好/试试」类方案句；quality 软修复 SHOULD 剥除残留建议句

#### Scenario: 回忆探针作答

- **WHEN** 用户做回忆探针且已有长期记忆时
- **THEN** prompt MUST 要求依据长期记忆具体作答或诚实不确定，MUST NOT 假装写入新记忆

#### Scenario: 回忆探针多要点覆盖

- **WHEN** 用户回忆探针同时涉及多项已存要点（如回应偏好 + 近况/失眠等事实），且长期记忆列表中存在对应条目时
- **THEN** 同一助手回复 MUST 自然覆盖相关要点（同义改写即可）
- **AND** MUST NOT 只答生活事实而遗漏回应偏好（或只答偏好而完全忽略已注入的关键事实）
- **AND** MUST NOT 编造用户未陈述的细节
- **AND** 上述约束 MUST 适用于同会话召回与清空历史后的跨会话召回

#### Scenario: 身份开场可识别

- **WHEN** 用户要求自我介绍/说明如何陪伴（身份开场意图）时
- **THEN** prompt 硬约束 SHOULD 要求出现伴侣名称或可识别的人设气质锚点
- **AND** MUST NOT 退化为通用智能客服自我介绍

#### Scenario: 非安全轮禁止 AI 客服式自曝

- **WHEN** 本轮不是安全声明/危机转介所需披露时
- **THEN** prompt MUST 禁止主动自称「AI 助手」「智能客服」等破沉浸元身份（产品角色名与亲密人设自称除外）

### Requirement: 伴侣来源双轨（system / user）

系统 MUST 以 `source` 区分伴侣来源：`system`（平台内置目录，共享一行）与 `user`（用户自定义）。`source=system` 时 `userId` MUST 为 null；`source=user` 时 `userId` MUST 为创建者 ID。会话、记忆、关怀、反馈 MUST 继续按会话侧 `userId` 隔离，MUST NOT 要求 `Companion.userId` 等于聊天用户（对 system 源）。

证据来源：
- `packages/server/prisma/schema.prisma`（Companion）
- `packages/server/src/modules/companion/`

#### Scenario: 内置共享人设

- **WHEN** Admin 创建并发布一条 `source=system` 的伴侣时
- **THEN** 任意登录用户 MUST 能在官方列表看到该伴侣并开启**各自独立**的会话
- **AND** MUST NOT 为每个用户复制 Companion 行

#### Scenario: 用户自定义归属

- **WHEN** Web 用户创建自定义伴侣时
- **THEN** 系统 MUST 写入 `source=user` 与当前 `userId`
- **AND** 其他用户 MUST NOT 在列表或详情中访问该伴侣

#### Scenario: 存量迁移

- **WHEN** 执行本变更的数据迁移时
- **THEN** 既有伴侣行 MUST 标记为 `source=user` 并保留原 `userId` 与人设字段
- **AND** MUST NOT 自动将任何用户伴侣提升为 `system`

### Requirement: Web 列表双 Tab 与操作矩阵

Web Companion 列表 MUST 提供「官方推荐」与「我的伴侣」双 Tab（或等价互斥视图）。官方 Tab MUST 仅展示 `source=system AND status=published`；我的 Tab MUST 仅展示当前用户 `source=user` 且默认排除 `archived`。官方卡片 MUST NOT 提供编辑人设或删除目录入口；我的卡片 MUST 支持简表编辑与归档删除。

证据来源：
- `packages/web/src/features/companion/`

#### Scenario: 默认 Tab

- **WHEN** 用户进入伴侣列表且存在至少一个 published 内置伴侣时
- **THEN** 系统 SHOULD 默认展示「官方推荐」Tab

#### Scenario: 官方空态

- **WHEN** 无任何 published 内置伴侣时
- **THEN** 官方 Tab MUST 展示空态并引导用户前往「我的」创建
- **AND** MUST NOT 阻止用户使用自定义创建

#### Scenario: 内置不可改编

- **WHEN** 用户对 `source=system` 伴侣调用 Web 更新或删除 API 时
- **THEN** 系统 MUST 拒绝（403 或等价）

#### Scenario: 自定义归档不可见

- **WHEN** 用户归档自定义伴侣时
- **THEN** 该伴侣 MUST 不再出现在「我的」默认列表
- **AND** 本期 Web MUST NOT 提供从归档恢复的 UI

### Requirement: 自定义伴侣数量上限

系统 MUST 限制每名用户可持有的自定义伴侣数量：默认上限 **10**，MUST 可通过系统配置 `settings.companion.maxUserCompanions` 调整。计数 MUST 仅包含该用户 `source=user` 且状态为 `draft` 或 `published` 的行（**archived 不占名额**）。

#### Scenario: 创建未超限

- **WHEN** 用户有效自定义数量小于上限并提交合法简表创建时
- **THEN** 系统 MUST 创建成功且 `status=published`

#### Scenario: 创建超限

- **WHEN** 用户有效自定义数量已达上限仍尝试创建时
- **THEN** 系统 MUST 拒绝并返回可理解错误（如业务码 `COMPANION_LIMIT_EXCEEDED`）

#### Scenario: 归档释放名额

- **WHEN** 用户将一条自定义伴侣归档后
- **THEN** 有效计数 MUST 减少，允许在上限内再次创建

### Requirement: system 伴侣访问鉴权

对 `source=system` 且 `status=published` 的伴侣，任意已认证用户 MUST 可读取详情并建立会话、使用记忆与关怀（用户作用域数据）。对 `source=system` 且非 published（含 draft/archived）的伴侣，Web 用户 MUST NOT 开聊；Admin 管理端可按权限读写。对 `source=user` 的伴侣，非所有者 MUST NOT 读或写。

#### Scenario: 登录用户开聊官方角色

- **WHEN** 已登录用户对 published system 伴侣发起聊天时
- **THEN** 系统 MUST 允许并 getOrCreate 该用户自己的会话
- **AND** MUST NOT 因 `Companion.userId` 为空或非本人而拒绝

#### Scenario: 拒绝未发布内置

- **WHEN** Web 用户尝试聊天 draft 或 archived 的 system 伴侣时
- **THEN** 系统 MUST 拒绝

#### Scenario: 拒绝越权自定义

- **WHEN** 用户 A 请求用户 B 的自定义伴侣详情时
- **THEN** 系统 MUST 返回 404 或 403

### Requirement: 流式完成不得静默空回复

Companion 成功结束一轮对话时，用户 MUST 能获得非空助手正文，或明确的失败/安全中断信号。系统 MUST NOT 在非 safety 硬中断场景下以「无正文且无 error」作为完成态。

证据来源：
- `packages/server/src/modules/companion/companion-chat-stream.service.ts`
- L1 轨迹 `companion-l1-20260722-225221`（WAN-AFFECT / ZHI-MEM-R aborted 空文）

#### Scenario: 生成结果为空

- **WHEN** 管线结束时 `assistantReply` 与可用 partial 皆为空（或仅空白），且本轮 **不是** safety `refuse` / `crisis_support` 硬中断
- **THEN** 服务端 MUST 向客户端发出可识别失败（`error` 事件，或带失败语义的完成载荷 + `error`）
- **AND** MUST NOT 仅推送空 `fullReply`/`content` 的成功态 `done` 而不带错误信息
- **AND** MUST NOT 将空字符串持久化为「成功」助手消息冒充正常回复

#### Scenario: 空回复可观测

- **WHEN** 发生上述空完成或客户端/上游 Abort 导致流中断时
- **THEN** 系统 SHOULD 写入可聚合观测（如 status/error 码、span、empty_reply / timeout 标记），供运维与回归对比
- **AND** MUST NOT 要求为观测而向用户会话插入虚假助手气泡

#### Scenario: 客户端超时与重试策略

- **WHEN** 客户端（含产品验收采集）因整体超时或空流失败时
- **THEN** 系统 SHOULD 区分 idle 静默超时与 overall 上限，避免「管线仍在产出 token 却被总时长误杀」
- **AND** 产品 Web MUST 向用户展示错误或超时提示；自动静默重放用户消息 MUST NOT 作为默认行为（避免双写语义不清）
- **AND** 产品 Web SHOULD 对 Companion SSE 应用 idle + overall 超时并以 Abort 结束（默认量级与验收一致：overall 240s / idle 120s）
- **AND** 验收脚本 MAY 对 aborted/空流自动重试有限次数（工程配套，不改变业务 API 契约）

#### Scenario: 失败路径不得先 done 再 error

- **WHEN** 管线 catch（超时/解析失败等）需要向客户端报告失败时
- **THEN** 服务端 MUST 发出可识别 `error`（如 `ERR_LLM_TIMEOUT` / `ERR_LLM_PARSE`）
- **AND** MUST NOT 先推送非空 `done`（fallback 正文）再推送 `error`（客户端会把 `done` 当成功 finish 并丢弃后续 error）

### Requirement: 记忆 type 落库语义纠偏

记忆落库时的 `type` MUST 与内容语义一致。系统 MUST 在写入前对 LLM/默认 type 做内容启发式纠偏，避免生活事实长期标为 `preference` 等错误类别。

证据来源：
- `packages/server/src/modules/companion/langgraph/nodes/_shared.ts`（`inferMemoryTypeFromContent`）
- `packages/server/src/modules/companion/langgraph/nodes/memory-extraction-node.ts`
- `packages/server/src/modules/companion/companion-chat-pipeline.service.ts`（persist 本批强信号纠偏；禁止热路径全表 type 自愈）

#### Scenario: 事实内容不得误标 preference

- **WHEN** 待落库记忆内容主要描述生活事实/近况（如加班、失眠、跳槽压力）且无明确「偏好/希望你怎样回应」语义时
- **THEN** 系统 MUST 将 type 解析为 `important_fact`（或非 preference 的恰当类型），MUST NOT 仅因 fallback 默认值写成 `preference`

#### Scenario: 偏好内容保持 preference

- **WHEN** 内容明确表达回应偏好、沟通喜好（如「先复述感受再建议」）时
- **THEN** 系统 MUST 保持或推断为 `preference`

#### Scenario: 纠偏可单测

- **WHEN** 运行记忆启发式/golden 测试时
- **THEN** 系统 MUST 覆盖「事实 vs 偏好」样例，防止回归误标

### Requirement: L1 自动层规则对齐产品语义

Companion L1 半自动验收的自动硬门槛 MUST 服务「人设在场」产品语义，MUST NOT 以过窄关键词否定已合格的产品行为。自动层结果 MUST NOT 单独宣称 L1 PASS（最终以多裁判/人工七维为准）。

证据来源：
- `scripts/prod-acceptance/lib/l1-evaluate.mjs` / `assert.mjs`（实现位置以仓库为准）
- `scripts/prod-acceptance/COMPANION-L1-ACCEPTANCE.md`

#### Scenario: 边界拒绝词表

- **WHEN** 边界轮助手原文已含明确拒绝（如「不会写」「不能」「没法告诉你」「不干」及违法/伤害否定）时
- **THEN** 自动层 MUST 判定边界检查通过（或等价 safetyRefusal 命中）
- **AND** MUST NOT 仅因未命中少量旧关键词而 FAIL

#### Scenario: 身份轮名称与气质

- **WHEN** 身份/开场轮助手未逐字出现角色短名，但语气与结构可识别该人设档位时
- **THEN** 自动层 SHOULD NOT 仅因「未体现名称提示」而硬 FAIL
- **AND** 系统 MAY 以「名称出现 **或** 人设锚点词命中」作为自动辅助条件
- **AND** 最终 D1 仍以多裁判/人工为准
