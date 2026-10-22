<script setup lang="ts">
/**
 * AgentConversationComposer 的 Lab 夹具。ctx 来自场景输入，可在数据 tab 直接编辑；宿主由 `useLabComposerHost` 扮演
 * （发送、排队、附件上传、模式与模型、命令）。另登记一个插件的工具栏按钮，演示“输入框工具栏按钮”扩展点。
 * 输入框放在撑满画布的一列底部，展开时按这一列的高度长高。按钮带 `data-lab-action` 供 smoke 定位。
 */
import {computed} from "vue";
import {AgentConversationComposer} from "@notnotype/nb-agent-ui/vue";
import type {AgentConversationContext, AgentConversationServices, AgentViewAction} from "@notnotype/nb-agent-ui";
import {createAgentViewRegistry, type AgentViewContribution} from "@notnotype/nb-agent-ui";
import {builtinComposerContribution} from "@notnotype/nb-agent-ui/vue";
import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import LabFixtureControls from "../../LabFixtureControls.vue";
import {Button} from "@notnotype/nb-ui/components";
import {useLabComposerHost} from "./composer-host";
import {provideLabAgentHost} from "./host";

const props = defineProps<LabFixtureProps>();
/** 场景“缺省实现”不注入编辑器，看普通文本框：没有“添加附件”，没有命令菜单。 */
provideLabAgentHost({plain: props.scene === "plain"});

const subject = useLabSubject<typeof AgentConversationComposer>(() => props.input, ["action", "preview-image"]);

const labPlugin: AgentViewContribution = {
    source: "lab:plugin",
    toolbarButtons: [{id: "lab-attachments", icon: "i-lucide-images", label: "插入会话附件（插件按钮）", action: {type: "lab:open-attachments"}}],
};

const registry = createAgentViewRegistry([builtinComposerContribution, labPlugin]);

const ctx = computed<AgentConversationContext>(() => subject.bindings.value.ctx);

function writeCtx(patch: Partial<AgentConversationContext>) {
    subject.write("props", "ctx", {...ctx.value, ...patch});
}

const host = useLabComposerHost({ctx: () => ctx.value, write: writeCtx});

const services = computed<AgentConversationServices>(() => ({
    resolveAttachmentUrl: host.resolveAttachmentUrl,
    resolveTriggerMenu: host.resolveTriggerMenu.value,
}));

const running = computed(() => ctx.value.run.status !== "idle");

function toggleRun() {
    writeCtx({run: running.value ? {status: "idle", phase: ""} : {status: "running", phase: "正在思考"}});
}

function onAction(action: AgentViewAction) {
    host.handle(action);
}
</script>

<template>
    <div class="flex h-full w-full flex-col justify-end">
        <AgentConversationComposer
            data-lab-subject
            v-bind="subject.bindings.value"
            :services="services"
            :registry="registry"
            @action="onAction"
        />
    </div>
    <LabFixtureControls>
        <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-[var(--text-secondary)]">模拟宿主</span>
            <Button size="sm" variant="secondary" data-lab-action="run" :aria-pressed="running" @click="toggleRun">{{ running ? "运行结束" : "开始运行" }}</Button>
            <Button size="sm" variant="secondary" data-lab-action="fail-upload" :aria-pressed="host.failNextUpload.value" @click="host.failNextUpload.value = !host.failNextUpload.value">下次上传失败</Button>
            <Button size="sm" variant="secondary" data-lab-action="reset-skills" @click="host.skillsLoaded.value = false">技能改回未加载</Button>
        </div>
    </LabFixtureControls>
</template>
