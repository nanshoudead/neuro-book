<script setup lang="ts">
import {Spinner} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, ref, shallowRef, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {streamLines} from "../host/api.js";
import type {SearchCheckoutDone, SearchHit, SearchRecordMatch} from "../host/types.js";
import LoadState from "../parts/LoadState.vue";
import PageShell from "../parts/PageShell.vue";
import SearchResults from "../parts/SearchResults.vue";

/**
 * 搜索（第二轮顶栏的搜索）：结果流式到达、逐条出现。顶栏的输入去抖 300 毫秒后才改地址；同一时刻只跑一组，
 * 新的搜索开始时取消旧的（服务端也会结束旧的子进程）。
 */
const route = useRoute();
const router = useRouter();
const records = shallowRef<SearchRecordMatch[]>([]);
const hits = shallowRef<SearchHit[]>([]);
const done = shallowRef<SearchCheckoutDone[]>([]);
const finished = ref(false);
/** 当前这批结果是哪个搜索词的：开始搜时（清结果的同一处）才换，高亮与结果对得上；也当结果零件的 key，换词时历史收起。 */
const searchedQ = ref("");
const error = ref<{message: string} | null>(null);
let controller: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function run(q: string): Promise<void> {
    controller?.abort();
    records.value = [];
    hits.value = [];
    done.value = [];
    finished.value = false;
    error.value = null;
    searchedQ.value = q;
    if (q.trim().length < 2) {
        finished.value = true;
        return;
    }
    const local = new AbortController();
    controller = local;
    const pendingRecords: SearchRecordMatch[] = [];
    const pendingHits: SearchHit[] = [];
    const pendingDone: SearchCheckoutDone[] = [];
    // 结果一条一条到，攒一帧再交给视图，免得几百条结果触发几百次重排。
    const flush = () => {
        records.value = [...pendingRecords];
        hits.value = [...pendingHits];
        done.value = [...pendingDone];
    };
    const frame = setInterval(flush, 100);
    try {
        await streamLines(`/api/search?q=${encodeURIComponent(q)}`, (line) => {
            if (line.type === "record") pendingRecords.push(line as SearchRecordMatch);
            else if (line.type === "hit") pendingHits.push(line as SearchHit);
            else if (line.type === "checkout_done") pendingDone.push(line as SearchCheckoutDone);
            else if (line.type === "error") error.value = {message: String(line.message)};
        }, local.signal);
        if (controller === local) finished.value = true;
    } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        error.value = {message: caught instanceof Error ? caught.message : String(caught)};
    } finally {
        clearInterval(frame);
        if (controller === local) flush();
    }
}

watch(() => route.query.q, (value) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(typeof value === "string" ? value : ""), 300);
}, {immediate: true});
onBeforeUnmount(() => {
    controller?.abort();
    if (timer) clearTimeout(timer);
});

</script>

<template>
    <PageShell :crumbs="[{label: '首页', href: '/'}, {label: '搜索'}]" :title="`搜索“${route.query.q ?? ''}”`" @navigate="(href) => void router.push(href)">
        <template v-if="!finished && !error" #status><Spinner size="sm" label="搜索中" /></template>
        <LoadState v-if="error" :loading="false" :error="error" @retry="run(String(route.query.q ?? ''))" />
        <SearchResults :key="searchedQ" :records="records" :hits="hits" :done="done" :finished="finished" :q="searchedQ" @navigate="(href) => router.push(href)" />
    </PageShell>
</template>
