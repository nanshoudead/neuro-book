<script setup lang="ts">
// 问答页注入对话视图的 Markdown 显示（同名 .md）：先把正文里的“章.段”改写成出处链接，再交给 nb-markdown 的
// MarkdownDisplay；出处链接在那里显示成引用小块，点击发 reference（问答页打开原文抽屉）。属性原样转过去。
import {computed} from "vue";
import type {MarkdownDisplayPortProps} from "@notnotype/nb-agent-ui";
import {MarkdownDisplay} from "@notnotype/nb-markdown/display";
import {defaultMarkdownLanguage} from "@notnotype/nb-markdown/language";

import {linkRefs} from "./link-refs";

const props = defineProps<MarkdownDisplayPortProps>();

// 与显示端同一份方言的词法器：哪里是纯文字由它说了算。
const language = defaultMarkdownLanguage();
const lexer = () => language.lexer();
const linked = computed(() => linkRefs(props.text, lexer, {streaming: props.streaming === true}));
</script>

<template>
    <MarkdownDisplay :text="linked" :locale="props.locale" :streaming="props.streaming" :resolve-asset="props.resolveAsset" :on-activate="props.onActivate" />
</template>
