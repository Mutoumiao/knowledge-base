# GoferBot

GoferBot — 云端优先的 AI Workspace / Agent OS。基于 React + NestJS 的 Web 应用，支持文档管理、多 Provider LLM 问答、**Python Knowledge AI** 驱动的 RAG、以及 **LangGraph Companion** 伴侣聊天。

## 技术栈详情

> **REFERENCE_ONLY**: 各 package 的权威技术栈和编码约定请参见对应 `.trellis/spec/` 目录。

| Layer | Technology | Version / 说明 |
|-------|------------|----------------|
| **前端框架** | React + TanStack Start | React 19.x, TanStack Start latest |
| **前端路由** | TanStack Router | 1.132.x |
| **UI 构建** | Vite + Tailwind CSS | Vite 8.x, Tailwind 4.x |
| **状态管理** | Zustand | 5.x |
| **请求库** | alova (CRUD) + AI SDK SSE | alova；`ai` / `@ai-sdk/react` `useChat` + 自定义 Transport |
| **UI 组件** | shadcn/ui + Radix | Chat Composer / 列表自研组件 |
| **Markdown** | @ant-design/x-markdown | `XMarkdown` streaming |
| **后端框架** | NestJS + Fastify | NestJS 10.x, Fastify 4.x |
| **数据库** | PostgreSQL + pgvector | PG 16 |
| **全文检索** | Elasticsearch | BM25（Knowledge AI 侧） |
| **ORM** | Prisma | 5.x |
| **缓存/队列** | Redis + BullMQ | Redis 7, BullMQ 5.x |
| **对象存储** | MinIO (S3 兼容) | - |
| **AI SDK（服务端）** | LangChain + LangGraph | LangChain 1.x, StateGraph |
| **知识 AI** | Python FastAPI + uv | `services/knowledge-ai-service`（索引 / 混合检索 / 问答 SSE） |
| **可观测** | ObservabilityTurn + 可选 Langfuse | Nest 聚合；Admin Dashboard 观测 Hub |
| **数据校验** | Zod | data 包 3.x；server 4.x |
| **测试** | Vitest + Playwright | Vitest 4.x, Playwright latest |
| **包管理** | pnpm（TS monorepo）+ uv（Python） | - |
| **格式/Lint** | Biome | 2.5.x |

## Agent 核心约束

1. **先思后码**：不确定就问，规则冲突时优先「简单至上」
2. **外科手术式修改**：只改必要处，顺手优化标 `#adjacent-fix`
3. **Token 预算**：单任务≤8k，超 80% 暂停压缩，超 95% 终止
4. **落笔先阅读**：通读导出接口、调用方、公共工具；代码探索优先用 codegraph
5. **检查点**：每关键步骤输出 `[CHECKPOINT] ✅|🔍|⏳|🚨`
6. **显式失败**：置信度<90% 输出 `[UNCERTAIN]` 并征求指令

## 项目结构

```
├── packages/
│   ├── web/              # React 主前端
│   │   ├── features/chat/          # Knowledge Chat（AI SDK useChat + KnowledgeChatTransport）
│   │   ├── features/companion/     # Companion（useChat + CompanionChatTransport）
│   │   ├── features/KnowledgeBase/ # 知识库 / 上传 / 回收站相关 UI
│   │   ├── features/settings/      # 用户设置 / Provider
│   │   ├── overlays/               # Portal 弹窗（types → store → service → host）
│   │   ├── stores/                 # 全局 auth / settings / conversation
│   │   └── api/                    # alova CRUD 客户端
│   ├── admin/            # 管理后台（独立前端）
│   │   ├── features/auth|users|roles|audit|dashboard
│   │   ├── features/companions|invitations|model-providers
│   │   ├── features/module-settings|observability|profile
│   │   └── utils/                  # alova + Token 刷新订阅者队列
│   ├── server/           # NestJS API
│   │   ├── auth/                   # 认证（JWT 双令牌、Rotation、App/Spider 守卫）
│   │   ├── modules/
│   │   │   ├── chat/               # Chat SSE + 多 KB 问答编排
│   │   │   ├── companion/          # LangGraph Pipeline（11 节点）+ Care/Memory/Admin
│   │   │   ├── knowledge-base/     # KB / Folder / Document CRUD + 清理
│   │   │   ├── admin/              # RBAC、审计、邀请码、Dashboard 观测
│   │   │   ├── observability/      # ObservabilityTurn / Langfuse 适配
│   │   │   ├── session|settings|user|health|permission
│   │   ├── processors/
│   │   │   ├── knowledge-ai/       # Nest → Knowledge AI HTTP Client
│   │   │   ├── queue/              # BullMQ IndexingWorker / finalize
│   │   │   ├── storage/            # MinIO 存储抽象
│   │   │   ├── parser/             # 文档解析 → 纯文本交接
│   │   │   └── database/           # PrismaService
│   │   └── prisma/                 # schema + migrations + seed
│   └── data/             # 共享 Zod schemas / 权限常量 / 类型
├── services/
│   └── knowledge-ai-service/       # Python 知识域（FastAPI + uv）
│       ├── indexing / retrieval / generation / understanding
│       ├── infrastructure (PG knowledge schema + ES)
│       └── docker-compose.knowledge.yml  # ES + knowledge-ai
├── scripts/
│   ├── prod-acceptance/            # RAG / Companion L1 / 观测 HTTP 验收
│   └── *.ts|cjs|mjs                # 端口清理、测库清理、手验脚本
├── evals/                # Companion / RAG 轻量评测用例
├── e2e/                  # Playwright 浏览器 E2E
├── tests/                # 根级 integration / e2e-api 配置入口
├── docs/                 # guide / discovery / handoff / report
├── openspec/             # Business Knowledge（WHAT）
├── .trellis/             # Development Knowledge（HOW）+ tasks
├── BACKLOG.md
└── CHANGELOG.md
```

## 架构亮点

> 快速 Orientation。详细开发模式见 Trellis，业务规范见 OpenSpec。

| 系统 | 架构要点 |
|------|----------|
| **SSE 流式** | **双轨同范式**：Chat 用 `KnowledgeChatTransport`，Companion 用 `CompanionChatTransport`；均为 AI SDK `useChat` 映射 Nest SSE。Markdown 用 `XMarkdown`。**已弃用** `@ant-design/x-sdk` / `useXChat` |
| **知识域边界** | Nest 只做编排 / 鉴权 / 解析 / 队列；**索引、混合检索、Rerank、知识生成**在 Python Knowledge AI。Companion **不**走 Knowledge AI |
| **RAG 管线** | L1 Must-Merged → Hybrid(pgvector ∥ ES BM25) → RRF → Parent → API Rerank（失败降级）→ Context → Generation；空检索 strict（`retrieval_empty`，不编造） |
| **Companion 工作流** | LangGraph StateGraph — 11 节点（safety→…→memory_extraction）+ 条件路由；结构化 JSON 由 `StructuredOutputService` 方法链 + repair 预算 |
| **RBAC** | Admin 三层：`beforeLoad` → 菜单过滤 → `PermissionMatrix`；**23** 权限码；预置 `super_admin` / `admin` / `user` |
| **Overlay Portal** | 命令式 `openDialog` → Promise；createPortal 到 body |
| **Token 刷新** | 订阅者队列 + `isRefreshing` 互斥，并发 401 聚合为单次 refresh |
| **观测** | `ObservabilityTurn` + CompanionObsEvent；Admin Dashboard KPI / 详页；可选 Langfuse |
| **测试金字塔** | Unit(vitest) → Integration → E2E API → E2E Browser；另有 `evals/` 与 `scripts/prod-acceptance` |

## 常用命令

```bash
# 开发
pnpm infra:up          # Docker：PG / Redis / MinIO
pnpm dev               # data + server + web（会先 kill 端口）
pnpm dev:web
pnpm dev:server
pnpm dev:admin

# Knowledge AI（另开终端；需 ES，见 services/knowledge-ai-service/README.md）
cd services/knowledge-ai-service && uv sync --all-extras && uv run knowledge-ai
# 或：docker compose -f services/knowledge-ai-service/docker-compose.knowledge.yml up -d --build

# 质量
pnpm type-check
pnpm test              # vitest（根配置）
pnpm test:unit
pnpm test:integration
pnpm test:e2e:api
pnpm test:e2e          # Playwright
pnpm test:e2e:web
pnpm test:e2e:admin
pnpm test:all
pnpm test:eval         # evals/run.mjs

# 格式 / Lint（Biome）
pnpm format            # 写入
pnpm format:check
pnpm lint
pnpm check
pnpm check:fix
pnpm check:staged
pnpm check:changed
pnpm check:ci

# 基建
pnpm infra:down
pnpm infra:logs
pnpm db:cleanup        # 清理集成测试库
```

## 权威知识索引

> **AI Knowledge Architecture**（详见 [openspec/README.md](openspec/README.md)）：
> - **Business Knowledge (WHAT)** → `openspec/specs/`：业务规则、API 契约、验收标准
> - **Development Knowledge (HOW)** → `.trellis/spec/`：编码约定、测试策略、陷阱
> - **Workspace Rules (ALWAYS)** → `.trae/rules/`
> - **Golden Rule**：实现变了仍有效 → OpenSpec；否则 → Trellis；始终强制 → Rules
>
> **Progressive Loading**：不要预加载全部规范。
> - **Workflow A（改业务）**：OpenSpec change artifacts → Apply → Check → Archive
> - **Workflow B（纯开发）**：Trellis package `index.md` → 模块指南 → 需要时再跳 OpenSpec

### 项目全局

| 文档 | 内容 |
|------|------|
| [openspec/README.md](openspec/README.md) | 知识架构导航 |
| [docs/guide/](docs/guide/) | 权威源原则、工作流、渐进加载、沉淀规则 |
| [docs/discovery-report.md](docs/discovery-report.md) | 全局认知基线（历史盘点，细节以代码与 OpenSpec 为准） |
| [services/knowledge-ai-service/README.md](services/knowledge-ai-service/README.md) | Knowledge AI 本地 / Docker / API |
| [scripts/README.md](scripts/README.md) | 仓库脚本与 prod-acceptance 约定 |
| `.trellis/tasks/` | 活跃 / 已归档开发任务 |
| `.trellis/workspace/` | 会话日志 |

### 编码规范入口（HOW — Trellis）

| Package / 域 | Trellis 入口 |
|--------------|--------------|
| `packages/web/` | [.trellis/spec/web/frontend/index.md](.trellis/spec/web/frontend/index.md) |
| `packages/admin/` | [.trellis/spec/admin/frontend/index.md](.trellis/spec/admin/frontend/index.md) |
| `packages/server/` | [.trellis/spec/server/backend/index.md](.trellis/spec/server/backend/index.md) |
| `packages/data/` | [.trellis/spec/data/frontend/index.md](.trellis/spec/data/frontend/index.md) |
| Companion 管线 | [.trellis/spec/server/backend/companion-pipeline.md](.trellis/spec/server/backend/companion-pipeline.md) |
| Knowledge AI 接线 | [.trellis/spec/server/backend/knowledge-ai-service.md](.trellis/spec/server/backend/knowledge-ai-service.md) |
| 跨包思维 | [.trellis/spec/guides/index.md](.trellis/spec/guides/index.md) |

### 功能规范（WHAT — OpenSpec）

> 按需查阅，勿预加载。

| 域 | OpenSpec capability |
|----|---------------------|
| **server 核心** | [auth](openspec/specs/auth/spec.md)、[chat](openspec/specs/chat/spec.md)、[session](openspec/specs/session/spec.md)、[settings](openspec/specs/settings/spec.md)、[user](openspec/specs/user/spec.md)、[queue](openspec/specs/queue/spec.md) |
| **Companion** | [companion](openspec/specs/companion/spec.md)、[companion-persona](openspec/specs/companion-persona/spec.md)、[companion-care](openspec/specs/companion-care/spec.md) |
| **知识 / RAG** | [knowledge-ai](openspec/specs/knowledge-ai/spec.md)、[rag](openspec/specs/rag/spec.md)、[knowledge-base](openspec/specs/knowledge-base/spec.md)、[document](openspec/specs/document/spec.md)、[document-lifecycle](openspec/specs/knowledge-base/document-lifecycle.md) |
| **Admin** | [admin](openspec/specs/admin/spec.md)、[admin-observability](openspec/specs/admin-observability/spec.md)、[invitation-codes](openspec/specs/invitation-codes/spec.md) |

### 持续演进机制

> 详见 [docs/guide/knowledge-workflow.md](docs/guide/knowledge-workflow.md)。

- **Workflow A**：Grill → OpenSpec Explore → Propose → Apply → Trellis Check → Update Spec → Archive
- **Workflow B**：Brainstorm（可选）→ Trellis Before Dev → 开发 → Trellis Check → Update Spec
- **判断**：是否改变业务规则 / API 契约 / 验收标准？是 → A；否 → B

### Spec 更新参考

> [docs/guide/spec-update-reference.md](docs/guide/spec-update-reference.md)

### 环境变量

| 文件 | 职责 |
|------|------|
| 根目录 `.env.example` | Docker-Infra + Shared（DB / Redis / MinIO 等） |
| `packages/server/.env.example` | Server-Only（JWT、端口、CORS、`KNOWLEDGE_AI_*` 等） |
| `packages/web` / `admin` 的 `.env.example` | 前端 Vite 变量 |
| `services/knowledge-ai-service/.env.example` | Python 服务令牌、ES、embedding 维等 |

- 服务端加载顺序：`packages/server/.env` → 根目录 `.env`（后者覆盖同名）
- Nest 连 Knowledge AI 权威变量：`KNOWLEDGE_AI_BASE_URL`（`KNOWLEDGE_AI_URL` 为遗留别名）
- 运维观测补充：[docs/guide/backend/observability-ops.md](docs/guide/backend/observability-ops.md)

## 数据库模型（核心）

> Orientation Summary。完整 schema：`packages/server/prisma/schema.prisma`。

```
User ──→ AuthSession / RefreshToken
  │
  ├──→ KnowledgeBase ──→ Folder ──→ Document ──→ Chunk (业务元数据；向量/ES 索引在 Knowledge AI)
  ├──→ Setting / Application / SystemFlag
  ├──→ Session (Chat) ──→ Message
  │
  ├──→ Companion (source: system|user)
  │       ├── CompanionConversation ──→ CompanionMessage
  │       ├── CompanionMemory (5 types)
  │       ├── CompanionMessageFeedback
  │       ├── CompanionCarePlan / CompanionCareEvent
  │       └── CompanionObsEvent
  │
  ├──→ GroupChat ──→ GroupChatMember / GroupChatMessage
  ├──→ InvitationCode
  ├──→ ObservabilityTurn
  └──→ Role ──→ Permission (via RolePermission)
                 └── AdminAuditLog
```

- **User / AuthSession / RefreshToken**：账户与会话令牌
- **Role / Permission / RolePermission**：Admin RBAC（23 权限码；`super_admin`/`admin` 默认全量，`user` 空）
- **InvitationCode**：邀请码注册
- **KnowledgeBase / Folder / Document / Chunk**：知识库树与文档元数据；**向量与 ES 切片由 Knowledge AI 维护**（`knowledge` schema）
- **Session / Message**：Knowledge Chat 会话
- **Companion\***：内置/用户伴侣、对话、记忆、反馈、关怀、观测侧信道
- **ObservabilityTurn**：跨模块轮次观测聚合
- **Setting / Application\***：用户与系统 Provider 配置
- **AdminAuditLog**：管理操作审计

## 关键入口（按任务跳转）

| 我想… | 先看 |
|-------|------|
| 改 Companion 节点 / 路由 / 结构化输出 | OpenSpec companion + Trellis companion-pipeline + `langgraph/` |
| 改知识问答 / 索引 / 召回 | OpenSpec knowledge-ai + Trellis knowledge-ai-service + `processors/knowledge-ai` + Python 服务 |
| 改 Web Chat / Companion 流式 UI | Trellis sse-streaming-architecture + 对应 `*-chat-transport.ts` |
| 改 Admin 权限 / 观测大盘 | OpenSpec admin / admin-observability + admin Trellis |
| 加共享 DTO / 权限码 | `packages/data` + 对应 OpenSpec |
| 跑 L1 / 生产向验收 | `scripts/prod-acceptance/README.md` |
