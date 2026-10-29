/**
 * 类型检查（R1-3）：第一轮审查里六处“写错了 tsc 也不报”的代码，在第二版的 API 下都应当是编译错误。
 * 每处前面的 @ts-expect-error 要求下一行有错；哪一行不再报错，tsc 就会报“未使用的 @ts-expect-error”。
 * 运行：tsc -p tsconfig.json（与 spike 其它文件一起检查）
 */

import {conv, defineExtension, is, K, path} from "./api.ts";
import "./examples/plugins.ts";   // 声明合并：core.history、nbook.history、nbook.workspace 的选择器

export const typed = defineExtension({
    id: "lab.typed",
    state: {n: path(0), names: path<string[]>([])},
    events: {card: conv<{name: string; text: string}>()},
    reduce: {
        // @ts-expect-error 1. 片是数字，归约返回了字符串
        n: (n, e) => (is(e, K.user) ? "1" : undefined),
        names: (s, e, ev) => (ev.card.is(e) ? [...s, e.data.name] : undefined),
    },
    react(e, ctx) {
        // @ts-expect-error 2. 自己的片名拼错
        void ctx.mine.namez;
        if (is(e, K.user)) {
            // @ts-expect-error 3. 内核事件的 data 字段拼错
            void e.data.txt;
        }
        if (ctx.ev.card.is(e)) {
            // @ts-expect-error 4. 自己事件的 data 字段拼错
            void e.data.nam;
        }
        // @ts-expect-error 5. 别的扩展没导出这个选择器
        void ctx.read("nbook.history", "pending");
        const pending: string[] = ctx.read("nbook.history", "pendingChanges");
        void pending;
        // @ts-expect-error 6. 自己的事件 data 形状不对
        return [ctx.ev.card({name: 1})];
    },
    contribute: {
        // @ts-expect-error 7. contribute 返回了数字
        count: {volatile: true, value: (m) => m.n},
    },
});

// Profile 一侧（R2-5）：自带扩展的 own 有类型，id 拼错是编译错误
import {defineProfile} from "./api.ts";
export const typedProfile = defineProfile({
    id: "lab.p",
    tools: {required: []},
    extensions: [typed],
    prompt: ({state}) => {
        const n: number = state.own("lab.typed").n;
        void n;
        // @ts-expect-error 8. 自带扩展的 id 拼错
        void state.own("lab.typd");
        return [];
    },
});
