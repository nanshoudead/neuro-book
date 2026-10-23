<script setup lang="ts">
/**
 * nbook 交出的 nb-markdown 组件的外层（同名 .md）：给子树提供 nbook 的宿主（作品文件的目标分类、文件图标、诊断、方言组成的
 * 语言），再按 `component` 挂对应的包组件，其余属性、事件与插槽原样转过去。
 *
 * 宿主接线放在这个按需加载的组件里，插件入口只按 `.vue` 引它：后端类型检查对 `.vue` 只看通配声明，不展开包源码里的 DOM 类型；
 * 首屏也不带包。语言只给展示器：它的加载连同组语言的模块一起等，挂上时取语言，此时模块已经到了；别的组件不带语言。
 */
import {defineAsyncComponent, inject, ref} from "vue";
import type {Component} from "vue";

import {provideMarkdownHost} from "@notnotype/nb-markdown/host";

import {nbookChips, nbookMarkdownHost} from "../host";
import type {languageFor} from "../language-registry";
import {markdownReportKey} from "../parts/report";
import {syntaxCatalogKey} from "../syntax-catalog";

export type HostedComponent = "MarkdownDisplay" | "MarkdownImage" | "InlineChip" | "PromptEditor" | "PromptTextView";

defineOptions({inheritAttrs: false});
const props = defineProps<{component: HostedComponent}>();

const catalog = inject(syntaxCatalogKey, null);
const report = inject(markdownReportKey, () => undefined);

let languageOf: typeof languageFor | null = null;

provideMarkdownHost(nbookMarkdownHost({
    language: () => {
        if (languageOf === null) throw new Error("MarkdownHosted：只有展示器取语言，它挂上时组语言的模块已经加载");
        return languageOf(catalog);
    },
    report,
}));

const LOADERS: Readonly<Record<HostedComponent, () => Promise<Component>>> = {
    MarkdownDisplay: async () => {
        const [display, registry] = await Promise.all([import("@notnotype/nb-markdown/display"), import("../language-registry")]);
        languageOf = registry.languageFor;
        return display.MarkdownDisplay;
    },
    MarkdownImage: async () => (await import("@notnotype/nb-markdown/display")).MarkdownImage,
    InlineChip: async () => (await import("@notnotype/nb-markdown/chip")).InlineChip,
    PromptEditor: async () => (await import("@notnotype/nb-markdown/prompt")).PromptEditor,
    PromptTextView: async () => (await import("@notnotype/nb-markdown/prompt")).PromptTextView,
};

/** 包组件的代码加载失败（部署换了版本、网络断了）时记诊断；展示器按纯文字显示原文（docs/specs/ui/markdown-display.md 的“失败与恢复”）。 */
const failed = ref(false);
const inner = defineAsyncComponent(() => LOADERS[props.component]().catch((error: unknown) => {
    report("markdown.component.load-failed", `${props.component} 的代码加载失败`, error);
    failed.value = true;
    throw error;
}));
/** InlineChip 只收属性、不 inject（组件规范），文件分类与图标经 `env` 给。 */
const extra = props.component === "InlineChip" ? {env: nbookChips} : {};
</script>

<template>
    <div v-if="failed && props.component === 'MarkdownDisplay'" class="nb-markdown-display" style="white-space: pre-wrap">{{ $attrs.text }}</div>
    <component :is="inner" v-else v-bind="{...extra, ...$attrs}">
        <template v-for="(_, name) in $slots" #[name]="scope">
            <slot :name="name" v-bind="scope ?? {}" />
        </template>
    </component>
</template>
