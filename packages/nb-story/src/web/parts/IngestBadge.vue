<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import type {IngestStatusView} from "../../contract/contract";
import {ingestBadge} from "../host/ingest";

const props = defineProps<{status: Pick<IngestStatusView, "state" | "runner" | "stopReason">}>();
const badge = computed(() => ingestBadge(props.status));
const state = computed(() => (props.status.state === "running" ? (props.status.runner === "cli" ? "cli" : "running") : props.status.stopReason?.kind === "failed" ? "failed" : "stopped"));
</script>

<template>
    <Badge v-if="badge" size="sm" variant="soft" :tone="badge.tone" :dot="badge.dot" data-testid="ingest-badge" :data-state="state">{{ badge.text }}</Badge>
</template>
