<script setup lang="ts">
import {onClickOutside} from "@vueuse/core";
import type {WorkflowAgentSnapshot} from "nbook/app/components/novel-ide/agent/AgentChatSurface.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {useWorkflowApi} from "nbook/app/composables/useWorkflowApi";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {WorkflowRunDto, WorkflowSummaryDto} from "nbook/shared/dto/workflow.dto";

type RunnerStatusTone = "idle" | "info" | "success";

type RunnerStatusPresentation = {
    label: string;
    iconClass: string;
    tone: RunnerStatusTone;
};

const props = defineProps<{
    agentSnapshot?: WorkflowAgentSnapshot | null;
}>();

const emit = defineEmits<{
    (e: "open-agent"): void;
    (e: "run-agent", prompt: string): void;
}>();

const {t} = useI18n();
const workflowApi = useWorkflowApi();
const notification = useNotification();
const novelIdeStore = useNovelIdeStore();

const workflows = ref<WorkflowSummaryDto[]>([]);
const runs = ref<WorkflowRunDto[]>([]);
const selectedWorkflowId = ref("");
const targetFilePath = ref("");
const targetFilePathTouched = ref(false);
const workflowGoal = ref("");
const shouldUpdateProjectState = ref(true);
const shouldPauseForConfirmation = ref(true);
const loading = ref(false);
const actionId = ref("");
const monitoredRunId = ref("");
const monitoredSessionId = ref<number | null>(null);
const historyOpen = ref(false);
const historyRootRef = ref<HTMLElement | null>(null);

const projectPath = computed(() => novelIdeStore.currentNovelId);
const manuscriptFiles = computed(() => novelIdeStore.workspaceTree
    .filter((node) => !node.isDirectory && isManuscriptMarkdown(node.path))
    .sort((left, right) => left.path.localeCompare(right.path)));
const targetFile = computed(() => manuscriptFiles.value.find((file) => file.path === targetFilePath.value) ?? null);
const targetTitle = computed(() => targetFile.value?.title.trim() || targetFilePath.value || t("ide.workflow.runner.noTarget"));
const targetPath = computed(() => targetFile.value?.path || targetFilePath.value);
const monitoredRun = computed(() => runs.value.find((run) => run.id === monitoredRunId.value) ?? null);
const agentBusy = computed(() => props.agentSnapshot?.running ?? false);
const monitoredAgentRunning = computed(() => {
    const snapshot = props.agentSnapshot;
    if (!snapshot?.running || !monitoredRunId.value) {
        return false;
    }
    return monitoredSessionId.value === null || snapshot.sessionId === monitoredSessionId.value;
});
const startButtonBusy = computed(() => actionId.value === "run-writing-agent" || agentBusy.value);
const startButtonDisabled = computed(() => Boolean(actionId.value) || agentBusy.value || !targetFilePath.value);
const startButtonLabel = computed(() => {
    if (actionId.value === "run-writing-agent") {
        return t("ide.workflow.runner.sending");
    }
    if (agentBusy.value) {
        return t("ide.workflow.runner.agentRunning");
    }
    return t("ide.workflow.runner.start");
});
const runnerStatus = computed<RunnerStatusPresentation>(() => {
    if (actionId.value === "run-writing-agent") {
        return {label: t("ide.workflow.runner.statusSending"), iconClass: "i-lucide-loader-2 animate-spin", tone: "info"};
    }
    if (monitoredAgentRunning.value) {
        return {label: t("ide.workflow.runner.statusRunning"), iconClass: "i-lucide-loader-2 animate-spin", tone: "info"};
    }
    if (monitoredRunId.value && monitoredRun.value?.agentCompletedAt) {
        return {label: t("ide.workflow.runner.statusFinished"), iconClass: "i-lucide-check", tone: "success"};
    }
    if (monitoredRunId.value && monitoredRun.value?.agentStartedAt) {
        return {label: t("ide.workflow.runner.statusSent"), iconClass: "i-lucide-send", tone: "info"};
    }
    if (agentBusy.value) {
        return {label: t("ide.workflow.runner.statusAgentBusy"), iconClass: "i-lucide-loader-2 animate-spin", tone: "info"};
    }
    return {label: t("ide.workflow.runner.statusIdle"), iconClass: "i-lucide-circle", tone: "idle"};
});
const agentSessionText = computed(() => {
    const snapshot = props.agentSnapshot;
    if (!snapshot?.sessionId) {
        return t("ide.workflow.runner.sessionOnSend");
    }
    return snapshot.sessionTitle || `Session #${String(snapshot.sessionId)}`;
});
const agentSessionDetail = computed(() => [props.agentSnapshot?.profileLabel, props.agentSnapshot?.modelLabel].filter(Boolean).join(" · "));
const agentSnapshotSignature = computed(() => JSON.stringify({
    sessionId: props.agentSnapshot?.sessionId ?? null,
    running: props.agentSnapshot?.running ?? false,
}));

onClickOutside(historyRootRef, () => {
    historyOpen.value = false;
});

/** 加载当前 Project Workspace 的 Workflow 定义。 */
async function loadWorkflows(): Promise<void> {
    if (!projectPath.value || loading.value) {
        return;
    }
    loading.value = true;
    try {
        const response = await workflowApi.list(projectPath.value);
        workflows.value = response.workflows;
        if (!selectedWorkflowId.value || !workflows.value.some((workflow) => workflow.id === selectedWorkflowId.value)) {
            selectedWorkflowId.value = workflows.value[0]?.id ?? "";
        }
        await loadRuns();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.workflow.loadFailed")));
    } finally {
        loading.value = false;
    }
}

/** 加载当前 Workflow 的运行历史。 */
async function loadRuns(): Promise<void> {
    if (!projectPath.value || !selectedWorkflowId.value) {
        runs.value = [];
        return;
    }
    const response = await workflowApi.listRuns(projectPath.value, selectedWorkflowId.value);
    runs.value = response.runs;
}

/** 确保默认 Workflow 和一个可复用的 active run 已存在。 */
async function ensureActiveWorkflowRun(): Promise<WorkflowRunDto> {
    if (!projectPath.value) {
        throw new Error(t("ide.workflow.runner.noProject"));
    }
    let workflowId = selectedWorkflowId.value;
    if (!workflowId) {
        const workflow = await workflowApi.createDefault(projectPath.value);
        selectedWorkflowId.value = workflow.id;
        workflowId = workflow.id;
        await loadWorkflows();
    }
    let run = runs.value.find((candidate) => candidate.workflowId === workflowId && candidate.status === "active") ?? null;
    if (!run) {
        run = await workflowApi.startRun(projectPath.value, workflowId);
    }
    await loadRuns();
    return run;
}

/** 把本轮任务发送给当前 Agent session。 */
async function runWritingWorkflowWithAgent(): Promise<void> {
    if (!projectPath.value || startButtonDisabled.value) {
        return;
    }
    actionId.value = "run-writing-agent";
    try {
        const run = await ensureActiveWorkflowRun();
        const goal = workflowGoal.value.trim();
        await mergeRunRecord({
            runId: run.id,
            targetFilePath: targetFilePath.value,
            targetFileTitle: targetFile.value?.title ?? "",
            goal,
            agentStartedAt: new Date().toISOString(),
        });
        emit("run-agent", buildWritingWorkflowPrompt(run, goal));
        workflowGoal.value = "";
        monitorAgentRun(run.id);
        notification.info(t("ide.workflow.runner.sent"), {title: t("ide.workflow.runner.sentTitle")});
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.workflow.agentPromptFailed")));
    } finally {
        actionId.value = "";
    }
}

/** 生成交给 Agent 的完整章节写作任务。 */
function buildWritingWorkflowPrompt(run: WorkflowRunDto, goal: string): string {
    const selectedPath = novelIdeStore.selectedFilePath || "";
    const currentStep = run.steps.find((step) => step.status === "active") ?? run.steps[0] ?? null;
    const steps = run.steps.map((step, index) => `${index + 1}. ${step.title}${step.status === "active" ? " [current]" : ""}: ${step.description || step.prompt || ""}`).join("\n");
    return [
        "你正在执行 NeuroBook 的章节写作 Workflow。请把这当成完整写作任务处理，直接推进项目文件，而不是解释流程。",
        "",
        "本次目标：",
        `- Project Workspace: ${projectPath.value}`,
        `- 目标正文文件: ${targetFilePath.value}`,
        targetFile.value?.title ? `- 目标正文标题: ${targetFile.value.title}` : "",
        selectedPath ? `- 当前选中文件: ${selectedPath}` : "- 当前选中文件: none",
        goal ? `- 用户写作目标: ${goal}` : "- 用户写作目标: 未填写，请根据目标文件和上下文自行归纳本轮最小目标",
        `- 当前 Workflow run: ${run.id}`,
        currentStep ? `- 当前步骤: ${currentStep.title} (${currentStep.stepId})` : "- 当前步骤: 未知",
        "",
        "Workflow 步骤快照：",
        steps || "- 无步骤快照",
        "",
        "执行方式：",
        "1. 先读取目标正文文件；如果目标文件缺失，明确说明最小阻塞。",
        "2. 主动读取相关 Plot、World Engine、Lorebook、前后章节或章节 brief，不要只依赖用户输入。",
        "3. 判断本轮应该是续写、初稿、修订还是回补；然后直接对正文或项目文件做必要修改。",
        "4. 修改正文时保持现有文风、叙事视角、章节结构和 Markdown/frontmatter 约定。",
        shouldUpdateProjectState.value
            ? "5. 如果正文变更引入了新的剧情事实、角色状态或世界状态，请同步检查并更新 Plot / World Engine；需要用户拍板的事实先明确列出。"
            : "5. 本轮不要主动更新 Plot / World Engine，只在结尾列出建议回补项。",
        shouldPauseForConfirmation.value
            ? "6. 遇到重大剧情方向、角色动机或世界状态分歧时先停下问用户；小的文字修订和连续性修正可以直接做。"
            : "6. 除非目标完全缺失，否则尽量完成一轮端到端修改，不要频繁停下来等待确认。",
        "7. 结束时用简短清单说明：完成了什么、修改了哪些文件、哪些 Workflow 步骤可以标记完成、还需要用户确认什么。",
    ].filter(Boolean).join("\n");
}

/** 开始监视本轮使用的 Agent session。 */
function monitorAgentRun(runId: string): void {
    monitoredRunId.value = runId;
    monitoredSessionId.value = props.agentSnapshot?.sessionId ?? null;
    void syncAgentSessionToRun();
}

/** 把实际使用的 Agent session id 写入运行记录。 */
async function syncAgentSessionToRun(): Promise<void> {
    const snapshot = props.agentSnapshot;
    const run = runs.value.find((candidate) => candidate.id === monitoredRunId.value) ?? null;
    if (!snapshot?.sessionId || !run) {
        return;
    }
    if (monitoredSessionId.value === null) {
        monitoredSessionId.value = snapshot.sessionId;
    }
    if (monitoredSessionId.value !== snapshot.sessionId || run.agentSessionId === snapshot.sessionId) {
        return;
    }
    await mergeRunRecord({runId: run.id, agentSessionId: snapshot.sessionId});
}

/** 合并运行记录并刷新本地历史。 */
async function mergeRunRecord(input: Omit<Parameters<typeof workflowApi.recordRun>[0], "projectPath" | "workflowId">): Promise<void> {
    if (!projectPath.value || !selectedWorkflowId.value) {
        return;
    }
    const run = await workflowApi.recordRun({
        projectPath: projectPath.value,
        workflowId: selectedWorkflowId.value,
        ...input,
    });
    runs.value = [run, ...runs.value.filter((candidate) => candidate.id !== run.id)];
}

/** 处理目标章节的手动选择。 */
function updateTargetSelection(value: string): void {
    targetFilePath.value = value;
    targetFilePathTouched.value = true;
}

/** 恢复跟随编辑器当前章节。 */
function followCurrentTarget(): void {
    targetFilePathTouched.value = false;
    const selectedPath = novelIdeStore.selectedFilePath;
    targetFilePath.value = isManuscriptMarkdown(selectedPath) ? selectedPath : "";
}

/** 判断路径是否是正文 Markdown。 */
function isManuscriptMarkdown(path: string): boolean {
    const normalized = path.replaceAll("\\", "/").toLowerCase();
    return normalized.startsWith("manuscript/") && normalized.endsWith(".md");
}

/** 生成目标选择器中的章节标签。 */
/** 格式化运行记录时间。 */
function formatRunTime(value: string | null | undefined): string {
    if (!value) {
        return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return new Intl.DateTimeFormat(undefined, {month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"}).format(date);
}

watch(() => [novelIdeStore.selectedFilePath, manuscriptFiles.value.map((file) => file.path).join("\n")] as const, () => {
    if (targetFilePathTouched.value) {
        return;
    }
    const selectedPath = novelIdeStore.selectedFilePath;
    targetFilePath.value = isManuscriptMarkdown(selectedPath) ? selectedPath : "";
}, {immediate: true});

watch(projectPath, () => {
    workflows.value = [];
    runs.value = [];
    selectedWorkflowId.value = "";
    monitoredRunId.value = "";
    monitoredSessionId.value = null;
    targetFilePathTouched.value = false;
    targetFilePath.value = "";
    void loadWorkflows();
}, {immediate: true});

watch(agentSnapshotSignature, async (signature, previousSignature) => {
    if (!monitoredRunId.value) {
        return;
    }
    const snapshot = JSON.parse(signature) as {sessionId: number | null; running: boolean};
    const previous = previousSignature ? JSON.parse(previousSignature) as {sessionId: number | null; running: boolean} : null;
    await syncAgentSessionToRun();
    if (previous?.running
        && !snapshot.running
        && previous.sessionId === monitoredSessionId.value
        && snapshot.sessionId === monitoredSessionId.value) {
        await mergeRunRecord({
            runId: monitoredRunId.value,
            agentCompletedAt: new Date().toISOString(),
        });
    }
});
</script>

<template>
    <!-- 章节写作运行器：底部任务编辑器与真实 Agent 状态。 -->
    <div class="workflow-runner h-full min-h-0 bg-[var(--bg-panel)]">
        <div class="runner-shell">
            <!-- 运行器工具栏 -->
            <header class="runner-toolbar">
                <div class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-route h-4 w-4 shrink-0 text-[var(--accent-main)]"></span>
                    <span class="truncate text-xs font-semibold text-[var(--text-main)]">{{ t("ide.workflow.runner.title") }}</span>
                    <span class="runner-status" :class="`runner-status--${runnerStatus.tone}`">
                        <span :class="runnerStatus.iconClass" class="h-3 w-3"></span>
                        <span>{{ runnerStatus.label }}</span>
                    </span>
                </div>

                <div class="ml-auto flex min-w-0 items-center gap-1">
                    <button type="button" class="agent-session-button" :title="agentSessionDetail || agentSessionText" @click="emit('open-agent')">
                        <span class="i-lucide-bot h-3.5 w-3.5 shrink-0"></span>
                        <span class="truncate">{{ agentSessionText }}</span>
                        <span v-if="agentSessionDetail" class="agent-session-detail truncate text-[var(--text-muted)]">· {{ agentSessionDetail }}</span>
                    </button>
                    <div ref="historyRootRef" class="relative shrink-0">
                        <button type="button" class="toolbar-icon-button" :title="t('ide.workflow.runner.history')" @click="historyOpen = !historyOpen">
                            <span class="i-lucide-history h-4 w-4"></span>
                        </button>
                        <div v-if="historyOpen" class="history-menu">
                            <div class="history-menu-title">{{ t("ide.workflow.runner.history") }}</div>
                            <div v-if="runs.length === 0" class="px-3 py-5 text-center text-xs text-[var(--text-muted)]">{{ t("ide.workflow.runner.noHistory") }}</div>
                            <div v-else class="max-h-56 overflow-auto py-1">
                                <div v-for="run in runs.slice(0, 12)" :key="run.id" class="history-row">
                                    <div class="flex items-center gap-2">
                                        <span :class="run.agentCompletedAt ? 'i-lucide-check text-[var(--status-success)]' : 'i-lucide-clock-3 text-[var(--status-info)]'" class="h-3.5 w-3.5 shrink-0"></span>
                                        <span class="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-main)]">{{ run.targetFileTitle || run.targetFilePath || t("ide.workflow.runner.noTarget") }}</span>
                                        <time class="shrink-0 text-[10px] text-[var(--text-muted)]">{{ formatRunTime(run.agentCompletedAt || run.agentStartedAt || run.createdAt) }}</time>
                                    </div>
                                    <div v-if="run.targetFilePath" class="mt-0.5 truncate pl-5 font-mono text-[10px] text-[var(--text-muted)]">{{ run.targetFilePath }}</div>
                                    <div v-if="run.goal" class="mt-1 line-clamp-2 pl-5 text-[11px] leading-4 text-[var(--text-secondary)]">{{ run.goal }}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <!-- 当前 Workflow 运行状态 -->
            <div v-if="monitoredRun" class="run-strip" :class="monitoredAgentRunning ? 'run-strip--running' : monitoredRun.agentCompletedAt ? 'run-strip--finished' : 'run-strip--sent'">
                <span :class="monitoredAgentRunning ? 'i-lucide-loader-2 animate-spin' : monitoredRun.agentCompletedAt ? 'i-lucide-check-circle-2' : 'i-lucide-send'" class="h-4 w-4 shrink-0"></span>
                <div class="min-w-0 flex-1">
                    <div class="truncate text-xs font-medium">
                        {{ monitoredAgentRunning ? t("ide.workflow.runner.runningTarget", {title: monitoredRun.targetFileTitle || monitoredRun.targetFilePath}) : monitoredRun.agentCompletedAt ? t("ide.workflow.runner.finishedTarget", {title: monitoredRun.targetFileTitle || monitoredRun.targetFilePath}) : t("ide.workflow.runner.sentTarget", {title: monitoredRun.targetFileTitle || monitoredRun.targetFilePath}) }}
                    </div>
                    <div v-if="monitoredRun.goal" class="truncate text-[10px] opacity-75">{{ monitoredRun.goal }}</div>
                </div>
                <time v-if="monitoredRun.agentCompletedAt" class="shrink-0 text-[10px] opacity-70">{{ formatRunTime(monitoredRun.agentCompletedAt) }}</time>
            </div>

            <!-- 目标章节与写作任务 -->
            <div class="runner-body">
                <section class="target-pane">
                    <WorkflowTargetSelector
                        :files="manuscriptFiles"
                        :model-value="targetFilePath"
                        :target-path="targetPath"
                        :target-title="targetTitle"
                        :touched="targetFilePathTouched"
                        @follow-current="followCurrentTarget"
                        @update:model-value="updateTargetSelection"
                    />
                </section>

                <section class="task-pane">
                    <label for="workflow-goal" class="field-label">{{ t("ide.workflow.runner.goal") }}</label>
                    <textarea id="workflow-goal" v-model="workflowGoal" class="workflow-goal" :placeholder="t('ide.workflow.runner.goalPlaceholder')"></textarea>
                    <div class="task-footer">
                        <div class="execution-options">
                            <label class="execution-option">
                                <input v-model="shouldUpdateProjectState" type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent-main)]">
                                <span>{{ t("ide.workflow.runner.updateProjectState") }}</span>
                            </label>
                            <label class="execution-option">
                                <input v-model="shouldPauseForConfirmation" type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent-main)]">
                                <span>{{ t("ide.workflow.runner.pauseForConfirmation") }}</span>
                            </label>
                        </div>
                        <button type="button" class="start-button" :disabled="startButtonDisabled" :title="!targetFilePath ? t('ide.workflow.runner.selectTargetFirst') : startButtonLabel" @click="void runWritingWorkflowWithAgent()">
                            <span :class="startButtonBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-sparkles'" class="h-4 w-4"></span>
                            <span>{{ startButtonLabel }}</span>
                        </button>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<style scoped>
.workflow-runner {
    container: workflow / inline-size;
}

.runner-shell {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    height: 100%;
    min-height: 0;
}

.runner-toolbar {
    position: relative;
    z-index: 30;
    display: flex;
    min-height: 34px;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--border-color);
    padding: 0 10px;
}

.runner-status {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 2px 6px;
    font-size: 10px;
    line-height: 1;
}

.runner-status--idle {
    color: var(--text-muted);
}

.runner-status--info {
    border-color: var(--status-info-border);
    background: var(--status-info-bg);
    color: var(--status-info);
}

.runner-status--success {
    border-color: var(--status-success-border);
    background: var(--status-success-bg);
    color: var(--status-success);
}

.agent-session-button,
.toolbar-icon-button {
    display: inline-flex;
    height: 26px;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border-radius: 6px;
    color: var(--text-secondary);
}

.agent-session-button {
    min-width: 0;
    max-width: 360px;
    padding: 0 7px;
    font-size: 10px;
}

.toolbar-icon-button {
    width: 26px;
}

.agent-session-button:hover,
.toolbar-icon-button:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.history-menu {
    position: absolute;
    top: calc(100% + 5px);
    right: 0;
    z-index: 60;
    width: min(360px, 70vw);
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-panel);
    box-shadow: 0 12px 30px color-mix(in srgb, var(--text-main) 14%, transparent);
}

.history-menu-title {
    border-bottom: 1px solid var(--border-color);
    padding: 8px 10px;
    color: var(--text-main);
    font-size: 11px;
    font-weight: 600;
}

.history-row {
    border-bottom: 1px solid var(--border-color);
    padding: 7px 10px;
}

.history-row:last-child {
    border-bottom: 0;
}

.run-strip {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--border-color);
    padding: 6px 10px;
}

.run-strip--running,
.run-strip--sent {
    border-color: var(--status-info-border);
    background: var(--status-info-bg);
    color: var(--status-info);
}

.run-strip--finished {
    border-color: var(--status-success-border);
    background: var(--status-success-bg);
    color: var(--status-success);
}

.runner-body {
    display: grid;
    min-height: 0;
    grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
    gap: 10px;
    overflow: hidden;
    padding: 9px 10px 10px;
}

.target-pane {
    min-width: 0;
    overflow: hidden;
    border-right: 1px solid var(--border-color);
    padding-right: 10px;
}

.field-label {
    display: block;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 16px;
}

.task-pane {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template-rows: auto minmax(62px, 1fr) auto;
    gap: 5px;
}

.workflow-goal {
    width: 100%;
    min-height: 62px;
    resize: none;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    padding: 8px 10px;
    color: var(--text-main);
    font-size: 13px;
    line-height: 20px;
    outline: none;
}

.workflow-goal:focus {
    border-color: var(--accent-main);
}

.workflow-goal::placeholder {
    color: var(--text-muted);
    opacity: 0.46;
}

.task-footer {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
}

.execution-options {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 12px;
    overflow: hidden;
}

.execution-option {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 5px;
    color: var(--text-secondary);
    font-size: 10px;
    white-space: nowrap;
}

.start-button {
    display: inline-flex;
    height: 30px;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 7px;
    background: var(--accent-main);
    padding: 0 14px;
    color: var(--text-inverse);
    font-size: 11px;
    font-weight: 600;
}

.start-button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
}

@container workflow (max-width: 760px) {
    .runner-body {
        grid-template-columns: minmax(0, 1fr);
        overflow: auto;
    }

    .target-pane {
        overflow: visible;
        border-right: 0;
        border-bottom: 1px solid var(--border-color);
        padding-right: 0;
        padding-bottom: 8px;
    }

    .task-pane {
        min-height: 150px;
    }

    .agent-session-button {
        max-width: 210px;
    }

    .agent-session-detail {
        display: none;
    }
}

@container workflow (max-width: 520px) {
    .runner-toolbar {
        padding: 0 7px;
    }

    .runner-status {
        display: none;
    }

    .agent-session-button {
        width: 26px;
        padding: 0;
    }

    .agent-session-button span:not(:first-child) {
        display: none;
    }

    .task-footer,
    .execution-options {
        align-items: stretch;
        flex-direction: column;
    }

    .execution-options {
        gap: 5px;
    }

    .start-button {
        width: 100%;
    }
}
</style>
