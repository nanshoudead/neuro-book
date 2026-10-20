---
schema: nbook.task/v2
taskId: t15-fs-order-tests
status: active
updated: 2026-10-20
---

# 文件测试不依赖目录列表顺序

## 目标与范围

entry-ops 与 changes 两个测试默认了 readdir 的返回顺序，/tmp 换到 btrfs 后失败；另查 changes 的静止重读一例在负载下超时

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-10-20 经 nbdev 新建，尚未开工。

## 下一步

待补充。
