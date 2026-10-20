<script setup lang="ts">
/**
 * 页面根上的通知视口（同名 .md）：把工作台通知服务的队列交给 nb-ui 的视口显示在右下角。
 * 单独一个组件而不是在插件入口里直接渲染 nb-ui 组件：插件入口在无 DOM 的编译组里，nb-ui 的组件总出口要 DOM 类型。
 */
import {NotificationStack} from "@notnotype/nb-ui/components";
import type {NotificationQueue} from "@notnotype/nb-ui/notifications";

defineOptions({name: "WorkbenchNotifications"});

defineProps<{
    queue: NotificationQueue;
}>();
</script>

<template>
    <NotificationStack :queue="queue" position="bottom-right" />
</template>
