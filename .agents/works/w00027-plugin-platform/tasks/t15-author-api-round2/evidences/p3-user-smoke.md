# 0.11.0 发布后的真实用户冒烟（2026-10-27）

环境：本机，临时的 `HOME`、`BUN_INSTALL`、`TMPDIR`（模拟只装了 Bun 的新机器），Bun 1.4.2，从 npm registry 安装。照根 README 与应用包 README 走，界面操作用 Playwright 驱动本机 Chrome（1440×900），每步截图（本地 `.local/agent/works/w00027-plugin-platform/tasks/t15-author-api-round2/shots/user-smoke/`）。

发布本身：`@notnotype/nb-plugin-sdk@0.11.0`、`@notnotype/neuro-book@0.11.0` 发到 npm（`latest`）；`release:smoke --from registry` 全部通过。

## 走通的

- `bun add -g @notnotype/neuro-book` 5 秒；`nbook --version`、`--help`、`plugin --help` 正常。
- `nbook --no-open`：打印地址与状态根；状态根落在 `~/.local/share/neuro-book`；第二次运行报告已在运行的实例（pid、地址）；Ctrl-C 有序停止。
- 书架：空书架的引导清楚；新建作品对话框（书名、简介、封面、主题色、保存位置）；作品卡片、统计、“继续写作《雾港》”、“最近写到”在重启后都在。
- 作品：欢迎页“新建章节”，Markdown 编辑器输入中文正文与标点，未保存标记，Ctrl+S 写盘内容正确，状态栏字数。
- 作者：`bunx -p @notnotype/nb-plugin-sdk nbooke create my-plugin` 13 秒（首次下载约 230 个包），`bun install` 5 秒，`bun run build`、`bun run typecheck` 通过；`nbook plugin install dist` 打印信任说明，`plugin list` 标“重启后安装”；重启后活动栏出现插件的视图、命令面板搜得到插件命令、设置左栏“扩展”下有它，插件页列出它。
- 服务端日志：206 条 info、3 条 warn（停止时的 receiver-closed），没有 error。
- npm 页面：README 的字标与看板娘用 GitHub 绝对地址，均返回 200。

## 缺陷

1. ~~重启后工作台不恢复~~（撤回）：冒烟脚本每步新开一个干净的浏览器配置，等于每次换一个客户端，而“最近打开”与编辑器会话是 `project/local` 记录、按客户端身份分开（`docs/specs/storage/persistence.md` 术语与输出 7）。用同一个浏览器配置重做“写一章 → 重启 nbook → 再打开”，标签恢复。换浏览器或无痕窗口看不到是设计如此。
2. **从书架进作品时控制台报 error**：整页切换时旧页面卸载，打出 error“工作台外壳加载失败：nbook.workbench 的 store workbench-layout 已开始停止，不再接受 acceptViewCatalog”和十几条 `revoke …：receiver-closed` warn。是正常操作，不该是 error 级，会干扰排障。
3. **作者构建每次打印 rolldown 的 `[PLUGIN_TIMINGS]` 警告**（带原始 ANSI 码，“JavaScript callbacks ran for 2.9s…”）：SDK 的构建预设没有像 `plugin-sdk/pack.ts` 那样关掉 `checks.pluginTimings`。
4. **`nbook --help` 的说明列没对齐**：commander 按字符数算宽度，中文占两格。
5. （发布时发现，不来自冒烟）**nb-story 的 typecheck 在 master 上坏了**：w00024 t31（`499de9d41`）在 `src/web/host/relations-view.ts` 里从 `.vue` 文件导入类型，纯 `tsc` 那一步找不到声明。新 CI 会因它变红。

## 可改进

1. 新建作品后停在书架；新用户多半想马上写，可以直接打开新作品。
2. 新作品是空目录。“新建章节”直接生成 `新章节.md`：不问名字、不进入改名，光标不在编辑器里，空页面没有占位提示。
3. 中文书名的作品短名是 `project`、`project-2`：地址（`?project=project-2`）与日志目录看不出是哪本书。
4. 装插件后要回终端 Ctrl-C 再 `nbook`；插件页与 `nbook plugin install` 之后可以提供“重启服务”，长远是热插拔（`runtime/plugin-hot-plug.md`，planned）。
5. Ctrl-C 停止时终端没有“已停止”一类的提示，看不出是正常退出。
6. 插件页的内置插件只显示 id（`nbook.commands`），没有名称与说明。
7. npm 元数据：两个包都没有 `keywords`、`homepage`、`bugs`；应用包的 description 是英文且写着“rebuilt on the plugin runtime”，SDK 是中文；应用包 README 第一句提“Agent 会话”，v2 还没有 Agent。
8. 没有“文档”目录的系统上，作品目录落在 `~/NeuroBook`，README 只写了“文档目录下的 NeuroBook”。
9. `bun publish <tarball>` 时 Bun 打印 `warn: bin '…' does not exist`（按当前目录找 bin），无害，但发布日志里会让人担心。
