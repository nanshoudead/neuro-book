<script setup lang="ts">
import {MarkdownImage} from "@notnotype/nb-markdown/display";
import type {ResolveAsset} from "@notnotype/nb-markdown/display";

import {NBOOK_IMAGE_MISSING} from "nbook/plugins/markdown/web/host";

import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof MarkdownImage>(() => props.input);
const events = useLabEventSink();

/** 场景按地址给结果：`lab://loading` 一直读取中，`lab://outside` 不显示，`lab://broken` 加载失败，其余显示一张画出来的图。 */
const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#7287fd"/><text x="320" y="190" font-size="36" text-anchor="middle" fill="white">封面</text></svg>')}`;
const resolveAsset: ResolveAsset = (src) => {
    if (src === "lab://loading") return new Promise(() => undefined);
    if (src === "lab://outside") return Promise.resolve(null);
    if (src === "lab://broken") return Promise.resolve({url: "data:image/png;base64,broken", release: () => undefined});
    return Promise.resolve({url: PICTURE, release: () => undefined});
};
</script>

<template>
    <div class="w-full p-4 text-[17px] leading-[1.95] text-[var(--text-main)]">
        <MarkdownImage data-lab-subject v-bind="subject.bindings.value" :resolve-asset="resolveAsset" :missing="NBOOK_IMAGE_MISSING" @activate="events('activate')" />
    </div>
</template>
