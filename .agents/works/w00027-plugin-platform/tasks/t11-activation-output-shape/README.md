---
schema: nbook.task/v2
taskId: t11-activation-output-shape
status: planned
updated: 2026-10-24
---

# 内核核对入口激活产出的形状

## 目标与范围

入口的 activate 返回 undefined 或别的非对象时，内核在读产出的地方抛 TypeError，测试等到超时才失败、看不出原因（t05 场景 07 踩到）。改为激活后核对产出形状，不对时这一代按 activation-threw 失败，诊断写明“产出不是对象”，并在 plugins Spec 与 nb-runtime 测试里补上。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-10-24 经 nbdev 新建，尚未开工。

## 下一步

待补充。
