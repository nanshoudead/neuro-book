<script setup lang="ts">
/**
 * 片段列表的编辑器：放在 `SettingsRow` 的插槽里，`items` 是当前标签那一层该显示的列表。每条一行：名字、正文，以及
 * 上移、下移、删除；末尾“添加片段”。增删与移动点了就写；名字与正文边打边改草稿，离开输入框才写——每敲一个字就写一次
 * 文件，既慢，又会把半截的输入存进去。
 *
 * 写入由页面做（`save`），这里只算出改好的整份列表交出去。写完（成功或失败）都把草稿换回 `items`：成功时 `items`
 * 已经是新列表（配置服务的写入返回时，本窗口已应用新值，docs/specs/settings/configuration.md 输出第 15 条）；失败时
 * 是层里原来的值，输入框回到实际值，不留下没存进去的字。
 */
import {Button, Input, Textarea, IconButton, Tooltip} from "@notnotype/nb-plugin-sdk/components";
import {usePluginText} from "@notnotype/nb-plugin-sdk/text/browser";
import {ref, watch} from "vue";

import {plugin} from "../shared/contracts";
import type {Snippet} from "../shared/contracts";
import {addSnippet, changeSnippet, moveSnippet, removeSnippet} from "./snippets";

const props = defineProps<{
    items: ReadonlyArray<Snippet>;
    /** 这一层不能保存（文件无效、连不上）：全部停用。 */
    disabled: boolean;
    /** 写入改好的整份列表，返回是否写成了。 */
    save: (items: ReadonlyArray<Snippet>) => Promise<boolean>;
}>();

/**
 * 界面文字取自本插件的消息目录（`../locales/`）。`usePluginText` 读宿主在窗口根上注入的翻译端口，绑定本插件的命名空间：
 * `text("editor.add")` 返回当前界面语言的字符串，键按源语言目录核对（docs/specs/ui/i18n.md 的“目录与键”）。在模板里调用，
 * 界面语言切换时组件跟着重画，所以不需要像以前那样从页面传一个 `locale` 属性下来。只在 `setup` 里调用：端口经 Vue 的
 * 注入取得。
 */
const text = usePluginText<typeof import("../locales/zh-CN.json")>(plugin.id);

/** 输入框里的草稿；`items` 变了（写入结算、切换标签、文件被外部改了）就整份换掉。 */
const drafts = ref<Snippet[]>(props.items.map((item) => ({...item})));
watch(() => props.items, (items) => {
    drafts.value = items.map((item) => ({...item}));
});

/**
 * 写入排队，一次只发一个，每次在上一次结算之后才按**那时**的列表算出新列表。改完名字直接点“上移”时，先触发输入框的
 * 离开（写名字）、再触发点击（写移动）：要是两次都按点击那一刻的旧列表算，后写的移动会把刚改的名字覆盖掉。
 * `save` 不 reject：配置服务的写入把失败放在结果里返回（configuration.md“接口”）。
 */
let queue: Promise<void> = Promise.resolve();

function commit(change: (items: ReadonlyArray<Snippet>) => Snippet[]): void {
    queue = queue.then(async () => {
        try {
            await props.save(change(props.items));
        } finally {
            drafts.value = props.items.map((item) => ({...item}));
        }
    });
}

/** 离开名字或正文的输入框：和层里的值不一样才写。 */
function commitField(index: number, field: keyof Snippet): void {
    const value = drafts.value[index]?.[field];
    if (value === undefined || value === props.items[index]?.[field]) return;
    commit((items) => changeSnippet(items, index, {[field]: value}));
}
</script>

<template>
    <div class="snippets-editor" data-snippets-editor>
        <p v-if="items.length === 0" class="snippets-editor__empty">{{ text('editor.empty') }}</p>
        <!-- 片段没有 id、名字可以重名，只能按位置作 key。 -->
        <div v-for="(item, index) in drafts" :key="index" class="snippets-editor__item" :data-snippet="index">
            <div class="snippets-editor__name" @focusout="commitField(index, 'name')">
                <Input v-model="item.name" :disabled="disabled" :aria-label="text('editor.name')" :maxlength="40" size="sm" />
            </div>
            <div class="snippets-editor__text" @focusout="commitField(index, 'text')">
                <Textarea v-model="item.text" :disabled="disabled" :aria-label="text('editor.text')" :rows="2" :maxlength="2000" />
            </div>
            <div class="snippets-editor__actions">
                <Tooltip :text="text('editor.up')">
                    <IconButton size="sm" icon-class="i-lucide-arrow-up" :aria-label="text('editor.up')" :disabled="disabled || index === 0" @click="commit((list) => moveSnippet(list, index, -1))" />
                </Tooltip>
                <Tooltip :text="text('editor.down')">
                    <IconButton size="sm" icon-class="i-lucide-arrow-down" :aria-label="text('editor.down')" :disabled="disabled || index === items.length - 1" @click="commit((list) => moveSnippet(list, index, 1))" />
                </Tooltip>
                <Tooltip :text="text('editor.remove')">
                    <IconButton size="sm" icon-class="i-lucide-trash-2" :aria-label="text('editor.remove')" :disabled="disabled" @click="commit((list) => removeSnippet(list, index))" />
                </Tooltip>
            </div>
        </div>
        <Button class="snippets-editor__add" size="sm" variant="secondary" icon-class="i-lucide-plus" :disabled="disabled" @click="commit((list) => addSnippet(list, text('editor.newName')))">{{ text('editor.add') }}</Button>
    </div>
</template>

<style scoped>
.snippets-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.snippets-editor__empty {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

/* 名字一列、正文占满，动作按钮在最右；窄的时候正文换到名字下面。 */
.snippets-editor__item {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-3) var(--space-4);
}

.snippets-editor__name {
    width: 140px;
    flex-shrink: 0;
}

.snippets-editor__text {
    min-width: 200px;
    flex: 1;
}

.snippets-editor__actions {
    display: flex;
    flex-shrink: 0;
    gap: var(--space-1);
}

.snippets-editor__add {
    align-self: flex-start;
}
</style>
