<script setup lang="ts">
import {InlineChip} from "@notnotype/nb-markdown/chip";

import {nbookChips} from "nbook/plugins/markdown/web/host";

import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof InlineChip>(() => props.input);
const events = useLabEventSink();
</script>

<template>
    <!-- 小块是行内的：放进一句正文里看它与字的对齐与截断。 -->
    <p class="w-full p-4 text-[17px] leading-[1.95] text-[var(--text-main)]">
        她翻到那一页，
        <InlineChip data-lab-subject v-bind="subject.bindings.value" :env="nbookChips" @activate="events('activate')" @hover="(active: boolean) => events('hover', {active})" />
        的名字就写在页边。
    </p>
</template>
