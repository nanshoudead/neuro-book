/**
 * 只在类型检查时起作用：问答页注入对话视图的组件要符合 nb-agent-ui 的端口与宿主组件的形状（写法同
 * `packages/nb-markdown/src/prompt/agent-ports.typecheck.ts`）。哪一边改了属性，`bun run typecheck` 就报错。
 */

import type {EntryComponentProps, MarkdownDisplayPortProps, ToolComponentProps} from "@notnotype/nb-agent-ui";

import type AnswerCard from "./AnswerCard.vue";
import type StoryMarkdown from "./StoryMarkdown.vue";
import type UnverifiedRefs from "./UnverifiedRefs.vue";

type PropsOf<C> = C extends abstract new (...args: never[]) => {$props: infer P} ? P : never;
/** 端口给出的每个属性组件都声明了、类型也兼容；端口里没有组件不认识的键。 */
type Accepts<Props, Port> = [Exclude<keyof Port, keyof Props>] extends [never] ? (Port extends Props ? true : false) : false;

export const storyMarkdownProps: Accepts<PropsOf<typeof StoryMarkdown>, MarkdownDisplayPortProps> = true;
export const answerCardProps: Accepts<PropsOf<typeof AnswerCard>, ToolComponentProps> = true;
export const unverifiedRefsProps: Accepts<PropsOf<typeof UnverifiedRefs>, EntryComponentProps> = true;
