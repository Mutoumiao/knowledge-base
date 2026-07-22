# KnowledgeBase UI 开发指南

> **Purpose**：知识库前端（`packages/web/src/features/KnowledgeBase/`）实现约定。  
> **Primary OpenSpec**：[knowledge-base/spec.md](../../../openspec/specs/knowledge-base/spec.md) · [document-lifecycle.md](../../../openspec/specs/knowledge-base/document-lifecycle.md) · [queue/spec.md](../../../openspec/specs/queue/spec.md)

---

## 1. 上传成功 ≠ 索引成功

| 概念 | 权威位置 | 前端表现 |
|------|----------|----------|
| **上传** | MinIO + `Document` 行创建 | `UploadTask`：`queued → uploading → completed/failed` |
| **索引** | Nest `Document.status`（Worker + Knowledge AI） | 文档卡片/列表徽章：`uploaded → indexing → ready/failed` |

- Knowledge AI `POST /index` **无百分比进度**；成功 = HTTP 200 + `status: "ok"`。
- 前端 **不得** 用上传进度条冒充索引进度；也不得假造 0–100% 索引条，除非后端提供真实进度契约。

---

## 2. 文档索引状态展示（Convention）

### 权威字段

- `DocumentItem.status`: `uploaded | chunking | embedding | indexing | ready | failed`
- `DocumentItem.errorMessage?`：失败原因（API 字段 `errorMessage`，normalize 兼容 `error`）

> Worker 实际主路径：`uploaded → indexing → ready|failed`。`chunking`/`embedding` 为 schema 遗留态，UI **合并展示为「索引中」**。

### 文案与样式映射

**唯一映射源**：`features/KnowledgeBase/document-status.ts`（`DOCUMENT_STATUS_CONFIG`）。

| status | 文案 |
|--------|------|
| `uploaded` | 排队中 |
| `chunking` / `embedding` / `indexing` | 索引中 |
| `ready` | 就绪 |
| `failed` | 失败 |

- 网格：`FileGridItem` 右上角徽章；失败原因放在 **整卡 button 的 `title`**（徽章 `pointer-events-none`，勿把 title 只挂在徽章上）。
- 列表：`FileListItem` 文件名旁 inline 徽章；失败 `title={errorMessage}`。
- `aria-label` 须包含状态文案（如「打开文档 x，就绪」）。

### Don't：再次冻结徽章

```tsx
// ❌ 不要用「RAG 未就绪」再次整段注释徽章
// const statusConfig = ... // 已解冻，状态由后端真实写入

// ✅ 从 document-status 读取并渲染
const statusConfig = getDocumentStatusConfig(item.status)
```

---

## 3. 静默列表刷新 + 索引状态轮询（Pattern）

### API（services）

```ts
loadKbItems(kbId, folderId?, sort?, options?: {
  silent?: boolean          // true：不置 fileLoading / 不写 fileError（避免骨架闪烁）
  pollIndexStatus?: boolean // true：若列表含 pending 状态则启动轮询
})

cancelIndexStatusPoll()     // 切目录 / 卸载 FileBrowser / 进入搜索态时必须调用
```

### 行为契约

| 项 | 值 |
|----|-----|
| Pending 判定 | `uploaded \| chunking \| embedding \| indexing`（`isDocumentIndexPending`） |
| 间隔 | 2s |
| 最长 | 90s |
| 取消 | `indexPollGeneration` + `clearTimeout(indexPollTimer)`；**禁止**裸 `setTimeout` 无清理 |
| 触发点 | ① `uploadFiles` 结束后（仍在目标目录）② `FileBrowser` 进入目录 `pollIndexStatus: true` |
| 搜索态 | **取消**轮询，勿对搜索结果轮询 |

### Wrong vs Correct

#### Wrong

```ts
// 轮询时打开全局 loading → 列表闪骨架
await loadKbItems(kbId, folderId, sort) // 默认 fileLoading=true

// 组件卸载不取消 timer → 泄漏 / 错目录写 store
setTimeout(() => loadKbItems(...), 2000)
```

#### Correct

```ts
await loadKbItems(kbId, folderId, sort, { pollIndexStatus: true })
// tick 内部：
await loadKbItems(kbId, folderId, sort, { silent: true })

// FileBrowser useEffect cleanup:
return () => cancelIndexStatusPoll()
```

---

## 4. 数据归一化

`normalizeDocumentItem` MUST：

- `size`：string → number（BigInt 序列化兼容）
- `errorMessage`：`errorMessage ?? error ?? null`

列表接口形态：`{ items, total, page, pageSize }`（兼容历史数组）。

---

## 5. 测试要求

| 范围 | 断言点 |
|------|--------|
| `document-status.test.ts` | 文案映射；pending 判定；failed title 优先 errorMessage |
| `FileGridItem` / `FileListItem` | 各 status 可见文案；failed 时 title 含原因；aria 含状态 |
| `services` | normalize 后带 `errorMessage`；静默路径不置 `fileLoading`（若扩测） |
| `FileBrowser` mock | 须包含 `cancelIndexStatusPoll` |

---

## 6. Common Pitfalls

| 症状 | 原因 | 处理 |
|------|------|------|
| 上传显示完成但无法问答 | 只看了 UploadTask，索引仍非 `ready` | 展示/轮询 `Document.status` |
| Hover 看不到失败原因 | title 挂在 `pointer-events-none` 徽章上 | title 挂交互层（button） |
| 切目录后仍请求旧 folder | 未 `cancelIndexStatusPoll` | effect cleanup + generation |
| 以为能做索引百分比条 | Knowledge AI / Worker 无 progress 契约 | 仅阶段徽章；真进度需新后端契约 |

---

## 7. Related

- OpenSpec 状态机与「可观察索引状态」：**业务权威**在 OpenSpec；本文件只写 **Web 如何渲染与刷新**。
- 后端 Worker：`packages/server/src/processors/queue/indexing.worker.ts`（勿在 web 重复实现状态机）。
- 入口：`document-status.ts` · `services.ts` · `FileGridItem` / `FileListItem` / `FileBrowser`。
