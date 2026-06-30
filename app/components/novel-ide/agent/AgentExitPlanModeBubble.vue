<script setup lang="ts">
import type {AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "nbook/app/components/novel-ide/agent/request-user-input-context";
import {RequestUserInputToolAnswerSchema} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/AgentMarkdownContent.vue";
import {z} from "zod";

const NONE_OF_ABOVE_OPTION_INDEX = -1;
const REJECT_OPTION_INDEX = 1;
const APPROVE_OPTION_INDEX = 0;

const ExitPlanModePreviewDataSchema = z.object({
    planFilePath: z.string().optional(),
    planContent: z.string().optional(),
});

const ExitPlanModeRawResultSchema = z.object({
    answers: z.array(RequestUserInputToolAnswerSchema).optional(),
    approved: z.boolean().optional(),
    planFilePath: z.string().optional(),
    planContent: z.string().optional(),
    data: z.unknown().optional(),
});

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

const userInputContext = inject(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, null);
const showApprovedPreview = ref(false);
const {t} = useI18n();

/**
 * 当前 exit_plan_mode 是否仍在等待审批。
 */
const pendingQuestion = computed(() => {
    return userInputContext?.pendingSession.value?.questions.find((question) => question.toolNodeId === props.toolCall.id) ?? null;
});

const isPendingQuestion = computed(() => {
    return Boolean(
        pendingQuestion.value
        && userInputContext?.pendingSession.value?.assistantMessageId === props.toolCall.assistantMessageId,
    );
});

const parsedRawResult = computed(() => {
    const parsed = ExitPlanModeRawResultSchema.safeParse(props.toolCall.rawResult);
    return parsed.success ? parsed.data : null;
});

const parsedPreviewData = computed(() => {
    const parsed = ExitPlanModePreviewDataSchema.safeParse(parsedRawResult.value?.data);
    return parsed.success ? parsed.data : null;
});

const planFilePath = computed(() => {
    return pendingQuestion.value?.planFilePath ?? parsedRawResult.value?.planFilePath ?? parsedPreviewData.value?.planFilePath ?? "";
});

const planContent = computed(() => {
    return pendingQuestion.value?.planContent ?? parsedRawResult.value?.planContent ?? parsedPreviewData.value?.planContent ?? "";
});

const hasPlanFilePreview = computed(() => Boolean(planFilePath.value && planContent.value));
const hasPlanFileArgument = computed(() => Boolean(planFilePath.value));

const parsedAnswer = computed(() => {
    const answer = parsedRawResult.value?.answers?.[0];
    if (answer) {
        return answer;
    }
    try {
        return RequestUserInputToolAnswerSchema.parse(props.toolCall.rawResult);
    } catch {
        return null;
    }
});

const questionOptions = computed(() => {
    return pendingQuestion.value?.options ?? [];
});

const selectedIndexes = computed(() => {
    if (!parsedAnswer.value) {
        return [];
    }
    return parsedAnswer.value.selectedOptionIndex === undefined ? [] : [parsedAnswer.value.selectedOptionIndex];
});

function selectedOptionLabel(optionIndex: number): string {
    if (optionIndex === NONE_OF_ABOVE_OPTION_INDEX) {
        return t("agent.planApproval.addSuggestion");
    }
    const optionLabel = questionOptions.value[optionIndex]?.label;
    if (optionLabel) {
        return optionLabel;
    }
    if (optionIndex === APPROVE_OPTION_INDEX) {
        return t("agent.planApproval.approve");
    }
    if (optionIndex === REJECT_OPTION_INDEX) {
        return t("agent.planApproval.reject");
    }
    return String(optionIndex);
}

const selectedLabel = computed(() => {
    if (!parsedAnswer.value) {
        return "";
    }
    if (parsedAnswer.value.ignored) {
        return t("agent.planApproval.ignored");
    }
    if (selectedIndexes.value.length === 0) {
        return t("agent.planApproval.openAnswer");
    }
    return selectedIndexes.value.map(selectedOptionLabel).join(t("agent.planApproval.separator"));
});

const shouldShowPlanPreview = computed(() => {
    return isPendingQuestion.value || showApprovedPreview.value;
});

const planSummary = computed(() => {
    const source = planContent.value;
    return source
        .split(/\r?\n/)
        .map((line) => line
            .replace(/^#{1,6}\s+/, "")
            .replace(/^\s*[-*+]\s+/, "")
            .replace(/^\s*\d+[.)]\s+/, "")
            .replace(/`{1,3}/g, "")
            .trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" / ");
});

const statusLabel = computed(() => {
    if (isPendingQuestion.value) {
        return hasPlanFileArgument.value ? t("agent.planApproval.pendingFile") : t("agent.planApproval.pendingChat");
    }
    if (!parsedAnswer.value) {
        if (parsedRawResult.value?.approved === true) {
            return t("agent.planApproval.approved");
        }
        if (parsedRawResult.value?.approved === false) {
            return t("agent.planApproval.rejected");
        }
        return hasPlanFileArgument.value ? t("agent.planApproval.fileApproval") : t("agent.planApproval.chatApproval");
    }
    if (parsedAnswer.value.ignored) {
        return t("agent.planApproval.paused");
    }
    if (selectedIndexes.value.includes(APPROVE_OPTION_INDEX)) {
        return t("agent.planApproval.approved");
    }
    if (selectedIndexes.value.includes(NONE_OF_ABOVE_OPTION_INDEX)) {
        return t("agent.planApproval.suggestionAdded");
    }
    if (selectedIndexes.value.includes(REJECT_OPTION_INDEX) || parsedRawResult.value?.approved === false) {
        return t("agent.planApproval.rejected");
    }
    return t("agent.planApproval.suggestionAdded");
});
</script>

<template>
    <!-- exit_plan_mode 正文式计划审批预览 -->
    <div class="min-w-0 w-full">
        <div class="min-w-0 w-full rounded-xl border border-[var(--border-color)] bg-[var(--agent-bg)] px-3 py-2.5 shadow-sm">
            <div class="mb-1.5 flex min-w-0 items-center gap-2 text-[11px] leading-5 text-[var(--text-muted)]">
                <span :class="isPendingQuestion ? 'i-lucide-clock text-amber-600' : 'i-lucide-file-check-2 text-emerald-600'" class="h-3.5 w-3.5 shrink-0"></span>
                <span class="shrink-0 font-medium text-[var(--text-main)]">{{ statusLabel }}</span>
                <span v-if="planFilePath" class="min-w-0 truncate font-mono text-[11px] text-[var(--text-muted)]">{{ planFilePath }}</span>
                <button
                    v-if="!isPendingQuestion && planContent"
                    class="ml-auto shrink-0 rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    type="button"
                    :title="showApprovedPreview ? t('agent.planApproval.collapsePreview') : t('agent.planApproval.expandPreview')"
                    @click="showApprovedPreview = !showApprovedPreview"
                >
                    <span :class="showApprovedPreview ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
                </button>
            </div>

            <div v-if="shouldShowPlanPreview && hasPlanFilePreview" class="max-h-[320px] min-w-0 overflow-y-auto pr-2 text-xs leading-relaxed text-[var(--text-main)]">
                <AgentMarkdownContent :content="planContent" />
            </div>
            <div v-else-if="planSummary" class="line-clamp-2 break-words text-xs leading-5 text-[var(--text-secondary)]">
                {{ planSummary || t("agent.planApproval.collapsed") }}
            </div>
            <div v-else class="text-xs leading-5 text-[var(--text-muted)]">
                {{ hasPlanFileArgument ? t("agent.planApproval.noFileContent") : t("agent.planApproval.noChatContent") }}
            </div>

            <div v-if="isPendingQuestion" class="mt-2 flex items-center gap-2 text-[11px] leading-5 text-amber-700">
                <span class="i-lucide-clock h-3.5 w-3.5 shrink-0"></span>
                <span>{{ t("agent.planApproval.waiting") }}</span>
            </div>
            <div v-else-if="parsedAnswer" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-5 text-[var(--text-muted)]">
                <span>{{ t("agent.planApproval.choice", {label: selectedLabel}) }}</span>
                <span v-if="parsedAnswer.note">{{ t("agent.planApproval.note", {note: parsedAnswer.note}) }}</span>
            </div>
        </div>
    </div>
</template>
