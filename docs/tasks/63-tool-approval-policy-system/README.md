# Task 63: 工具用户输入请求系统（User Input Request）

## 任务概述

**创建时间**：2026-06-21  
**状态**：🟢 设计完成，准备实施  
**优先级**：P1（功能增强）  
**前置依赖**：Task 62.1.2（多 pendingApprovals 支持）

### 背景

**核心认知转变**：工具"审批"本质上不是"批准/拒绝"，而是**工具在执行过程中主动请求用户输入**。

当前问题：
- 工具审批机制（`approvalRequired: true`）是静态的，无法根据参数动态决定
- `request_user_input` 是特殊实现，无法复用到其他工具
- 无法支持复杂的用户输入场景（如 LLM 生成表单）

本 task 目标：设计并实现统一的"用户输入请求"系统，让任何工具都能在执行时主动向用户请求输入（文本、选择、确认、复杂表单等）。

### 心智模型

```typescript
// 工具开发者视角
async execute(toolCallId, args) {
  // 工具执行中需要用户输入
  const userInput = await requestUserInput(formSpec);
  
  // 继续执行
  return processWithUserInput(userInput);
}
```

虽然实际实现是 Harness 暂停 → 等待用户 → 恢复执行，但从工具开发者视角看，就像是同步调用 `await requestUserInput()`。

---

## 需求分析

### 三种核心场景

**1. Yes/No 权限审批**
- **展示**：单选（批准/拒绝）
- **返回**：`{ approved: boolean }`
- **示例**：skill 执行权限确认
- **本质**：单个 `radio` 字段

**2. 问答列表（Request User Input）**
- **展示**：多个问题，每个问题可以是文本输入、单选、多选
- **返回**：`{ answer_0: "val1", answer_1: "val2", ... }`
- **示例**：Agent 需要用户回答多个问题
- **本质**：多个 `text`/`select`/`checkbox` 字段

**3. 结构化表单（LLM 生成）**
- **展示**：复杂表单（文本、数字、下拉、开关等）
- **返回**：结构化对象（根据表单定义）
- **示例**：配置数据库连接、API 参数等
- **本质**：完整的 Low-Code Form

### 统一方案：复用 Low-Code Form

所有"获取用户输入"都通过 Low-Code Form 实现：
- ✅ 已有完整的前端组件（`app/components/common/low-code-form/`）
- ✅ 支持 8 种基础组件：text、textarea、number、switch、select、combobox、radio、checkbox
- ✅ 支持嵌套路径、验证、默认值
- ⚠️ 第一版不支持：文件上传、动态字段刷新、条件显隐

**不需要新建"审批专用"组件**，直接复用现有基础设施。

---

## 设计方案

### 核心类型定义

```typescript
// 工具定义
type NeuroAgentTool = {
  key: string;
  name: string;
  parameters: TSchema;
  
  // 用户输入请求（可选）
  userInputRequest?: {
    when: (context: UserInputRequestContext) => Promise<UserInputFormSpec | null> | UserInputFormSpec | null;
  };
  
  execute: (
    toolCallId: string,
    args: unknown,
    userInput?: unknown  // 如果有 userInputRequest
  ) => Promise<ToolResult>;
};

// 上下文
type UserInputRequestContext = {
  args: unknown;
  session: { sessionId: number; profileKey: string; workspaceRoot: string; workspaceKey: string; projectPath?: string };
};

// 表单规格
type UserInputFormSpec = {
  form: LowCodeFormDto;     // 复用 Task 58 的结构
  resultSchema?: TSchema;   // 可选，可以自动推导
  prompt?: string;          // 展示提示
  layout?: "dialog" | "inline" | "fullscreen";  // 前端优化提示
};
```

**关键设计点**：
- `when()` 返回 `null` = 直接执行，无需用户输入
- 完全复用 `LowCodeFormDto`，无需新建数据结构
- `execute()` 第三参数接收用户输入

---
