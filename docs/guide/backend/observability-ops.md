# 观测运维片段（双模块 Observability M）

权威决策：`docs/grill-sessions/2026-07-18-rag-observability-langfuse-grilling.md`；实现 change：`openspec/changes/dual-module-observability-m`。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `LANGFUSE_PUBLIC_KEY` | 空 | 与 SECRET 同时配置才导出 |
| `LANGFUSE_SECRET_KEY` | 空 | |
| `LANGFUSE_HOST` | 空 | 自建实例 base URL；Admin 外链 |
| `TRACE_SAMPLE_RATE` | `0.1` | 基础采样 0–1 |
| `TRACE_FORCE_CHAT_E2E_MS` | `5000` | Chat e2e 强制采样 |
| `TRACE_FORCE_CHAT_KA_MS` | `3000` | Chat knowledge.ai 阶段强制 |
| `TRACE_FORCE_COMPANION_E2E_MS` | `4000` | Companion e2e 强制 |
| `TRACE_FORCE_COMPANION_GENERATE_MS` | `2500` | Companion generate 节点强制 |
| `OBS_TURN_RETENTION_DAYS` | `30` | W2 `observability_turns` 保留天数 |
| `OBS_SLOW_TOP_N` | `20` | Admin 慢列表条数 |
| `OBS_SSE_EXPOSE_TRACE_ID` | `false` | 仅 dev 可 true，向 C 端 SSE 附带 traceId |
| `OBS_IMPLICIT_REJECT_ENABLED` | `true` | Chat 隐式拒绝词表（Companion 默认关） |
| `OBS_CLEANUP_INTERVAL_MS` | `3600000` | W2 清理轮询间隔 |

未配置 Langfuse 时：**业务 SSE 不受影响**；Admin 以 W2 为时延/旗标读模型。

## 数据模型

- **W2** 表 `observability_turns`：每用户回合至多一行，`traceId` 唯一。
- 双时钟：`latencyMs` = 用户可感知完成；`postProcessMs` = 服务端后处理（不计入 Hub e2e）。
- 默认 e2e P95 **排除** `status=cancelled`。

## 禁用词与口径

- 在线指标 **禁止** 称为「准确率」。
- Chat：契约成功 / 显式负反馈 / 隐式拒绝。
- Companion：过程 outcome（节点时延、memory/emotion/route/quality 等），**无** Chat 强文案 CTA。
- 离线 eval（`evals/`）场景通过率与在线 KPI **命名隔离**。

## 演示

见 change 内 `DEMO.md`。
