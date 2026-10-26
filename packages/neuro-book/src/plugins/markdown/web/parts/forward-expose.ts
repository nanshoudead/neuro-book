/**
 * 包装组件把外露方法转给里面那个组件：`markdownKey` 交出的组件外面套了几层（插件的 `withHost`、`MarkdownHosted`），宿主在
 * 交出的组件上取模板引用调方法（对话视图的输入框调 PromptEditor 的 `focus`、`addFiles`），引用停在最外层就拿不到。
 *
 * 用法：setup 里 `const inner = forwardExpose(expose)`（`<script setup>` 里是 `defineExpose(exposeOf(inner))`），渲染里面的组件时
 * `ref: inner`。里面的组件是异步组件时，Vue 把引用
 * 交给它加载出的真实组件。里面的组件还没挂上时，取任何方法都是 undefined。
 */

import {shallowRef} from "vue";
import type {SetupContext, ShallowRef} from "vue";

type Exposed = Record<PropertyKey, unknown>;

/** 转给 `inner` 的外露对象：`<script setup>` 的组件交给 `defineExpose`。 */
export function exposeOf(inner: ShallowRef<Exposed | null>): Exposed {
    return new Proxy({}, {
        get: (_target, key) => inner.value?.[key],
        has: (_target, key) => inner.value !== null && key in inner.value,
    });
}

export function forwardExpose(expose: SetupContext["expose"]): ShallowRef<Exposed | null> {
    const inner = shallowRef<Exposed | null>(null);
    expose(exposeOf(inner));
    return inner;
}
