/**
 * 只在类型检查时起作用：本插件的提示词编辑器、已发送文字的显示与 Markdown 显示，要符合对话视图 nb-agent-ui 注入它们时
 * 要求的形状（`@notnotype/nb-agent-ui` 的 `ports.ts`）。哪一边改了属性、事件或外露方法，`bun run typecheck` 就报错。
 *
 * 对的是 `.vue` 源组件，不是 `markdownKey` 服务交出的值：服务字段的类型是宽泛的 `Component`，什么都能赋给它。服务在
 * 运行时包的那一层（`withHost`、异步组件）只转发属性与插槽，不在这里核对。
 */

import type {MarkdownDisplayPortProps, PromptEditorPortExpose, PromptEditorPortProps, PromptTextViewPortProps} from "@notnotype/nb-agent-ui";

import type MarkdownDisplay from "./components/MarkdownDisplay.vue";
import type PromptEditor from "./components/prompt/PromptEditor.vue";
import type PromptTextView from "./components/prompt/PromptTextView.vue";

/**
 * 组件的 `$props`，事件监听键按驼峰写：Vue 把 `token-activate` 事件的监听键标成 `"onToken-activate"`，运行时
 * `onTokenActivate` 同样认（emit 按两种写法找监听），对话视图用 `h()` 传的是驼峰写法。
 */
type Camelize<S extends string> = S extends `${infer Head}-${infer Tail}` ? `${Head}${Capitalize<Camelize<Tail>>}` : S;
type PropsOf<C> = C extends abstract new (...args: never[]) => {$props: infer P} ? {[K in keyof P as K extends string ? Camelize<K> : K]: P[K]} : never;
type InstanceOf<C> = C extends abstract new (...args: never[]) => infer I ? I : never;

/**
 * 端口给出的每个属性与事件处理函数，组件都声明了、类型也兼容；组件的必填属性端口都给了。
 * 只比 `Port extends Props` 放得过多出来的键（结构类型），所以另查端口里有没有组件不认识的键。
 */
type Accepts<Props, Port> = [Exclude<keyof Port, keyof Props>] extends [never] ? (Port extends Props ? true : false) : false;

export const promptEditorProps: Accepts<PropsOf<typeof PromptEditor>, PromptEditorPortProps> = true;
export const promptEditorExpose: InstanceOf<typeof PromptEditor> extends PromptEditorPortExpose ? true : false = true;
export const promptTextViewProps: Accepts<PropsOf<typeof PromptTextView>, PromptTextViewPortProps> = true;
export const markdownDisplayProps: Accepts<PropsOf<typeof MarkdownDisplay>, MarkdownDisplayPortProps> = true;

// 反例：证明上面几条真的会失败，而不是对任何组件都成立。
// @ts-expect-error 端口不给必填的 locale 时不能通过。
export const missingLocale: Accepts<PropsOf<typeof PromptEditor>, Omit<PromptEditorPortProps, "locale">> = true;
// @ts-expect-error 端口监听组件不发出的事件时不能通过。
export const unknownEvent: Accepts<PropsOf<typeof PromptEditor>, PromptEditorPortProps & {onSubmitted?: () => void}> = true;
// @ts-expect-error 事件参数的类型不兼容时不能通过。
export const wrongPayload: Accepts<PropsOf<typeof PromptEditor>, Omit<PromptEditorPortProps, "onSubmit"> & {onSubmit?: (payload: string) => void}> = true;
// @ts-expect-error 端口要求组件没有的外露方法时不能通过。
export const missingExpose: InstanceOf<typeof PromptEditor> extends PromptEditorPortExpose & {clear(): void} ? true : false = true;
