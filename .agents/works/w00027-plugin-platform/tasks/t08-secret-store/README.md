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

2026-10-20 搁置。[计划](plan.md)起草后经 omp 设计审查（[evidences/design-review-omp.txt](evidences/design-review-omp.txt)，15 条）修订，计划越改越重：加密、主密钥、系统密钥库的子进程与原生模块交付、四种存储状态与重置事务。调研（[evidences/credential-storage-research.md](evidences/credential-storage-research.md)）显示命令行 Agent 工具在 Linux 上普遍用 0600 明文文件。开发者 2026-10-20 决定：暂时没有加密的需求，凭据先不做，API Key 用明文的普通配置项；`secret: true` 维持登记时被拒。

## 下一步

需要时重开。届时的起点：按插件隔离的键值密钥库（同 VS Code `SecretStorage`），声明式密钥项是它上面一层、动态服务商自己拼键；先做 0600 文件后端加可替换的后端接口，加密与系统密钥库以后再接。本计划的审查结论（重置事务、快照顺序、子进程寿命、写入校验等）到时按需取用。
