# 设置界面现状与参照

t06 设计评审的第一步（design-review “现状与参照”），2026-10-21。现状截图取自 Work 分支 `feat/w00027-plugin-platform`（t02 合入后）的 Component Lab，`SettingsWindow` 全部 19 个场景，画布 1200×800 与 Lab 自适应两种；截图在本地 `.local/agent/works/w00027-plugin-platform/tasks/t06-settings-ui-polish/shots/current-wide/` 与 `shots/current/`，t02 的交互流程截图在 `t02-settings-completion/reports/impl-shots/flows/`。

参照：w00017 t80 的评审板 [r1–r4](../../../w00017-application-runtime-architecture/tasks/t80-settings-ui/artifacts/review/index.html)（已定的 12 条见 [t80 README](../../../w00017-application-runtime-architecture/tasks/t80-settings-ui/README.md#设计决定)）；t02 的说明页 [settings-sections](../t02-settings-completion/artifacts/settings-sections/index.html)，只讲两种分区的画法，不是外观稿。

## 与 t80 定稿一致的

- 浮动窗口、缺省 960×640，左栏分区、右边一次一个分区；顶部“用户 | 本作品”。
- 每项标签列加控件列，宽控件（列表、多行）另起一行占满内容列（t80 第 11 条“混合”）。
- 已修改的竖线在行的左边，“恢复默认”紧跟控件；本作品覆盖的提示在控件下面一行。
- page 分区的标题与说明由窗口画。

## 与 t80 定稿不同的，或 t80 之后新增、没有经过设计的

| 位置 | 现在 | 来源 |
|---|---|---|
| 三项以内的选项 | 横排单选组（圆钮），t80 稿是分段控件 | t07 S5 按 `ui-development-spec.md` 4.5 改，外观交给 t06 |
| 左栏顶部 | 搜索框，与分区列表同宽；搜索时右边换成“搜索结果” | t02 S4，没有出稿 |
| 左栏底部 | 固定一项“设置文件” | t02 S5，没有出稿 |
| 左栏选中项 | 底色加 2px 焦点环同时出现（键盘焦点留在选中项上时），比 t80 稿的浅底色重 | 实现 |
| 设置文件视图 | 灰底等宽文本框占满内容列，上方一行“设置文件（用户）”加“保存”“放弃改动” | t02 S5，开发者定不做语法高亮 |
| 放弃改动的确认框 | nb-ui AlertDialog，“继续编辑”“放弃” | t02 S4 |
| page 分区“模型服务”（Lab 样板） | 上面两行即时写入的配置项；下面“保存”“放弃改动”靠右悬在分隔线上、离服务商列表远；列表与详情是 nb-form 的左列表右详情，详情是带边框的卡片，随整页滚动 | t02 S7 |
| 动态选项的加载中、不可用、“已不存在” | 下拉里显示“（已不存在）”，下面一行“警告：已不存在” | t02 S3，nb-form 的通用写法 |
| 窄窗口（600px 以下） | 左栏变成横排的一行分区，搜索框在上面整行 | 实现 |

## 已记下要在 t06 一并收口的

见 [README](README.md#下一步)：只读与可编辑看不出差别；单行输入定宽 320 导致同一分区里两种对齐混在一起，“恢复默认”在窄宽度单独一行；“模型服务”列表与详情不能各自滚动；fill 与 column 两份分区标题模板。

## 看图时另发现的

- 分区标题（“外观”18px 粗体）与小组标题（“界面”12px 粗体）之间差距大、小组标题下面的分隔线与分区标题之间没有分隔，读起来分区说明和第一个小组挤在一起。
- “其它”分区按插件分组时，小组标题是插件 id（`example.notes`），不是给用户看的名字。
- 下拉在“已不存在”时控件里与下面各写一次“已不存在”。
- 数字框的上下箭头占了控件三分之一宽。
