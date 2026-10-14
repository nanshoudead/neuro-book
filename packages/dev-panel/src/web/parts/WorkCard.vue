<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {relativeDay, taskLabel, workLabel} from "../host/format.js";
import {isPlainClick, workHref} from "../host/routes.js";
import {useSessionTitles} from "../host/session-titles.js";
import type {OverviewWork} from "../host/types.js";
import BranchNote from "./BranchNote.vue";
import EphemeralFrame from "./EphemeralFrame.vue";
import LeaseChip from "./LeaseChip.vue";
import StatusBar from "./StatusBar.vue";
import StatusChip from "./StatusChip.vue";

defineProps<{work: OverviewWork}>();
/** 会话标题由首页提供（t17）；没有提供时只显示短键。 */
const nameOf = useSessionTitles();
const emit = defineEmits<{navigate: [href: string]}>();
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}
</script>

<template>
    <article class="flex min-w-0 flex-col gap-2 rounded-[var(--radius-panel)] px-3.5 py-3 nbdev-surface">
        <header class="flex min-w-0 items-start gap-2">
            <StatusChip :status="work.status" />
            <a :href="workHref(work.workId)" class="nbdev-card-title min-w-0 flex-1 hover:underline focus-visible:underline" @click="follow($event, workHref(work.workId))">
                <span class="nbdev-secondary">{{ workLabel(work.workId) }}</span>
                {{ work.title ?? work.workId }}
            </a>
        </header>
        <p class="line-clamp-2" :class="work.goal.value ? 'nbdev-secondary' : 'nbdev-empty'">
            {{ work.goal.value ?? "目标：未标" }}
        </p>
        <StatusBar :counts="work.taskCounts" />
        <div class="flex flex-wrap items-center gap-2 nbdev-note">
            <Badge v-if="work.openRequired > 0" tone="warning" variant="soft" size="sm" icon-class="i-lucide-message-circle-question">待答 {{ work.openRequired }}</Badge>
            <span v-if="work.updated.value">最近更新 {{ relativeDay(work.updated.value) }}</span>
            <span class="nbdev-empty" v-else>最近更新：未标</span>
            <span v-if="work.uncommitted">· 有未提交的改动</span>
        </div>
        <BranchNote v-if="work.source === 'branch'" :branch="work.branch" :checkout-key="work.checkoutKey" />
        <EphemeralFrame v-if="work.activeLeases.length > 0" title="谁在动">
            <div class="flex flex-wrap gap-1.5">
                <LeaseChip v-for="lease in work.activeLeases" :key="`${lease.sessionKey}/${lease.taskId}`" :session="nameOf(lease.sessionKey, lease.label)" :task="taskLabel(lease.taskId)" :stale="lease.stale" />
            </div>
        </EphemeralFrame>
    </article>
</template>
