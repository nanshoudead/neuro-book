<script setup lang="ts">
// 设置页（docs/specs/story/viewer.md 的设置页，w00024 t13 决定 10）：整份问答与抽取的配置，与 `nbstory config` 是同一份
// 文件。表单按配置的 schema 画（nb-form）；密钥本身不显示、不能填，只写服务启动时那个环境变量有没有值。保存带上读到时
// 的摘要，别处改过就报冲突、提示重新载入。
import {computed, ref, shallowRef} from "vue";
import {useRouter} from "vue-router";
import {Banner, Button} from "@notnotype/nb-ui/components";
import {SchemaForm} from "@notnotype/nb-form/vue";
import type {FormIssue} from "@notnotype/nb-form";

import {ConfigSchema} from "../../contract/config-schema";
import type {ViewerResult} from "../../contract/contract";
import {StoryCallError, useStoryClient} from "../host/client";

const client = useStoryClient();
const router = useRouter();

/** 文件不在或读不成时的起点：必填的几项空着，由表单提示补上。 */
const STARTER = {model: {baseUrl: "", id: "", apiKeyEnv: "OPENAI_API_KEY"}};
/** 三处密钥环境变量在配置里的路径（问题按路径挂到字段上）。 */
const KEY_PATHS: ReadonlyArray<ReadonlyArray<string>> = [["model", "apiKeyEnv"], ["ingest", "model", "apiKeyEnv"], ["ingest", "recall", "model", "apiKeyEnv"]];

type Loaded = ViewerResult<"config.get">;
const loaded = shallowRef<Loaded | null>(null);
const loadError = ref<string | null>(null);
const value = shallowRef<unknown>(null);
/** 最近一次读到或存下的内容，判断有没有没保存的改动。 */
const savedText = ref("");
const revision = ref(0);
/** 表单里还有没提交的草稿（正在输入的文字、数字）。 */
const drafting = ref(false);
const saving = ref(false);
const notice = ref<{tone: "success" | "error" | "warning"; text: string; conflict?: boolean} | null>(null);
const testing = ref(false);
const tested = shallowRef<ViewerResult<"config.test"> | null>(null);

async function load(): Promise<void> {
    loadError.value = null;
    try {
        const result = await client.call("config.get", {});
        loaded.value = result;
        value.value = result.state === "invalid" ? STARTER : result.config;
        savedText.value = result.state === "valid" ? JSON.stringify(result.config) : "";
        revision.value += 1;
        notice.value = null;
        tested.value = null;
    } catch (error) {
        loadError.value = error instanceof Error ? error.message : String(error);
    }
}
void load();

const dirty = computed(() => drafting.value || JSON.stringify(value.value) !== savedText.value);

function at(root: unknown, path: ReadonlyArray<string>): unknown {
    let current = root;
    for (const key of path) current = typeof current === "object" && current !== null ? (current as Record<string, unknown>)[key] : undefined;
    return current;
}
/** 密钥变量名旁的提示：服务启动时它没有值，或改了名、保存后才知道。 */
const issues = computed<FormIssue[]>(() => {
    const keys = loaded.value?.keys ?? {};
    return KEY_PATHS.flatMap(path => {
        const name = at(value.value, path);
        if (typeof name !== "string" || name === "") return [];
        if (!(name in keys)) return [{path, code: "key-unknown", params: {}, severity: "warning" as const, source: "caller" as const, message: "保存后才知道这个环境变量有没有值"}];
        if (keys[name] === false) return [{path, code: "key-unset", params: {}, severity: "warning" as const, source: "caller" as const, message: `服务启动时环境变量 ${name} 没有值：先在启动服务的终端里设好它，再重启服务`}];
        return [];
    });
});

const form = ref<InstanceType<typeof SchemaForm> | null>(null);
async function save(): Promise<void> {
    if (loaded.value === null || saving.value) return;
    // 先把正在输入的草稿提交进值；解析不了的留在表单上显示。
    if (form.value !== null && !form.value.commit()) return;
    saving.value = true;
    notice.value = null;
    try {
        const result = await client.call("config.set", {config: value.value, expect: loaded.value.digest});
        loaded.value = {state: "valid", config: value.value as never, digest: result.digest, path: result.path, keys: result.keys};
        savedText.value = JSON.stringify(value.value);
        tested.value = null;
        notice.value = {tone: "success", text: "已保存。下一轮问答与下一次抽取开始时用新的配置。"};
    } catch (error) {
        if (error instanceof StoryCallError && error.code === "config_conflict") notice.value = {tone: "warning", text: "配置在别处（命令行或另一个页面）改过了。重新载入会丢掉这里没保存的改动。", conflict: true};
        else notice.value = {tone: "error", text: `没有保存：${error instanceof Error ? error.message : String(error)}`};
    } finally {
        saving.value = false;
    }
}

async function test(): Promise<void> {
    testing.value = true;
    tested.value = null;
    try {
        tested.value = await client.call("config.test", {});
    } catch (error) {
        notice.value = {tone: "error", text: `测试连接失败：${error instanceof Error ? error.message : String(error)}`};
    } finally {
        testing.value = false;
    }
}

function onDraftState(state: {state: "clean" | "dirty" | "unparseable"}): void {
    drafting.value = state.state !== "clean";
}
</script>

<template>
    <main class="settings-page" data-testid="settings-page">
        <div class="settings-head">
            <Button size="sm" variant="ghost" icon-class="i-lucide-arrow-left" @click="router.back()">返回</Button>
            <h1 class="settings-title"><span class="i-lucide-settings" />设置</h1>
        </div>
        <p v-if="loaded" class="settings-path">配置文件 <code>{{ loaded.path }}</code>，与命令行 <code>nbstory config</code> 改的是同一份。</p>

        <Banner v-if="loadError" tone="error" :message="`读不到配置：${loadError}`" />
        <Banner v-if="loaded?.state === 'absent'" tone="info" message="还没有配置文件：填好下面的模型后保存，会新建它。" data-testid="settings-absent" />
        <Banner v-if="loaded?.state === 'invalid'" tone="error" :message="`配置文件有问题：${loaded.problem}。下面从一份空的配置开始，保存会整份覆盖它。`" data-testid="settings-invalid" />

        <SchemaForm
            v-if="loaded"
            ref="form"
            v-model="value"
            :schema="ConfigSchema"
            locale="zh-CN"
            :issues="issues"
            :revision="revision"
            @draft-state="onDraftState"
        />

        <Banner v-if="notice" :tone="notice.tone" :message="notice.text" data-testid="settings-notice">
            <template v-if="notice.conflict" #actions><Button size="sm" @click="load()">重新载入</Button></template>
        </Banner>
        <div v-if="loaded" class="settings-actions">
            <Button :disabled="!dirty || saving" data-testid="settings-save" @click="save()">{{ saving ? "保存中…" : "保存" }}</Button>
            <Button variant="secondary" :disabled="dirty || testing || loaded.state !== 'valid'" :title="dirty ? '先保存，测试的是保存下来的配置' : undefined" data-testid="settings-test" @click="test()">{{ testing ? "测试中…" : "测试连接" }}</Button>
            <span v-if="dirty" class="settings-hint">有没保存的改动；测试连接测的是保存下来的配置</span>
        </div>
        <div v-if="tested" class="settings-tested" :class="tested.ok ? 'is-ok' : 'is-failed'" data-testid="settings-tested">
            <template v-if="tested.ok">通过：{{ tested.model }} 正常回话（{{ (tested.ms / 1000).toFixed(1) }} 秒）。推理档：{{ tested.thinking ?? "未设" }}，一个小请求证明不了服务端是否按这个档思考。</template>
            <template v-else>没通过（{{ tested.model }}）：{{ tested.error?.message }}</template>
        </div>
    </main>
</template>

<style scoped>
.settings-page { max-width: 760px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.settings-head { display: flex; align-items: center; gap: 8px; }
.settings-title { display: flex; align-items: center; gap: 8px; font-size: var(--text-lg); font-weight: var(--weight-strong); }
.settings-path { color: var(--text-muted); font-size: var(--text-xs); }
.settings-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.settings-hint { color: var(--text-muted); font-size: var(--text-xs); }
.settings-tested { border-radius: var(--radius-control); padding: 8px 10px; font-size: var(--text-sm); }
.settings-tested.is-ok { background: var(--status-success-bg); color: var(--status-success); }
.settings-tested.is-failed { background: var(--status-error-bg, var(--status-warning-bg)); color: var(--status-error, var(--status-warning)); }
</style>
