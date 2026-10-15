<script setup lang="ts">
import {CATPPUCCIN_ICONS} from "nbook/ui/file-icons/catppuccin";
import type {CatppuccinIcon} from "nbook/ui/file-icons/catppuccin";
import FileIcon from "nbook/ui/file-icons/FileIcon.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof FileIcon>(() => props.input);
const names = Object.keys(CATPPUCCIN_ICONS) as CatppuccinIcon[];
</script>

<template>
    <div class="flex h-full w-full flex-col gap-4 overflow-auto p-4 text-xs text-[var(--text-main)]">
        <div class="flex items-center gap-2">
            <FileIcon data-lab-subject v-bind="subject.bindings.value" />
            <span class="text-[var(--text-muted)]">被测的图标；下面是图标表里的全部图标，切换明暗看两套配色。</span>
        </div>
        <ul class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-1.5">
            <li v-for="name in names" :key="name" class="flex min-w-0 items-center gap-1.5">
                <FileIcon :icon="name" />
                <span class="truncate">{{ name }}</span>
            </li>
        </ul>
    </div>
</template>
