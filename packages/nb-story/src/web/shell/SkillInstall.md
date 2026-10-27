---
标签: [io:mutate]
---

# 安装 Skill

设置页里的一节（docs/specs/story/viewer.md 输出 54）：两行，Claude Code（`~/.claude/skills/nbstory`）与 Codex（`~/.agents/skills/nbstory`），各一个“安装 / 更新”按钮。

## 布局

标题与一行说明；两行带边框的卡片：左边是名字与目标位置，右边是按钮；按钮下一行写结果（绿字成功，红字失败）。目标已有内容不同的目录时，结果写明原因并出现“换成随包的内容”按钮，点了才强制替换。

## 状态与副作用

`io:mutate`：调服务的 `skill.install`，会写用户目录下的 Skill 目录。理由：这是这一节唯一的动作。网页只能选这两个固定位置，不能指定别的目录（命令行的 `--dir` 不给网页）；已存在且内容相同时不改（`unchanged`）。

## 验证入口

设置页（`e2e/viewer.e2e.ts`：点安装得到已安装，再点得到没有改动）。
