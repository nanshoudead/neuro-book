<script setup lang="ts">
/**
 * 常用片段的设置页（column 页面）。设置窗口画分区的标题与说明，这里从片段列表开始画（docs/specs/settings/
 * settings-window.md 输出第 3 条）。
 *
 * **为什么用 `SettingsRow`，而不是自己画一行**：一项设置在“用户”“本作品”两个标签下有一整套规则——这一层写了才算
 * 已修改、要有“恢复默认”；本作品没写时标“来自用户设置”，写了时有“移除本作品的设置”；
 * 用户标签下本作品覆盖了要提示；文件改坏或连不上时停用（settings-window.md 输出第 10–13、18 条）。`SettingsRow` 按
 * 传入的配置服务与层把这些都算好、画好，和通用列表里的每一项一模一样；自己画就要把这些规则再写一遍，而且迟早写得
 * 和别的分区不一样。
 *
 * **为什么一整份列表只用一个 `SettingsRow`（宽排法），而不是每条片段一行、或用 `SettingsPageList`**：上面那些规则
 * 是按**配置项**（一个键）算的，片段列表是一个键，“恢复默认”删的是整份列表，单独一条片段没有“已修改”可言。所以整份
 * 列表是一行，列表编辑器放在这一行的插槽里；`wide` 让编辑器另起一行占满内容列（输出第 9 条的宽排法）。
 * `SettingsPageList` 是给 fill 页面在左栏挑一项、右边看详情用的（输出第 19 条），片段在原地编辑，用不上。
 *
 * **按层读**：插槽交出的 `value` 就是当前标签那一层该显示的列表——这一层写了取这一层，没写取下一层（本作品没写时是
 * 用户设置，用户设置没写时是默认值）。`SettingsRow` 是用 `settings.inspect(itemsSetting)` 读出各层再算的。插件自己
 * 要看某一层时也用 `inspect`，例如下面盯着当前这一层的情况来收起过时的失败提示（场景 06 读回各层的值也是这样）；
 * 只要有效值（例如真正插入片段的地方）时用 `get`。
 *
 * **按层写**：改动经 `saveSnippets` 写进 `context.layer.value` 那一层（`snippets.ts`）。切换标签时窗口不重建这个页面，
 * 只是 `context.layer` 变了（输出第 6 条），所以每次写入时才读它，不要在 setup 里取一次存起来。
 *
 * **沿用时也能直接改**：“本作品”标签下本作品没写时，插槽交出的是用户设置的列表，`disabled` 为假（只在层不能写时为真），
 * 编辑器照常可用（输出第 12 条）。第一次改动交来的是改好的**整份**列表，写进本作品层：层之间不合并，本作品层存的是
 * 一整份，不是在用户设置上加减几条。之后两层各管各的，用户设置再加片段，这本书里看不到；“移除本作品的设置”删掉本作品
 * 层的键，回到沿用。
 */
import {computed, ref, watch} from "vue";

import {displayLocale, formatText, localize} from "@notnotype/nb-plugin-sdk";
import type {LocalizedText, SettingsFailure, SettingsService} from "@notnotype/nb-plugin-sdk";
import {SettingsRow} from "@notnotype/nb-plugin-sdk/browser";
import type {SettingsPageContext} from "@notnotype/nb-plugin-sdk/browser";

import {itemsSetting} from "../shared/contracts";
import type {Snippet} from "../shared/contracts";
import {saveSnippets} from "./snippets";
import SnippetsEditor from "./SnippetsEditor.vue";

const props = defineProps<{
    context: SettingsPageContext;
    settings: SettingsService;
}>();

const TEXT = {
    notSaved: {"zh-CN": "没有保存（{code}）：{detail}", "en-US": "Not saved ({code}): {detail}"},
} satisfies Record<string, LocalizedText>;

// 显示语言也是一项配置（`nbook.settings/locale`），在 computed 里读，切换语言时页面跟着换文字。
const locale = computed(() => displayLocale(props.settings));

/**
 * 最近一次写入的失败原因。页面没有依赖工作台的通知服务（那样没有工作台的窗口里这个插件就起不来），失败写在列表下面
 * 的状态行里；下一次写成功时清掉。
 */
const problem = ref<string | null>(null);

function report(failure: {readonly code: SettingsFailure; readonly detail: string} | null): void {
    problem.value = failure === null ? null : localize(formatText(TEXT.notSaved, failure), locale.value);
}

// 换了标签，或当前这一层变了（写成功，包括 SettingsRow 自己的“恢复默认”这类写入；或在别的窗口、别的编辑器里被改了），
// 上一次的失败提示就过时了。`inspect(...)[层]` 是这一层自己的情况：有没有写、值是什么、文件是否有效；在 watch 里读，
// 层的快照一变就重新求值（docs/specs/settings/configuration.md 输出第 7 条）。
watch(() => [props.context.layer.value, props.settings.inspect(itemsSetting)[props.context.layer.value]], () => report(null));

/** 编辑器交来改好的整份列表：写进当前标签那一层；返回是否写成了，编辑器据此回到层里的实际值。 */
async function save(items: ReadonlyArray<Snippet>): Promise<boolean> {
    const result = await saveSnippets(props.settings, props.context.layer.value, items);
    report(result.ok ? null : result);
    return result.ok;
}
</script>

<template>
    <div class="snippets-page">
        <!--
            恢复默认、移除本作品的设置是 SettingsRow 自己发的写入，失败时它发 write-failed，这里同样写进状态行。
        -->
        <SettingsRow
            v-slot="row"
            :settings="settings"
            :setting="itemsSetting"
            :layer="context.layer.value"
            :locale="locale"
            :project-title="context.projectTitle.value"
            wide
            @write-failed="report"
        >
            <SnippetsEditor :items="(row.value as ReadonlyArray<Snippet>)" :disabled="row.disabled" :locale="locale" :save="save" />
        </SettingsRow>
        <p v-if="problem !== null" class="snippets-page__problem" role="status" data-snippets-problem>{{ problem }}</p>
    </div>
</template>

<style scoped>
.snippets-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.snippets-page__problem {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-danger);
    overflow-wrap: anywhere;
}
</style>
