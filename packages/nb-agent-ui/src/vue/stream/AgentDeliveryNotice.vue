<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {useAgentText} from "../host";

const emit = defineEmits<{
    (e: "resend"): void;
    (e: "dismiss"): void;
}>();

const {t} = useAgentText();
</script>

<template>
    <div class="acv-delivery" role="status">
        <span class="acv-delivery__text">
            <span class="i-lucide-triangle-alert acv-delivery__icon" aria-hidden="true" />{{ t("user.deliveryUnknown") }}
        </span>
        <span class="acv-delivery__actions">
            <Button size="sm" variant="subtle" icon-class="i-lucide-send-horizontal" @click="emit('resend')">{{ t("user.resend") }}</Button>
            <Button size="sm" variant="ghost" icon-class="i-lucide-x" @click="emit('dismiss')">{{ t("user.dismiss") }}</Button>
        </span>
    </div>
</template>

<style scoped>
.acv-delivery {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-width: 0;
    color: var(--status-warning);
    font-size: var(--text-xs);
}

.acv-delivery__text {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}

.acv-delivery__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
}

.acv-delivery__actions {
    display: inline-flex;
    gap: 4px;
}
</style>
