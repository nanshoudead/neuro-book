---
name: anti-ai-slop
description: 识别和修复中文文本中的 AI 写作痕迹（八股文风格），包含 CLI 静态检查和 LLM 深度审查
when_to_use:
  - 用户请求润色文本、去除 AI 味道、优化写作风格
  - 用户提供文本说"这看起来很 AI"
  - 用户要求检查文本的自然度
metadata:
  author: NeuroBook Team
  version: 1.0.0
---

# 文本润色

## 工作流程

### 步骤 1：获取输入文本

用户可以通过两种方式提供文本：

**方式 A：提供文件路径**
- 用户："帮我检查 manuscript/chapter-01.md 的 AI 味道"
- 直接使用该文件路径

**方式 B：直接粘贴文本**
- 用户粘贴一段文本
- 写入临时文件：`write(".agent/polish-input.md", 文本内容)`
- 使用 `.agent/polish-input.md`

### 步骤 2：CLI 静态检查

执行 CLI 检查工具：

```bash
bun assets/workspace/.nbook/agent/skills/anti-ai-slop/cli/checker.ts check <文件路径>
```

CLI 会输出类似 eslint 的格式化报告，按规则分组展示问题：
- 每个问题包含：行号、列号、命中上下文、命中位置指示
- 每条规则附带通用修复建议

### 步骤 3：LLM 深度审查

LLM 深度审查包含两个连续动作：先获取本轮 LLM 规则，再完成逐条审查。不要把两者拆成两个步骤。

先执行：

```bash
bun assets/workspace/.nbook/agent/skills/anti-ai-slop/cli/checker.ts show-llm-rules
```

将输出作为本轮全文语义审查的规则来源。如果输出显示当前没有启用 LLM 规则，则跳过“LLM rule 全文审查”，只复核 CLI 静态命中项。

根据 CLI 输出和 LLM 规则标准，对每个问题进行判断：

**判断原则**：
- **检测结果不一定要修复**：根据实际语境判断
- **考虑文本类型**：对话、口语化场景可能需要保留某些"AI 味道"
- **尊重作者意图**：如果是刻意的风格选择，应该保留

**Static Rules 处理**：

1. **High 级别**：强烈建议修复，但仍需读取上下文确认；如果是技术文档的步骤说明，可能应该保留
2. **Medium 级别**：读取原文上下文（前后 2-3 行），判断是否真的需要修复；如"其实"在对话中可能是自然口语
3. **Low 级别**：建议保留，除非明显影响阅读

**LLM Rules 全文审查**：

1. 对 `show-llm-rules` 输出的每条规则逐条审查原文
2. 不要等待 CLI 提供 LLM rule 命中项；LLM rule 需要 Agent 主动阅读全文寻找候选
3. 每条规则都要给出结果：未发现候选、建议修复、建议保留、需要用户确认
4. 对候选文本读取上下文（前后各 5 行，或整个段落），根据规则的判断标准和示例判断
5. 如遇到专有名词/科幻设定/同人梗：
     ```
     invoke_agent("researcher", query: "...")
     ```
     根据调研结果辅助判断

### 步骤 4：生成修复计划（用户审批）

生成修复计划文档：`.agent/polish-plan.md`

内容包括：
- **统计**：强烈建议修复多少项、建议修复多少项、保留多少项、不确定多少项
- **修复详情**：每条修改的原文、修改后、理由
- **不确定项**：需要用户确认的问题，附带建议和疑问


### 步骤 5：执行修复

### 步骤 6：生成修复报告

生成最终报告

内容包括：
- **统计**：总问题数、已修复、保留不改、修复类别分布
- **修复详情**：每条修改的 diff（- 原文 / + 修改）
- **未修复项**：保留的问题及原因
- **输出文件位置**

展示给用户：
- 简要统计数字
- 输出文件位置
- 可选：展示几个关键修复的 diff 示例

## CLI 工具使用说明

**检查文件**：
```bash
bun assets/workspace/.nbook/agent/skills/anti-ai-slop/cli/checker.ts check <file>
```

**显示 LLM 规则**：
```bash
bun assets/workspace/.nbook/agent/skills/anti-ai-slop/cli/checker.ts show-llm-rules
```

**兼容旧用法**（不推荐）：
```bash
bun assets/workspace/.nbook/agent/skills/anti-ai-slop/cli/checker.ts <file>
```

退出码：
- `0`：未发现问题或只有 low/medium 级别
- `1`：发现 high 级别的问题

## 注意事项

1. **临时文件管理**：所有临时文件统一放在 `.agent/` 目录
2. **错误处理**：CLI 工具失败时，检查文件路径和 bun 环境
3. **编码问题**：确保文件是 UTF-8 编码
4. **行号偏移**：修改时从后往前进行，避免前面的修改影响后面的行号
5. **不确定项处理**：遇到拿不准的问题，优先标记为需要用户确认，不要强行修复


## 参考文档

- [CLI 详细使用说明](references/cli-usage.md)
- [中文 AI 味道模式库](references/patterns.md)
- [完整流程详解](references/workflow.md)
