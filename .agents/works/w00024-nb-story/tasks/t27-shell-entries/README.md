---
schema: nbook.task/v2
taskId: t27-shell-entries
status: active
updated: 2026-10-27
---

# 明暗切换与设置入口

## 目标与范围

[t21](../t21-usage-feedback/README.md) 反馈 4 的第三条，行为合同：[`story.viewer`](../../../../docs/specs/story/viewer.md)。开发者在评审板第 5 题选了 A：

- 书架页、设置页（以及同类的导入页、抽取进度页）顶部加明暗切换，与书页是同一个控件、同一份偏好；
- 书页左侧导航底部加“设置”入口（窄屏的“更多”导航里也有），点开是现在的设置页，返回回到原来的位置。

不在本 Task：网页补“导入 V9 记忆图文件”“安装 Skill”两个命令行独有的功能——它们要新增服务端方法、合同与权限判断（Skill 安装会写用户目录），单列为 t29（连同逐条核对命令行与网页的对应）。

## 当前状态

2026-10-27 开工，分支 `feat/w00024-t27-shell-entries`（worktree `.worktree/w00024-t27`）。设计已由开发者定，不另写 plan.md；设计审查并入实现审查。
