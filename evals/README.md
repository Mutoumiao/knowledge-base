# 离线 Eval（与在线 KPI 命名隔离）

本目录为 **离线评测** 门禁脚手架，**不是** Admin 在线「准确率」。

| 在线（Admin / W2） | 离线（本目录） |
|--------------------|----------------|
| 契约成功率、空结果率、过程 outcome | 场景通过率、规则锚命中、rubric 分 |
| 实时聚合 | 版本化用例 + 可选裁判 |

## 运行

```bash
pnpm test:eval
```

报告输出：`evals/reports/latest.json`（gitignore 可选）。

## 结构

- `rag/` — 知识库问答用例（≥20 条规则锚）
- `companion/` — 伴侣场景 + 期望 outcome（≥8）
- `run.mjs` — 运行器（规则锚优先；裁判可选）

## rubricVersion

用例内 `rubricVersion` 字段用于版本对齐；变更裁判标准时递增，避免与历史报告混比。
