---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: workbench.image-viewer
owners:
  - nbook.image-viewer
---

# 图片查看器

## 目标与非目标

内置插件 `nbook.image-viewer` 向编辑器区贡献一个只看不改的图片编辑器：png、jpg、gif、webp、svg 文件默认用它打开（[workbench.editor](editor.md) 输出 37），能适应窗口、按原尺寸看与缩放，状态栏显示像素尺寸与文件大小。

不承诺：图片编辑与另存；动图的逐帧控制；EXIF 等元数据；PDF、音视频、字体（编辑器区显示“不能在这里打开”）；超大图片的内存占用测量。

## 术语与参与者

- **适应**：整张图放进内容区，图比内容区小时按原尺寸显示（只缩小不放大）。
- **缩放比例**：显示尺寸与像素尺寸之比。

## 输入与前置条件

- 插件只有浏览器入口，激活事件 `onStartup`，依赖编辑器区的贡献点 `editor.editors`。
- 声明：`{title: {"zh-CN": "图片查看器", "en-US": "Image Viewer"}, selector: {extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"]}, priority: "default", input: "bytes"}`，编辑器 id `nbook.image-viewer.image`。
- 控件收到字节绑定 `{address, url, version}`（[workbench.editor](editor.md) 的控件合同）。

## 输出与可观察行为

1. **读取**：控件用 `url` 读取文件字节并显示；读取期间内容区空白，800 毫秒后仍未读完才显示进度（与编辑器区同一规则）。`version` 变了（文件被改写）就重新读取，读完之前继续显示旧图。
2. **失败**：读取失败时内容区写出原因（文件不在、项目已关闭、太大、不是能显示的图片）与“重试”；`version` 再变时自动重试。
3. **SVG**：SVG 按图片显示，里面的脚本不运行、外部引用不加载；要看源码用“用其它编辑器重新打开”选源码编辑器。
4. **适应与原尺寸**：打开时是“适应”。单击图片在“适应”与“100%”之间切换；按住 Ctrl（macOS 上是 Cmd）滚动滚轮缩放，以指针所在位置为中心，比例在 10% 到 1600% 之间；超出内容区时可以拖动或滚动查看。切走再切回保留这个标签的比例与位置。
5. **底色**：图片后面是棋盘格，透明部分可见；明暗两种主题各用一组对比合适的格色。
6. **状态**：控件句柄交出 `status`，例如“1920 × 1080 · 245 KB · 50%”，由编辑器区的编辑器状态条目显示（[workbench.editor](editor.md) 输出 42）。读取失败时为 null。
7. **键盘**：内容区可聚焦；`+`、`-` 缩放，`0` 回到“适应”，`1` 为 100%。

## 状态与转换

| 状态 | 进入 | 离开 |
|---|---|---|
| loading | 绑定交来或 `version` 变化 | 读到并解码为 shown；失败为 failed |
| shown | 解码成功 | `version` 变化时回到 loading（旧图保留到新图解码完） |
| failed | 读取或解码失败 | 重试或 `version` 变化 |

时序与寿命：换绑定、卸载时取消在途读取并释放上一张图的对象 URL；迟到的读取结果不显示。

## 副作用与数据

不写任何文件与记录；缩放比例与位置只在视图状态里，不进会话记录。

## 失败与恢复

| 情形 | 表现 | 用户怎么办 |
|---|---|---|
| 404、410、413 | 内容区写原因 | 重试或关闭 |
| 不是能显示的图片 | 内容区写“无法显示这个图片” | 用源码编辑器打开或关闭 |

## 边界与兼容

公开的只有编辑器 id `nbook.image-viewer.image` 与它的声明；控件不对别的插件提供接口。

## 验收与 Smoke

1. Given 一个 png 与一个带透明部分的 svg，When 单击打开，Then 图片按适应显示、透明处是棋盘格，状态栏有尺寸、大小与比例；When 单击图片，Then 变为 100%，状态栏比例为 100%；When 外部改写 png，Then 显示新图。
2. Given 一个打开着的 png，When 它被删除，Then 标签关闭（资源管理器删除）或按编辑器区的规则标为已删除（其它来源）；When 项目关闭，Then 内容区说明原因。

Smoke：`e2e/editor-types.e2e.ts`（生产构建、本机 Chrome、真实 Files）。

## 证据

- 批准依据：[w00025 t01 的决定](../../../.agents/works/w00025-editor/tasks/t01-requirements/README.md#开发者的决定) 4、5 与 [t02 实施计划](../../../.agents/works/w00025-editor/tasks/t02-editor-types/plan.md) 第 7 节，开发者 2026-10-14 确认。
