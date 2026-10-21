---
标签: []
别名: ["设置通用列表", "Settings List Section"]
验证入口: SettingsWindow
---

# SettingsListSection

设置窗口里 list 分区的内容（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 输出 2、9–12）：按窗口模型给的分组列出配置项，每项一个 [`SettingsRow`](../../../../ui/settings/SettingsRow.md)，行里放 nb-form 的 [`SchemaField`](../../../../../../nb-form/src/vue/SchemaField.md)（`bare`，id、名字与说明来自行，配置项声明经 `setting-form.ts` 转成表单提示）；改值经窗口模型写当前标签那一层（用户编辑路径），行自己的“恢复默认”等经模型的 `editing` 服务。窗口画分区的标题与说明，这里从第一组开始。

## 布局

自上而下：没有小标题的一组（分区最前）、各小组（小标题加一条分隔线）。每组里的行竖排。控件按表单选出（`widgetLayout`）：多行、竖排单选、复选组、列表、对象与 JSON 用宽排法，其余排在标签右边，下拉 220px、数字框 120px、单行输入 320px，单选组与开关按内容。本作品标签下，分区末尾一行淡色字列出只能在用户设置里改、因此没有列出的项。

## 交互

- 控件改值：表单按提交时机（`commit: "change"`：输入框失焦或回车，其余立即）发出新值，调 `window.write`；结算之前控件显示这次的值（`window.pending`），失败时窗口发通知、这一项的 `revision` 加一，控件丢掉草稿、回到层里的实际值。
- 行的写入失败：交给 `window.rowFailed` 发通知。

## 数据

```ts
import type {SettingsSectionView, SettingsWindow} from "../settings-window";

type Props = {
    /** 窗口模型：当前标签、显示语言、书名、写入与 `editing` 服务。 */
    window: SettingsWindow;
    /** 当前 list 分区的视图（分组与没有列出的项）。 */
    view: Extract<SettingsSectionView, {kind: "list"}>;
};
```

没有 emits、slots、expose；attrs 落在根上。根带 `data-settings-list`（分区 id），每组带 `data-settings-group`（小组 id，分区最前的一组为空），末尾的说明带 `data-settings-excluded`。
