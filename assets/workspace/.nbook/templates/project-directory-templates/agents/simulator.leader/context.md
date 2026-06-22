---
profile: simulator.leader
version: 1
updatedAt: null
updatedBy: system
mustRead: []
candidates: []
---

# Simulator Leader Project Context

本文件只记录当前 Project 对 `simulator.leader` 的补充上下文、优先读取路径和接手说明。通用 simulation 合同由 builtin profile 与 `reference/content/simulation.md` 承担，不在这里复制。

## Reading Hints

- 开始或继续 simulation / RP 时，优先检查 `simulation/runs/current.md`。
- 根据 `simulation/runs/current.md` 的 active subjects，读取相关 `simulation/subjects/{id}/subject.md`、`state.md`、`events.jsonl`、`memory.jsonl` 与 `mind.md`。
- 需要真实实例状态时，再读取相关 `simulation/entities/{id}/entity.md` 与 `state.md`。
- 需要稳定设定时，只读取与本轮目标相关的 `lorebook/` 条目；不要把完整 god-view lorebook 复制给 actor 或 writer。
- 需要作品边界、开局素材或初始化说明时，可检查 `lorebook/instruction/creation-boundaries/`、`lorebook/note/project-profile/`、`lorebook/note/story-concept/` 与 `lorebook/note/opening-seed/`。

## Project Decisions

- 暂无。将本项目已经确认的 simulation 约定、active subject 策略、开局特殊规则或长期运行偏好写在这里。

## Information Boundaries

- actor-facing context 只包含角色在故事内合理可感知、已知或可推断的信息。
- writer brief 只包含用户可见正文允许使用的信息，不包含后台裁决、隐藏真相或其他 subject 私密内容。
- `state.md` 与 `simulation/entities/` 由 simulator leader 裁决后维护；actor 可以提供候选反应，但不自行决定真实世界状态。

## Open Questions

- 暂无。
