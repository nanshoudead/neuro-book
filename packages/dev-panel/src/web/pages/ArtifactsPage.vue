<script setup lang="ts">
import {Input} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import {useRouter} from "vue-router";
import {loadStateOf, useResource} from "../host/panel-data.js";
import type {ArtifactsData} from "../host/types.js";
import ArtifactList from "../parts/ArtifactList.vue";
import LoadState from "../parts/LoadState.vue";
import PageShell from "../parts/PageShell.vue";

/** 产物列表（t03 第二轮产物页的列表）：按类分组，可按 Work、Task 或标题过滤。 */
const router = useRouter();
const navigate = (href: string) => void router.push(href);
const list = useResource<ArtifactsData>(() => "/api/artifacts", ["records"]);
const filter = ref("");
const match = (...texts: Array<string | null | undefined>) => {
    const q = filter.value.trim().toLowerCase();
    return q === "" || texts.some((text) => text?.toLowerCase().includes(q));
};
const filtered = computed(() => {
    const data = list.data.value;
    if (!data) return null;
    return {
        artifacts: data.artifacts.filter((item) => match(item.workId, item.taskId, item.title, item.artifactId, item.workTitle, item.taskTitle)),
        documents: data.documents.filter((item) => match(item.workId, item.taskId, item.title, item.path)),
        evidences: data.evidences.filter((item) => match(item.workId, item.taskId, item.taskTitle)),
    };
});
</script>

<template>
    <PageShell :crumbs="[{label: '首页', href: '/'}, {label: '产物'}]" title="产物" @navigate="navigate">
        <template #actions>
            <div class="w-full max-w-sm"><Input v-model="filter" placeholder="按 Work、Task 或标题过滤" aria-label="过滤产物" /></div>
        </template>
        <LoadState v-bind="loadStateOf(list)" label="正在读取产物" @retry="list.reload()" />
        <ArtifactList v-if="filtered" :artifacts="filtered.artifacts" :documents="filtered.documents" :evidences="filtered.evidences" @navigate="navigate" />
    </PageShell>
</template>
