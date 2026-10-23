# __DISPLAY_NAME__

NeuroBook 插件 `__ID__`：在侧栏放一个视图，显示设置里的问候语；命令面板里的“__DISPLAY_NAME__：打个招呼”会让视图里的计数加一。

## 三步装进 NeuroBook

1. 装依赖：`npm install`（或 `bun install`）。
2. 构建：`npm run build`，产物在 `dist/`。
3. 安装：NeuroBook 的“设置 → 插件”里点“安装…”，填 `dist` 在服务端机器上的完整路径，确认后重启。

## 改代码之后

`npm run dev` 每次构建出一个新的开发版本号（`0.1.0+dev.<UTC 时间>.<毫秒>`）；在插件页再安装一次 `dist`，按升级处理，重启后生效，不用改版本号，也不用先卸载。

类型检查：`npm run typecheck`。

## 目录

| 文件 | 内容 |
|---|---|
| `plugin.ts` | 插件描述：id、版本、运行位置、设置项与设置分区 |
| `shared/contracts.ts` | 插件 id 与设置项 |
| `web/plugin.ts` | 浏览器入口：视图与命令 |
| `web/HelloView.vue` | 视图组件 |

怎样写入口、画界面、调试与发布，见 SDK 包里的 README（`node_modules/@notnotype/nb-plugin-sdk/README.md`）。
