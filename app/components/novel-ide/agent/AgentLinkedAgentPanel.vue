<script setup lang="ts">
import type {AgentLinkedSessionDto} from "nbook/shared/dto/agent-session.dto";

const props = defineProps<{
    sessionId: number | null;
    ownedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
    loading: boolean;
}>();

const emit = defineEmits<{
    (e: "select", sessionId: number): void;
    (e: "refresh"): void;
    (e: "close"): void;
}>();

const visibleOwnedAgents = computed(() => props.ownedAgents);
const visibleLinkedByAgents = computed(() => props.linkedByAgents);
const totalRelations = computed(() => visibleOwnedAgents.value.length + visibleLinkedByAgents.value.length);
const {t} = useI18n();

const profileLabel = (profileKey: string) => {
    switch(profileKey) {
        case "leader.default": return t("agent.linkedAgents.mainDispatcher");
        case "leader.assets": return t("agent.linkedAgents.userAssetsAssistant");
        case "writer": return t("agent.linkedAgents.writerAgent");
        case "retrieval": return t("agent.linkedAgents.retrievalAgent");
        default: return profileKey;
    }
};

const statusDotClass = (status: AgentLinkedSessionDto["status"], detached: boolean) => {
    if (detached) return "bg-[var(--text-muted)]";
    switch (status) {
        case "running": return "animate-pulse bg-blue-500";
        case "waiting": return "animate-pulse bg-amber-500";
        case "interrupted": return "bg-rose-500";
        case "archived": return "bg-[var(--text-muted)]";
        default: return "bg-green-500";
    }
};

const statusLabel = (status: AgentLinkedSessionDto["status"], detached: boolean) => {
    if (detached) return t("agent.linkedAgents.detached");
    switch (status) {
        case "running": return t("agent.linkedAgents.running");
        case "waiting": return t("agent.linkedAgents.waiting");
        case "interrupted": return t("agent.linkedAgents.interrupted");
        case "archived": return t("agent.linkedAgents.archived");
        default: return t("agent.linkedAgents.idle");
    }
};

const profileAvailabilityLabel = (session: AgentLinkedSessionDto): string | null => {
    if (!session.profileAvailability || session.profileAvailability === "loaded") {
        return null;
    }
    return session.profileAvailability === "missing" ? t("agent.session.profileMissing") : t("agent.session.profileUnavailable");
};

const profileAvailabilityTitle = (session: AgentLinkedSessionDto): string => {
    return session.profileIssueMessage
        ? `${session.profileKey}: ${session.profileIssueMessage}`
        : session.profileKey;
};
</script>

<template>
    <div class="absolute right-3 top-14 z-50 flex max-h-[min(70vh,620px)] w-[min(520px,calc(100%-1.5rem))] flex-col gap-3 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-main)] p-4 shadow-2xl" @click.stop>
        <!-- Linked agents 标题栏 -->
        <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-xs font-semibold tracking-wider text-[var(--accent-text)]">
                <span class="i-lucide-boxes h-4 w-4"></span>
                {{ t("agent.linkedAgents.title") }}
                <span v-if="totalRelations" class="rounded-sm bg-[var(--accent-main)] px-1.5 py-0.5 text-[9px] font-bold text-white">{{ totalRelations }}</span>
            </span>
            <div class="flex shrink-0 gap-1.5">
                <button class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :disabled="props.loading" :title="t('agent.linkedAgents.refresh')" @click.stop="emit('refresh')">
                    <span class="i-lucide-refresh-cw h-4 w-4"></span>
                </button>
                <button class="ml-1 flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click.stop="emit('close')">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </div>

        <div v-if="totalRelations > 0" class="max-h-[260px] space-y-3 overflow-y-auto pr-1 custom-scrollbar">
            <!-- 当前 session 绑定出去的 Agent -->
            <section>
                <div class="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    <span>{{ t("agent.linkedAgents.owned") }}</span>
                    <span>{{ visibleOwnedAgents.length }}</span>
                </div>
                <div v-if="visibleOwnedAgents.length > 0" class="space-y-2">
                    <button v-for="item in visibleOwnedAgents" :key="`owned-${item.sessionId}`" type="button" class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] hover:shadow-sm" :class="item.detached ? 'border-[var(--border-color)] bg-[var(--bg-panel)] opacity-65' : 'border-[var(--border-color)] bg-[var(--bg-panel)]'" @click.stop="emit('select', item.sessionId)">
                        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--border-color)] bg-[var(--bg-input)] transition-colors group-hover:border-[var(--accent-main)] group-hover:bg-[var(--accent-bg)]">
                            <span class="i-lucide-arrow-up-right h-4 w-4 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]"></span>
                        </div>
                        <div class="flex min-w-0 flex-1 flex-col justify-center">
                            <div class="flex items-center gap-2">
                                <span class="truncate text-xs font-medium text-[var(--text-main)] transition-colors group-hover:text-[var(--accent-main)]">{{ item.title || `Agent #${item.sessionId}` }}</span>
                                <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ profileLabel(item.profileKey) }}</span>
                                <span v-if="profileAvailabilityLabel(item)" class="inline-flex shrink-0 items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300" :title="profileAvailabilityTitle(item)">
                                    <span class="i-lucide-lock h-3 w-3"></span>
                                    {{ profileAvailabilityLabel(item) }}
                                </span>
                            </div>
                            <div class="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)] opacity-70">sessionId: {{ item.sessionId }}</div>
                        </div>
                        <div class="flex shrink-0 items-center gap-1.5 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 transition-colors group-hover:border-[var(--accent-main)]/30">
                            <span class="h-1.5 w-1.5 rounded-full" :class="statusDotClass(item.status, item.detached)"></span>
                            <span class="text-[10px] font-medium text-[var(--text-main)]">{{ statusLabel(item.status, item.detached) }}</span>
                        </div>
                    </button>
                </div>
                <div v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)] py-4 text-center text-[11px] text-[var(--text-muted)]">
                    {{ t("agent.linkedAgents.noOwned") }}
                </div>
            </section>

            <!-- 绑定当前 session 的上游 Agent -->
            <section>
                <div class="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    <span>{{ t("agent.linkedAgents.linkedBy") }}</span>
                    <span>{{ visibleLinkedByAgents.length }}</span>
                </div>
                <div v-if="visibleLinkedByAgents.length > 0" class="space-y-2">
                    <button v-for="item in visibleLinkedByAgents" :key="`owner-${item.sessionId}`" type="button" class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] hover:shadow-sm" :class="item.detached ? 'border-[var(--border-color)] bg-[var(--bg-panel)] opacity-65' : 'border-[var(--border-color)] bg-[var(--bg-panel)]'" @click.stop="emit('select', item.sessionId)">
                        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--border-color)] bg-[var(--bg-input)] transition-colors group-hover:border-[var(--accent-main)] group-hover:bg-[var(--accent-bg)]">
                            <span class="i-lucide-arrow-down-left h-4 w-4 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]"></span>
                        </div>
                        <div class="flex min-w-0 flex-1 flex-col justify-center">
                            <div class="flex items-center gap-2">
                                <span class="truncate text-xs font-medium text-[var(--text-main)] transition-colors group-hover:text-[var(--accent-main)]">{{ item.title || `Agent #${item.sessionId}` }}</span>
                                <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ profileLabel(item.profileKey) }}</span>
                                <span v-if="profileAvailabilityLabel(item)" class="inline-flex shrink-0 items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300" :title="profileAvailabilityTitle(item)">
                                    <span class="i-lucide-lock h-3 w-3"></span>
                                    {{ profileAvailabilityLabel(item) }}
                                </span>
                            </div>
                            <div class="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)] opacity-70">sessionId: {{ item.sessionId }}</div>
                        </div>
                        <div class="flex shrink-0 items-center gap-1.5 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 transition-colors group-hover:border-[var(--accent-main)]/30">
                            <span class="h-1.5 w-1.5 rounded-full" :class="statusDotClass(item.status, item.detached)"></span>
                            <span class="text-[10px] font-medium text-[var(--text-main)]">{{ statusLabel(item.status, item.detached) }}</span>
                        </div>
                    </button>
                </div>
                <div v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)] py-4 text-center text-[11px] text-[var(--text-muted)]">
                    {{ t("agent.linkedAgents.noLinkedBy") }}
                </div>
            </section>
        </div>

        <!-- 空状态 -->
        <div v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)] py-8 text-center text-xs text-[var(--text-muted)]">
            {{ t("agent.linkedAgents.empty") }}
        </div>
    </div>
</template>
