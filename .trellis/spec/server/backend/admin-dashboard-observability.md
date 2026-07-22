# Admin Dashboard / Observability 聚合开发指南

> **REFERENCE_ONLY**: 此文件记录开发指南（HOW）。业务规范权威源为
> [openspec/specs/admin-observability/spec.md](../../../../openspec/specs/admin-observability/spec.md)
> 与 [openspec/specs/admin/spec.md](../../../../openspec/specs/admin/spec.md)（WHAT）。

---

## Purpose

指导在 Nest Admin 中实现与维护「观测 Hub + RAG/Companion 详页」聚合：入口路径、扫描边界、健康合成、硬中断侧信道、测试与常见坑。不重复 OpenSpec SHALL 全文。

## Primary OpenSpec

- `openspec/specs/admin-observability/spec.md`
- `openspec/specs/admin/spec.md`

## Related OpenSpec

- `openspec/specs/chat/spec.md`
- `openspec/specs/companion/spec.md`
- `openspec/specs/rag/spec.md`

## Related Trellis Guides

- [companion-pipeline.md](./companion-pipeline.md) — latencyMs / 硬中断不落助手
- [database-guidelines.md](./database-guidelines.md) — 迁移与 Prisma
- Admin 前端：[../admin/frontend/dashboard-observability.md](../../admin/frontend/dashboard-observability.md)

## When You Need To

- 新增/修改 Admin 观测 KPI 或 section
- 调整 metadata 扫描上限/超时
- 排查 `prisma://` Client、硬中断 pending、样本不足
- 为观测写单测/集成测

## Module Dependencies

- `HealthService`、`KnowledgeAiClient.health()`
- Prisma：`Message` / `Document` / `CompanionMessage` / `CompanionMessageFeedback` / `CompanionObsEvent` / **`ObservabilityTurn`（W2 真源）**
- `ObservabilityTurnService`（`@Global` `ObservabilityModule`）：Hub/详页 empty·degraded·e2e·慢列表优先读 W2；**无 W2 样本时不得混扫消息 metadata 冒充 empty/degraded turn 率**
- Zod：`@goferbot/data` dashboard + observability schemas
- 权限：`dashboard:read`、`system:metrics`

## Development Entry

| 职责 | 路径 |
|------|------|
| Hub API | `packages/server/src/modules/admin/dashboard.controller.ts` |
| 详页 API | `packages/server/src/modules/admin/observability.controller.ts` |
| 聚合服务 | `packages/server/src/modules/admin/services/dashboard-observability.service.ts` |
| 纯函数 | `packages/server/src/modules/admin/services/dashboard-observability.utils.ts` |
| DTO | `packages/server/src/modules/admin/dto/dashboard-query.dto.ts` |
| 硬中断写入 | `packages/server/src/modules/companion/repositories/companion-obs-event.repository.ts` |
| Chat degraded | `packages/server/src/modules/chat/chat.service.ts` |
| 契约 | `packages/data/src/schemas/dashboard.schema.ts` |
| 单测 | `packages/server/tests/modules/admin/` |
| 集成 | `tests/integration/admin-dashboard-observability.spec.ts` |

## Implementation Notes

### 设计决策：Hub + 两详页 + 权限 B

- summary → `dashboard:read`；observability/* → `system:metrics`
- 一期主导航 **不**挂观测分组；`nav: false` + Hub 直链
- 禁止生产 mock；开发仅 `VITE_USE_DASHBOARD_MOCK=1`（前端）

### 设计决策：硬中断 A1+ 侧信道

- 会话 **不**落助手气泡；写 `companion_obs_events.type=safety_hard_stop`
- 写失败吞错，不挡主路径
- 聚合：`events / companion_user_messages`；表不可用 → `pending_instrumentation`

### 设计决策：扫描 + 超时

- `take` 上限默认 `10000`，`DASHBOARD_METADATA_SCAN_LIMIT` 可覆盖
- `SCAN_TIMEOUT_MS = 8000`；超时返回 fallback + `partial`/样本不足
- Companion 详页 **单次** metadata 扫描同时服务 KPI + emotion（禁止二次全表扫）

### 健康合成

```
核心依赖 down → down
仅 KA 不可达/降级 或 core degraded → degraded
否则 ok
```

### KPI 构造

使用 `buildRateKpi` / `buildP95Kpi` / `buildCountKpi`：

- `instrumented=false` → `pending_instrumentation`
- `denominator < min`（默认 1）→ `insufficient_samples`
- 计数型（索引失败）无样本时仍 `ready` 且 `value=0`

### Prisma Client 生成

> **Warning**: Windows 上若使用 `prisma generate --no-engine`，运行时会要求 `DATABASE_URL` 为 `prisma://`，与本地 `postgresql://` 冲突。**运行服务必须完整 `prisma generate`（含 query engine）**。

---

## Scenario: Admin 观测聚合（跨层 code-spec 深度）

### 1. Scope / Trigger

- 新 API 契约、跨层 summary/detail 形状、DB 表 `companion_obs_events`、Health/KA 探测 → 强制 code-spec 深度。

### 2. Signatures

```
GET /api/admin/dashboard/summary?window=1h|24h|7d
  @RequirePermission('dashboard:read')

GET /api/admin/observability/rag?window=...
GET /api/admin/observability/companion?window=...
  @RequirePermission('system:metrics')

model CompanionObsEvent {
  id, type, companionId, conversationId?, userId?,
  boundaryAction?, reason?, createdAt
  @@map("companion_obs_events")
}
```

服务入口：

```typescript
DashboardObservabilityService.getSummary(window)
DashboardObservabilityService.getRagDetail(window)
DashboardObservabilityService.getCompanionDetail(window)
CompanionObsEventRepository.recordSafetyHardStop(input) // 不抛到主路径
```

### 3. Contracts

**Query**

| 字段 | 类型 | 约束 |
|------|------|------|
| window | enum | 可选，默认 `24h`；仅 `1h`\|`24h`\|`7d` |

**Summary 响应（核心字段）**

| 字段 | 说明 |
|------|------|
| window, generatedAt | 窗 + ISO 时间 |
| health.status | ok\|degraded\|down |
| health.components[] | name, status, latencyMs? |
| rag.emptyRate / degradedRate / indexFailureCount | Kpi |
| companion.p95LatencyMs / qualityFailRate / safetyHardStopRate / negativeFeedbackRate | Kpi |
| inventory.*Count | 非负整数 |

**Kpi**

| 字段 | 约束 |
|------|------|
| status | ready \| pending_instrumentation \| insufficient_samples |
| value | 仅 ready 时宜有数值 |
| sampleSize, partial, note, unit | 可选 |

**Detail 响应**

| 字段 | 约束 |
|------|------|
| kpis[] | 顶栏 |
| sections[key] | status: ready\|pending_instrumentation\|partial；metrics[] |
| RAG keys | index, retrieve, quality_deps |
| Companion keys | latency, retrieval, emotion, cost_safety |

**Env**

| Key | 必填 | 说明 |
|-----|------|------|
| DATABASE_URL | 是 | `postgresql://` 直连（非 prisma://） |
| DASHBOARD_METADATA_SCAN_LIMIT | 否 | 默认 10000 |

### 4. Validation & Error Matrix

| 条件 | 结果 |
|------|------|
| 未登录 | 401 |
| 无 dashboard:read 调 summary | 403 |
| 无 system:metrics 调 observability/* | 403 |
| window 非法 | Zod/DTO 校验失败（400） |
| companion_obs 表缺失/查询抛错 | safetyHardStopRate → pending_instrumentation |
| metadata 扫描超时 | fallback + warn；相关 KPI insufficient 或 partial |
| 硬中断写 obs 失败 | 日志 error；主聊天仍返回 ERR_SAFETY_BLOCKED |

### 5. Good / Base / Bad Cases

- **Good**：窗内有 completed Chat 助手消息 → empty/degraded 可 ready；有 companion latencyMs → P95 ready；obs 表可 count → hard-stop ready（分母>0）。
- **Base**：无业务流量 → 比率类 `insufficient_samples`；索引失败 `ready` 且 0；retrieval section pending。
- **Bad**：API 失败后前端静默 mock 假 KPI；硬中断落助手气泡凑数；详页二次全量扫 metadata。

### 6. Tests Required

| 层级 | 断言点 |
|------|--------|
| Unit utils | windowToMs、buildRateKpi 三态、approximateP95、qualityIsFail |
| Unit service | summary 形状、KA down→degraded、retrieval pending、obs 不可用→pending、单次 findMany |
| Unit chat | degraded=true 写入；未降级省略字段 |
| Unit obs repo | create payload；写失败不抛 |
| Integration | summary 200+Zod；dash_only 403 observability；super_admin 200 detail sections |
| E2E Admin | Hub 无假 CPU；summary 200；详情入口；companion retrieval pending 文案 |

### 7. Wrong vs Correct

#### Wrong

```typescript
// 生产失败静默 mock
try { return await fetchSummary() } catch { return getFakeStats() }

// 硬中断为凑 KPI 落助手
await messageRepo.save({ role: 'assistant', content: 'blocked' })
```

#### Correct

```typescript
// 失败上抛 / 错误态；开发仅显式 env mock
return fetchDashboardSummary(window).send()

// 硬中断侧信道
await obsEvents.recordSafetyHardStop({ companionId, boundaryAction, ... })
// 不 persist assistant
```

---

## Testing Checklist

- [ ] utils 纯函数覆盖 rate/P95/window
- [ ] service mock Prisma 覆盖 health 合成与 hard-stop pending
- [ ] 集成测 403/200 + companion_obs_events 表存在
- [ ] 迁移已 apply 后再验 hard-stop ready 路径
- [ ] 禁止 `--no-engine` 生成后启动 server

## Common Pitfalls

1. **样本不足被当成 bug**：窗内无流量时比率 KPI 应为 `insufficient_samples`，不要造假数。
2. **Admin 登录要角色码 admin/super_admin**：仅自定义角色 + 权限码无法 loginAsAdmin；集成测有限权限应用 `admin` 角色码并裁剪 `role_permissions`。
3. **generate --no-engine** → `InvalidDatasourceError: prisma://`。
4. **quality_deps 在 down 时勿标 ready**：非 ok 用 `partial`。
5. **Companion 详页禁止二次 scan**：emotion 与 latency/quality 同次聚合。

## Review Checklist

- [ ] 权限装饰器与前端 `requiredPermission` / Hub 入口一致
- [ ] 口径与 `dashboard.schema.ts` 常量一致
- [ ] 无 CPU/经营环比主叙事
- [ ] 硬中断不落助手
- [ ] OpenSpec delta 与实现路径一致
