<script setup lang="ts">
import {Button, Dialog, Input, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {usePagedQuery, useStoryQuery} from "../host/query";
import {useRevise} from "../host/revise";

const props = defineProps<{open: boolean; mode: "link" | "kind" | "name"; entity: string; label: string; kind: string; names: string[]}>();
const emit = defineEmits<{"update:open": [value: boolean]}>();

const KINDS = [
    {value: "person", label: "人物"},
    {value: "persona", label: "马甲"},
    {value: "group", label: "组织"},
    {value: "place", label: "地点"},
    {value: "item", label: "物品"},
    {value: "concept", label: "概念"},
    {value: "task", label: "任务"},
    {value: "other", label: "其他"},
];
const {busy, error, run} = useRevise();

const search = ref("");
const target = ref<{id: string; label: string} | null>(null);
const certainty = ref<"candidate" | "certain">("candidate");
const newKind = ref("person");
const name = ref("");
const evidence = ref<string | null>(null);
const typed = ref("");

// 每次打开重新开始，不带上次的选择。
watch(() => props.open, open => {
    if (!open) return;
    search.value = "";
    target.value = null;
    certainty.value = "candidate";
    newKind.value = KINDS.find(item => item.value !== props.kind)?.value ?? "person";
    name.value = props.names[0] ?? "";
    evidence.value = null;
    typed.value = "";
    error.value = null;
});

const needsTarget = computed(() => props.mode === "link" || props.mode === "name");
const found = useStoryQuery("entities.list", () => (props.open && needsTarget.value && search.value.trim() ? {query: search.value.trim(), limit: 8} : null));
const options = computed(() => (found.data.value?.items ?? []).filter(item => !item.entities.includes(props.entity)));
const paragraphs = usePagedQuery("revisions.evidence", () => (props.open ? {entity: props.entity, ...(props.mode === "name" && name.value ? {text: name.value} : {})} : null), 20);

const chosenEvidence = computed(() => (typed.value.trim() !== "" ? typed.value.trim() : evidence.value));
const ready = computed(() => chosenEvidence.value !== null && (!needsTarget.value || target.value !== null) && (props.mode !== "name" || name.value !== ""));
const title = computed(() => (props.mode === "link" ? `把“${props.label}”连到另一个对象` : props.mode === "kind" ? `改“${props.label}”的对象种类` : `“${props.label}”的称呼属于别的对象`));
const submitText = computed(() => (props.mode === "link" ? "连接" : props.mode === "kind" ? "改种类" : "挪称呼"));
const effects = computed(() =>
    props.mode === "link"
        ? ["两个对象按你选的“可能是”或“就是”连起来（“就是”会让它们在人物页合成一个点）；", "说法在记录里标“你加的”，可以在待确认页撤销。"]
        : props.mode === "kind"
            ? ["人物卡与统计从这一段起按新种类算，之前的阅读位置仍是原来的；", "指向它的候选身份保留，不会自动合并。"]
            : ["这个称呼从这一段起属于新的对象：之后的出现与阅读页的链接指向它；", "之前章节里它指向原对象的地方不变（不剧透、不改过去）。"],
);

async function submit(): Promise<void> {
    const at = chosenEvidence.value;
    if (at === null) return;
    const done =
        props.mode === "link" && target.value
            ? await run("revisions.link", {a: props.entity, b: target.value.id, evidence: at, certainty: certainty.value})
            : props.mode === "kind"
                ? await run("revisions.kind", {entity: props.entity, kind: newKind.value as "person", evidence: at})
                : target.value
                    ? await run("revisions.moveName", {text: name.value, from: props.entity, to: target.value.id, evidence: at})
                    : null;
    if (done) emit("update:open", false);
}
</script>

<template>
    <Dialog :model-value="open" :title="title" size="lg" closable @update:model-value="emit('update:open', $event)">
        <div class="flex flex-col gap-2" data-testid="revise-dialog" :data-mode="mode">
            <template v-if="mode === 'name'">
                <label class="lab">哪个称呼</label>
                <SegmentedControl v-model="name" size="xs" :options="names.slice(0, 8).map(text => ({value: text, label: text}))" aria-label="称呼" />
            </template>
            <template v-if="needsTarget">
                <label class="lab">{{ mode === "link" ? "连到谁" : "改挂到" }}</label>
                <Input v-model="search" size="sm" icon-class="i-lucide-search" placeholder="按名字或称呼搜" data-testid="revise-search" />
                <ul v-if="options.length" class="list">
                    <li v-for="item in options" :key="item.id">
                        <button type="button" class="row" :class="{on: target?.id === item.id}" :data-entity="item.id" @click="target = {id: item.id, label: item.label}"><b>{{ item.label }}</b><span class="muted">{{ item.kind }} · 出场 {{ item.mentions }}</span></button>
                    </li>
                </ul>
                <p v-if="target" class="muted" data-testid="revise-target">已选：{{ target.label }}</p>
            </template>
            <template v-if="mode === 'kind'">
                <label class="lab">现在是{{ KINDS.find(item => item.value === kind)?.label ?? kind }}，改成</label>
                <SegmentedControl v-model="newKind" size="xs" :options="KINDS.filter(item => item.value !== kind)" aria-label="新种类" />
            </template>
            <label class="lab">哪一句话说明了这件事 <span class="muted">必选：修订从这一段起生效，读到它之前看不到</span></label>
            <ul class="list" data-testid="revise-evidence">
                <li v-for="item in paragraphs.items.value" :key="item.ref">
                    <button type="button" class="row" :class="{on: evidence === item.ref && typed.trim() === ''}" :data-ref="item.ref" @click="evidence = item.ref; typed = ''"><span class="ref">{{ item.ref }}</span><span class="min-w-0 truncate">{{ item.text }}</span></button>
                </li>
                <li v-if="paragraphs.hasMore.value"><button type="button" class="row muted" @click="paragraphs.more()">更多段落……</button></li>
            </ul>
            <div class="flex items-center gap-2"><span class="muted">或直接写章.段</span><div class="w-28"><Input v-model="typed" size="sm" placeholder="例如 5.75" data-testid="revise-typed" /></div></div>
            <template v-if="mode === 'link'">
                <label class="lab">这是一条</label>
                <SegmentedControl v-model="certainty" size="xs" :options="[{value: 'candidate', label: '可能是（候选）'}, {value: 'certain', label: '就是（确定）'}]" aria-label="把握" />
            </template>
            <div class="effect"><b>改完会怎样</b><ul><li v-for="line in effects" :key="line">{{ line }}</li></ul></div>
            <p v-if="error" class="text-[length:var(--text-xs)] text-[var(--status-danger)]" role="alert" data-testid="revise-error">{{ error }}</p>
        </div>
        <template #footer>
            <div class="flex justify-end gap-2">
                <Button variant="ghost" size="sm" @click="emit('update:open', false)">取消</Button>
                <Button size="sm" :disabled="!ready || busy" data-testid="revise-submit" @click="submit">{{ submitText }}</Button>
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.lab {
    margin-top: 4px;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
}
.muted {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: normal;
}
.list {
    display: flex;
    max-height: 9.5rem;
    flex-direction: column;
    overflow-y: auto;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-control, 10px);
}
.row {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 8px;
    padding: 4px 10px;
    text-align: left;
    font-size: var(--text-xs);
    line-height: 1.6;
    border-bottom: var(--border-w, 1px) solid var(--divider);
}
.row.on {
    background: var(--accent-bg);
}
.ref {
    color: var(--accent-text);
    white-space: nowrap;
}
.effect {
    padding: 8px 12px;
    border-radius: var(--radius-control, 10px);
    background: var(--bg-hover);
    font-size: var(--text-xs);
    line-height: 1.6;
}
.effect ul {
    margin: 2px 0 0 16px;
    list-style: disc;
}
</style>
