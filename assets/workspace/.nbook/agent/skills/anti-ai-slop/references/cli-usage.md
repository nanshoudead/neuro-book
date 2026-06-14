# CLI 工具使用说明

## 基本用法

检查文件中的 static 规则命中项：

```bash
bun .nbook/agent/skills/anti-ai-slop/cli/checker.ts check <文件路径>
```

显示需要 Agent 主动全文审查的 LLM 规则：

```bash
bun .nbook/agent/skills/anti-ai-slop/cli/checker.ts show-llm-rules
```

兼容旧用法：

```bash
bun .nbook/agent/skills/anti-ai-slop/cli/checker.ts <文件路径>
```

## check 输出格式

`check` 只运行 static rules。Static rule 表示“候选文本可以被稳定识别”，不表示一定要修复。

输出按规则分组：

```text
manuscript/chapter-01.md

filler-word-actually (其实、实际上、事实上)
  1:9  这个问题很复杂。其实我们可以从另一个角度来看。
                 ^^

  1 occurrence. 修复建议：这类填充词通常不增加实质内容，建议直接删除。

not-but-structure (不是...而是...)
  7:10  不是因为天气不好，而是因为路况复杂。
         ^^^^^^^^^^^

  1 occurrence. 修复建议：读取上下文判断前半部分是否在纠正真实误解。

✖ 2 problems (2 medium)
```

每个问题包含：
- 行号和列号
- 命中文本附近的上下文
- 命中位置指示
- 规则级别统计
- 规则修复建议

## show-llm-rules 输出格式

`show-llm-rules` 输出纯文本，不使用 Markdown 标题格式。它用于告诉 Agent 本轮还要额外进行哪些全文语义审查。

示例：

```text
LLM 判断规则

说明：以下规则需要 Agent 根据上下文主动审查，不由 CLI 静态扫描命中。

规则 1: hollow-summary-paragraph - 空泛总结段

级别: medium

描述: 段落用抽象价值判断收束，却没有提供新的具体信息

原因: 空泛总结通常没有稳定关键词，必须结合前后文判断它是否推进了信息、情绪、论点或场景

判断标准:

...

判断示例:

...
```

如果没有启用 LLM 规则，会输出：

```text
当前没有启用需要全文语义审查的 LLM 规则。
```

## Static Rules 与 LLM Rules

Static rules 负责定位候选文本，例如：
- 填充词：其实、实际上、事实上
- 机械过渡：首先...其次...最后...
- 二元对比：不是...而是...
- 问题定义对比：问题/答案/关键不是...是...
- 公式化设问：为什么这么说、这意味着什么、试想一下
- 强调拐杖：毫无疑问、显而易见、说到底、归根结底
- 元叙述公告：下面将介绍、接下来将、本文将从
- 商务黑话：赋能、抓手、闭环、拉通、落地等候选词
- 懒惰绝对词：所有人、永远、一定、毫无例外等候选词

LLM rules 负责无法靠固定正则稳定定位的问题，例如：
- 空泛总结段
- 语体错位
- 节奏单调
- 过度解释
- 缺少具体信息
- 隐藏行动者
- 金句感
- 段尾机械升华

二元对比、公式化设问、商务黑话等虽然可以被 static rule 定位，但修复决策仍需要上下文判断。不要因为 CLI 命中就自动修改。

## 退出码

- `0`：未发现问题，或只有 low/medium 级别问题
- `1`：发现 high 级别问题，或 CLI 执行失败

在 Agent 工作流程中，退出码 `1` 不一定代表命令失败；需要结合 stderr 和输出内容判断。

## 在 Agent 中使用

标准流程：

1. 执行 `check <file>`，获取 static 规则命中项。
2. 执行 `show-llm-rules`，获取需要主动全文审查的 LLM 规则。
3. 复核 static 命中项，读取上下文后判断修复、保留或需要用户确认。
4. 对每条 LLM rule 主动审查全文；没有候选也要在计划中说明“未发现明显问题”。
5. 执行快速审查清单，并给出 Directness / Rhythm / Trust / Authenticity / Density 五维评分。
6. 用面向用户的 Markdown 生成审查结论和修复计划，不要输出 JSON、YAML 或 TypeScript interface。

## 常见问题

### 为什么“不是...而是...”不是 LLM rule？

因为它可以被正则稳定识别。它确实需要上下文判断是否修复，但这是“修复决策”需要 LLM，不是“候选定位”需要 LLM。

### 为什么 CLI 没有输出 50 分评分？

评分依赖全文语气、语境、节奏和作者意图，由 Agent 在步骤 3 完成。CLI 只负责确定性候选定位。

### CLI 工具可以自动修复吗？

第一版不支持自动修复。修复由 Agent 根据上下文判断和用户审批后执行。

### 如何添加自定义规则？

编辑 `cli/rules/` 下的 JSON 文件：
- `static-rules.json`：添加可以稳定定位候选文本的规则。
- `llm-rules.json`：添加需要 Agent 主动阅读全文审查的语义规则。

### CLI 工具支持哪些文件格式？

任何 UTF-8 编码的文本文件。通常用于 Markdown 和纯文本文件。
