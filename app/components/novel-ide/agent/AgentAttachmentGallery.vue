<script setup lang="ts">
import type {PublicAttachmentDto} from "nbook/shared/dto/agent-public-event.dto";
import AgentAttachmentImage from "nbook/app/components/novel-ide/agent/AgentAttachmentImage.vue";

type AttachmentDisplay = {
    contentIndex: number;
    attachment: PublicAttachmentDto;
};

const props = defineProps<{
    attachments: AttachmentDisplay[];
    sessionId?: number | null;
    entryId: string;
}>();
</script>

<template>
    <div v-if="props.attachments.length > 0" class="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" aria-label="附件图片">
        <AgentAttachmentImage
            v-for="item in props.attachments"
            :key="`${props.entryId}:${item.contentIndex}`"
            :session-id="props.sessionId"
            :entry-id="props.entryId"
            :content-index="item.contentIndex"
            :attachment="item.attachment"
        />
    </div>
</template>
