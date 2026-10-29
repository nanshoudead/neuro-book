# 待确认清单

自主推进中照推荐做、等开发者追认的决定（`.agents/skills/autonomous-delivery/SKILL.md` 的“待确认清单”）。

| 日期 | Task | 类别 | 决定 | 理由 | 改回的代价 | 结果 |
|---|---|---|---|---|---|---|
| 2026-10-27 | t01 | 产品取舍 | “现有的英文说明先不动”解读为：契约已规定为英文的字段（命令 `description`）连新写的也保持英文，等 t05；其它新写的基础设施提示词（新工具说明、新提醒）用中文 | 维护同一合同字段的一致性（工程取舍，没有对照证据） | 实现前只改 ADR 0034 决策 4 的一句；若已按此写了新命令，改判后要另改命令合同与工具快照兼容 | 待追认 |
| 2026-10-27 | w00028 t01 | 推进顺序之内的调整 | 把“失败详情组件与常驻通知”从 w00028 t01 拆成 w00028 t04 | 拉远看审查：它是 UI 组件决策，与目录机制无关；放在一起会让 i18n 提案变大 | 并回 t01 即可，没有已实施的代码 | 待追认 |
| 2026-10-27 | w00028 t03 | 偏离已接受的提案 | `nbook.settings/locale` 用共享常量生成枚举，不改成字符串加运行期校验 | 设置系统只按声明的 JSON schema 校验，没有额外的值校验入口（t03 计划审查 omp 第 7 条）；枚举可序列化、效果相同 | 改回要新增一个值校验入口，三端都接 | 待追认 |
| 2026-10-27 | w00028 t03 | 新增依赖 | `packages/neuro-book` 加 `i18next@26.5.11`（精确版本） | ADR 0034 决策 3 与已接受的提案定了 i18next；t02 原型在这个版本上验证过 | 移除依赖并回到最小实现，宿主失去复数规则的完整支持 | 待追认 |
| 2026-10-28 | w00028 t03 第 5 片 | 实现取舍 | 内置目录经 src/web/plugins.ts 的 builtinPluginCatalogs 表登记，不在 PluginDefinition 加字段；SDK 有目录时禁止再写 displayName/description，locales/ 里有非 json 文件即构建失败；语言标签校验 nb-runtime 与 nb-ui 各一份；窗口取目录无独立超时 | 依赖方向（plugin-platform 不能依赖 nb-ui）与最小改动面；都按子代理推荐 | 改为 PluginDefinition.l10n 字段需动内核类型；其余是放宽校验，代价小 | 待追认；见 w00028 t03 evidences/slice-5-report.txt |
| 2026-10-28 | w00028 t03 第 6 片 | 实现取舍 | 只给必填的文字字段补约定键（title），description/placeholder/keywords/category 省略即无；缺目录键不在登记时拒绝，由声明测试与窗口缺键诊断报；新增 SettingsService.declaration()；目录检查脚本与 nb-runtime 的 catalogProblems 各一份格式规则 | 最小面与依赖方向（仓库根未声明 nb-runtime 依赖） | 补全可选字段的键是追加；合并两份规则需给根加依赖 | 待追认；见 w00028 t03 evidences/slice-6-report.txt |
| 2026-10-29 | w00028 t03 SDK 片 | 偏离已接受的提案 | SDK 不做“激活适配层绑定插件的 `text()`”，保留 `pluginText<Source>(PLUGIN_ID)` 并移到 `/text` 子路径；浏览器入口 `/text/browser` 导出 `useText`、`usePluginText`、`TextPort` | `pluginText` 写错键编译不过，且在服务端会执行的声明里也能用；提案第 209 行附近仍写 `text()` | 改成激活绑定需给 AuthorActivationContext 加方法并失去键类型检查；提案文字需改 | 待追认；见 w00028 t03 evidences/slice-13-sdk-report.txt |
| 2026-10-29 | w00028 t03 SDK 片 | 实现取舍 | `scripts/ci/message-catalogs.ts` 在作者 package.json 未写 locales 时按 `locales/` 目录检查（原要求 `l10n` 必写 locales，与构建预设矛盾）；示例工作台替身改用产品的贡献点定义 | 消除脚本与构建预设的矛盾；替身与真实工作台一致 | 改回要同时改构建预设 | 待追认 |
| 2026-10-29 | w00028 t03 追加片（workbench 运行期文字） | 产品取舍 | 英文术语统一：右栏统一 “Secondary Side Bar”，“Move To”改 “Move to”，“Merge 1 views”改复数键；侧栏仍写 “Sidebar”（VS Code 为 “Primary Side Bar”） | 同一对象在不同处用两种叫法；按 VS Code 术语统一 | 改回只是改目录文字 | 待追认；见 evidences/slice-14-workbench-report.txt |
| 2026-10-29 | w00028 t03 追加片（workbench 运行期文字） | 偏离已接受的提案 | `CommandResult.reason` 放宽为 `Text`；远程合同 `nbook.commands/remote` 不升版，窗口一侧按当前语言把原因翻成字符串再交出 | 服务端没有窗口目录，翻不了文字引用；升 v3 要改调用方 | 以后要服务端自己翻译需升到 v3 | 待追认 |
| 2026-10-29 | w00028 t03 收尾片 | 实现取舍 | `locale` 属性：盘点后一个都不删（`PluginsPage.locale` 牵动 Lab 16 个场景、`EditorControlProps.locale` 与 nb-form 控件合同是公开合同）；18 个无 `.md` 的组件不补文档，机检只管有 `.md` 的；设置界面中文句里夹英文诊断原因不另做目录键 | 删除需改公开合同或 Lab 输入集；补文档与目录键超出本 Task | 之后单独开片；合同改动要升 Spec | 待追认；见 evidences/slice-16-cleanup-report.txt |
