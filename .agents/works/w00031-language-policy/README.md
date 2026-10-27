---
schema: nbook.work/v1
workId: w00031-language-policy
issueId: null
status: active
updated: 2026-10-27
---

# 语言政策与错误处理

## 目标

定下界面文字、开发诊断与给模型的文字各用什么语言（ADR），并按错误域把失败说明改成按错误码本地化、开发诊断改英文。界面文字的目录机制本身在 [w00028](../w00028-i18n/README.md) 做。

## 开发者已确认的决定

都是 2026-10-27 与开发者讨论时确认的；讨论稿与三轮审查见 [t01 证据](tasks/t01-adr/evidences/)。

1. 文字按读者分三类：界面文字与给用户看的失败说明要本地化；开发诊断（异常 message、诊断事件 message、日志、堆栈）用英文，不做 i18n；第三方库的错原样保留。程序只按错误码分支，错误码、事件名、字段名是英文标识符。
2. 界面按错误码取失败说明，`error.message`、`reason` 只放进“详情”。各错误域保留自己的合同（跨进程帧、`RemoteCallError`、`DiagnosticsError`、命令失败结果），不统一成一个形状；跨进程只传码、结构化参数与安全 detail，服务端不产生界面文字。
3. 领域提示词用中文，并跟着作品语言走（界面语言、作品语言、回复语言是三条独立的轴）。基础设施提示词：新写的用中文；现有的英文说明（含命令 `description`）先不动，等 [t05](tasks/t05-prompt-language-eval/README.md) 的对照评测（已搁置）。OMP 原生工具（`read`、`edit`）的错误文本原样保留英文。
4. 界面文字用按插件、按包分的消息目录，不用 vue-i18n；用 i18next 的原生格式（`{{name}}`、`_one`/`_other`），需要 ICU 时再加插件。细节在 w00028。
5. 先做错误处理的只读审查，开发诊断改英文排在失败投影设计之后。
6. 语言政策写成一份新 ADR，取代 ADR 0023 中“前端使用 vue-i18n”一项，0023 正文不改；`common.md` 加“语言”一节。

## 任务

| Task | 范围 |
|---|---|
| [t01](tasks/t01-adr/README.md) | 语言政策 ADR、ADR README 的部分取代写法、`common.md` 的“语言”一节、影响清单 |
| [t02](tasks/t02-error-audit/README.md) | 错误处理只读审查，产出通道矩阵 |
| [t03](tasks/t03-failure-projection/README.md) | 失败投影与切片设计 |
| [t04](tasks/t04-migration/README.md) | 按 t03 的切片迁移（暂不开工） |
| [t05](tasks/t05-prompt-language-eval/README.md) | 中英文提示词对照评测（已搁置） |

## 待确认

自主推进中照推荐做的决定记在 [pending-confirmations.md](pending-confirmations.md)，等开发者追认。

## 授权与限制

- `issueId: null`；远端写入、npm 发布逐次授权。
- 排除清单（不迁移产品文案）：`neuro-book-legacy`、`neuro-agent-harness`、`neuro-book-contracts`、`llmlint`、`neuro-book-test-support`；其余包按通道审查，不整包跳过。
