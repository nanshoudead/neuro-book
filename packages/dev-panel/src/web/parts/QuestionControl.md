---
标签: []
---

# QuestionControl

一道题的作答控件（t15 阶段 4 第 1 批，从 `AnswerForm` 抽出来）：单选题是单选组，多选题是复选组，确认题是“同意 / 不同意”两项的单选组，文字题是多行文本框。推荐的选项在选项名后面写“（推荐）”。`AnswerForm` 里待答的题、已答的题点“改答”之后都用它。

## 数据

```ts
interface QuestionControlProps {
    /** 题的定义（最新一版题表里的这道题）；必填 */
    question: VersionQuestion;
    /** 现在的取值：单选、文字是字符串，多选是字符串数组，确认是布尔值，没填是 undefined；必填 */
    modelValue: unknown;
}
interface QuestionControlEmits {
    /** 开发者改了取值；确认题发布尔值 */
    (event: "update:modelValue", value: unknown): void;
}
```

没有插槽与 expose。只读与禁用由外面的 `fieldset disabled` 统一管，零件不另设。取值的校验在 `AnswerForm`（核心的 `validateAnswerValue`）。

## 注意事项

复选组的选项里有一个 `sr-only`（绝对定位）的 input，点选项时焦点给它。它曾经把外面 `overflow: hidden` 的格子滚走、整页变空；nb-ui 已在 label 上修好（t17，见 nb-ui 的 `Checkbox.md`），面板仍让放它的滚动容器带 `relative`，作为防御性约定（见 `tests/web-scroll-containers.test.ts`）。
