# 目录结构

> 本项目前端代码的组织方式。

---

## 概述

Web 前端采用 **Feature-Sliced Architecture（FSA）** 模式，将代码按功能模块组织，每个模块包含自身的组件、服务、状态和类型定义。核心技术栈：React 19 + TanStack Start/Router + Zustand + shadcn/ui + Tailwind CSS v4。

---

## 目录布局

```
packages/web/src/
├── api/                      # API 层：alova HTTP 客户端封装
│   ├── KnowledgeBase.ts      # 知识库相关 API
│   ├── auth.ts               # 认证相关 API
│   ├── chat.ts               # 聊天相关 API
│   ├── file.ts               # 文件相关 API
│   ├── settings.ts           # 设置相关 API
│   └── x-chat.ts             # XChat Provider 请求封装
├── components/               # UI 组件层
│   ├── sidebar/              # Icon Rail（路由 active）
│   │   └── Sidebar.tsx
│   ├── tab-bar/              # 已拆除（stub）
│   └── ui/                   # shadcn/ui 基础组件（自动生成）
│       ├── button.tsx
│       ├── dialog.tsx
│       ├── input.tsx
│       └── ...
├── features/                 # 功能模块（核心业务域）
│   ├── auth/                 # 认证模块
│   │   ├── components/       # 组件
│   │   ├── hooks/            # 自定义 Hook
│   │   ├── services.ts       # 业务编排
│   │   └── store.ts          # 模块状态
│   ├── chat/                 # 聊天模块
│   │   ├── components/
│   │   ├── providers/        # Chat Provider 实现
│   │   ├── constants.ts
│   │   ├── hooks.ts
│   │   ├── services.ts
│   │   ├── store.ts
│   │   └── types.ts
│   ├── KnowledgeBase/        # 知识库模块
│   │   ├── components/       # FileBrowser / FileGridItem / FileListItem 等
│   │   ├── document-status.ts # 索引状态文案映射 + pending 判定（唯一映射源）
│   │   ├── services.ts       # loadKbItems silent/poll、上传编排
│   │   ├── store.ts
│   │   └── types.ts
│   ├── companion/            # AI 伴侣模块
│   │   ├── components/
│   │   ├── services.ts
│   │   ├── sse-client.ts
│   │   ├── store.ts
│   │   └── types.ts
│   └── settings/             # 设置模块
│       ├── components/
│       ├── services.ts
│       └── types.ts
├── components/
│   ├── layout/               # WorkspaceStage / SettingsSurface（认证壳）
│   ├── sidebar/              # Icon Rail 70px
│   └── ui/                   # shadcn
├── lib/                      # 工具库
│   ├── route-keepalive.tsx   # Keep-Alive 上下文 / silent refresh
│   ├── route-keepalive-outlet.tsx
│   └── utils.ts
├── overlays/                 # Portal 命令式弹窗系统
│   ├── dialogs/              # 预定义弹窗组件
│   ├── hooks/                # useOverlay Hook
│   ├── host/                 # OverlayHost + 状态管理
│   ├── services/             # overlay-service（命令式 API）
│   └── types/                # 类型定义
├── routes/                   # TanStack Router 路由（仅一级业务 path）
│   ├── __root.tsx
│   ├── _authenticated.tsx    # 认证壳：Rail + WorkspaceStage + KeepAlive
│   ├── index.tsx / login.tsx
│   └── _authenticated/
│       ├── chats.tsx         # selectedSessionId 本地态
│       ├── companions.tsx    # selectedCompanionId 本地态；二级走弹层
│       ├── knowledgeBase.tsx
│       └── settings.tsx / profile.tsx / recycle.tsx
├── stores/                   # 全局状态（Zustand）
│   ├── auth.ts
│   ├── conversation.store.ts
│   └── settings.ts
├── lib/
│   ├── route-keepalive.tsx / route-keepalive-outlet.tsx
│   └── session-cleanup.ts    # 登出清 client 状态（含 legacy gofer-workspace-v1）
├── components/layout/
│   ├── WorkspaceStage.tsx    # 右侧舞台 + 业务白卡 / plain
│   └── SettingsSurface.tsx   # 设置类居中透明表面
├── utils/                    # 工具函数
│   ├── auth-token.ts         # Token 相关
│   ├── cn.ts                 # className 合并
│   ├── file.ts               # 文件工具
│   ├── llm-config.ts         # LLM 配置
│   ├── password-encryption.ts # 密码加密
│   ├── password.ts           # 密码验证
│   ├── server.ts             # alova 实例配置
│   ├── sse-parser.ts         # SSE 解析
│   └── wait-for-init.ts      # 初始化等待
├── globals.css               # Tailwind 全局样式
├── routeTree.gen.ts          # TanStack Router 自动生成
├── router-register.ts        # 路由常量注册
└── router.tsx                # 路由实例
```

---

## 模块组织

### 核心原则

1. **按功能切片**：每个功能模块（auth、chat、KnowledgeBase、companion、settings）独立组织，包含自身的 components/services/store/types
2. **关注点分离**：
   - `components/`：纯 UI 组件，不直接调用 API
   - `services.ts`：业务编排，调用 API 和更新状态
   - `store.ts`：Zustand 状态管理，仅管理本地状态
   - `types.ts`：模块专属类型定义
3. **全局 vs 局部**：
   - `stores/`：全局共享状态（auth、settings、conversation）
   - `features/*/store.ts`：模块局部状态

### 职责边界

| 层级          | 职责               | 示例                                      | 禁止                    |
|---------------|--------------------|-------------------------------------------|-------------------------|
| **API**       | HTTP 请求          | `alovaInstance.Get('/kb')`                | Toast、Store 更新、跳转 |
| **Store**     | 保存状态           | `currentKbId: string`                     | `createKnowledgeBase()` |
| **Service**   | 业务编排           | `removeKnowledgeBase()`                   | —                       |
| **Component** | 展示 UI、触发动作  | `<Button onClick={removeKnowledgeBase}>`  | async 组合超过 3 步     |
| **Page**      | 组装组件、连接状态 | `KbPage = <KbToolbar /> + <FolderTree />` | 复杂业务流程            |

**创建 Service 决策**（满足任一）：
1. 逻辑被多个组件复用
2. 一个操作包含多个步骤：API → 刷新缓存 → 更新状态 → Toast
3. 组件内 async 流程超过 20 行

### 新增功能模块规范

新建功能模块时，遵循以下目录结构：

```
features/new-feature/
├── components/              # UI 组件
│   ├── FeaturePage.tsx      # 页面级组件
│   └── FeatureList.tsx      # 列表组件
├── services.ts              # 业务服务（API 调用 + 状态更新）
├── store.ts                 # Zustand 局部状态
└── types.ts                 # 类型定义（可选）
```

---

## 命名约定

### 文件命名

| 类型 | 规则 | 示例 |
|------|------|------|
| 组件 | PascalCase | `ChatSessionView.tsx` |
| 状态管理 | camelCase + `.store.ts` / `.ts` | `conversation.store.ts`, `auth.ts` |
| API 层 | camelCase + `.ts` | `auth.ts` |
| 工具函数 | camelCase + `.ts` | `llm-config.ts` |
| 类型定义 | `types.ts`（模块内）或特定名称 | `types.ts`, `llm-config.ts` |

### 目录命名

| 类型 | 规则 | 示例 |
|------|------|------|
| 功能模块 | PascalCase（首字母大写） | `KnowledgeBase/`, `companion/` |
| 通用目录 | kebab-case | `ui/` |

### 路由目录

```
routes/_authenticated/
├── chats.tsx                 # /chats 会话工作台（一级真相源）
├── knowledgeBase.tsx         # /knowledgeBase 一级
├── companions.tsx            # /companions 一级（列表+内嵌聊天；无业务二级 file route）
├── settings.tsx / profile.tsx / recycle.tsx
```

**禁止**再增加：`/chat*`、`/history` redirect 壳；`/companions/new`、`/companions/$id/*` 等会拆掉一级 Keep-Alive 的业务子路由。二级 UI 走 `overlays` + `openDialog`（见 `overlay-portal-system.md`、companion 弹层封装）。

---

## 示例

### 完整功能模块示例（chat）

```
features/chat/
├── components/
│   ├── ChatsPage.tsx          # /chats 入口（左列表 + 右会话）
│   ├── SessionListPanel.tsx   # 左栏会话列表
│   ├── ChatEmptyHome.tsx      # 空态首页
│   ├── ChatSessionPanel.tsx   # 会话装载 + 缓存
│   ├── ChatSessionView.tsx    # 消息区 + Composer
│   ├── ChatComposer.tsx       # 统一输入
│   ├── ChatMessage.tsx / ChatMarkdown.tsx / SourceCitations.tsx
│   ├── KnowledgeBaseSelector.tsx
│   └── ProviderSelector.tsx
├── knowledge-chat-transport.ts  # Nest Chat SSE → AI SDK Transport
├── message-sources.ts           # getMessageSources / getRetrievalEmpty
├── constants.ts / hooks.ts / services.ts / store.ts / types.ts
```


> **禁止再引入**：`ChatHistoryPage` / `ChatHistoryList`（已并入 SessionListPanel）、`ChatPageByTab` / `ChatTempHome`、`tabManager` / `workspace.store` / `TabBar`。

### 全局状态示例（auth）

```
stores/auth.ts
├── useAuthStore             # Zustand 状态钩子
├── AuthState                # 状态接口定义
├── setUser()                # 设置用户
├── clearAuth()              # 清除认证（含路由跳转）
└── setInitialized()         # 设置初始化状态
```

---

## 代码引用

| 规范 | 参考文件 |
|------|----------|
| 目录结构 | `packages/web/src/` |
| 功能模块组织 | `packages/web/src/features/chat/` |
| 全局状态 | `packages/web/src/stores/auth.ts` |
| API 层 | `packages/web/src/api/auth.ts` |
| Overlay 弹窗系统 | `packages/web/src/overlays/` |
| 路由配置 | `packages/web/src/routes/` |