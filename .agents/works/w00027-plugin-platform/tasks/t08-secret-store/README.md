---
schema: nbook.task/v2
taskId: t08-secret-store
status: shelved
updated: 2026-10-20
---

# 密钥存储

## 目标与范围

设置的密钥项加密存在状态根，主密钥放系统密钥库或本人可读的文件；独立的密钥服务与远程合同，主密钥丢失时显式重置

合同：新 Spec `docs/specs/settings/secrets.md`（`settings.secrets`，本 Task 的 S0 写）；[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md) 输出 20 链接它。

来源：从 [t02](../t02-settings-completion/plan.md) 的密钥部分拆出（开发者 2026-10-20 同意的可维护性修订）：独立的服务 `secretsKey` 与远程合同 `nbook.settings/secrets`，只有一把主密钥、丢失时显式重置，访问密钥库的子进程脚本是单独的构建产物。

## 当前状态

2026-10-20 经 nbdev 新建，[计划](plan.md)已起草、待开发者确认与设计审查；排在 t02 S1 之后（要 `secret` 声明），t02 S3 在它之后接设置窗口。

## 下一步

计划确认后按 S0–S3 实施；S1 第一步验证原生模块能否打进产物。
