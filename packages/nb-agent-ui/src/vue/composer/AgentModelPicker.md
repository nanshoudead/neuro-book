---
标签: [env:portal, state:inject]
别名: ["模型选择", "思考档位", "Model Picker"]
---

# AgentModelPicker

输入框工具栏里的一个下拉：选模型，也选思考档位。两样合在一个触发器上，窄屏的工具栏不至于放不下；触发器写出当前模型名和档位，例如“Claude Sonnet · 低”。它是受控零件，选中后只发出事件，由输入框转成 `model.set`、`thinking.set`。

## 布局与交互

- 触发器：芯片图标、模型名（过长截断，最宽约 12em）、淡色的“· 档位”与展开箭头，高度与工具栏的图标按钮一致。没有可选模型时显示“未选择模型”。
- 菜单：先列模型，单选，带勾；不支持图片的模型右侧有一个划掉的图片图标，悬停说明“不支持图片”。分隔线下是一项“思考 · 低”，悬停或点击在旁边展开档位子菜单，单选。没有档位时没有这一项。
- 选中当前项也会发出事件，是否忽略由调用方决定。
- 档位的显示名沿用旧输入框：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` 依次为“关闭”“极低”“低”“中”“高”“极高”“最大”；其他取值原样显示。
- `disabled` 时触发器不可点。

## 数据

```ts
interface AgentModelPickerProps {
    /** 必填。 */
    models: ReadonlyArray<{key: string; label: string; supportsImages: boolean}>;
    /** 必填，受控。 */
    modelKey: string | null;
    /** 必填；为空数组时不显示档位一组。 */
    thinkingLevels: readonly string[];
    /** 必填，受控。 */
    thinking: string | null;
    /** 默认 false。 */
    disabled?: boolean;
}

interface AgentModelPickerEmits {
    (e: "select-model", modelKey: string): void;
    (e: "select-thinking", level: string): void;
}
```

没有插槽与 expose。未声明的 attribute 落到触发器上。

## 隐藏通道理由

- `env:portal`：菜单使用 nb-ui `Dropdown`，浮层渲染到 `body`，不被输入框所在的滚动容器裁剪。
