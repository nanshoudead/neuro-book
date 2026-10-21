<script setup lang="ts">
/**
 * 弹出列表一行里面的几格（内部零件，见同名 `.md`）。多根：几格并列放进各列表自己的行元素里，不继承属性。
 *
 * 插槽替换整格，没给时画默认的格。MenuNodes 把宿主的 `item`、`item-right` 插槽一路转进来：宿主没给时转来的内容是空的，
 * Vue 按“插槽内容为空就用后备内容”落回这里的默认格，与转插槽之前的写法结果相同。
 */
defineOptions({inheritAttrs: false});

defineProps<{
    label?: string;
    leadColumn?: boolean;
    checked?: boolean;
    icon?: string;
    mutedIcon?: boolean;
    hint?: string;
    submenu?: boolean;
}>();

defineSlots<{
    label?: () => unknown;
    lead?: () => unknown;
    right?: () => unknown;
    trailing?: () => unknown;
}>();
</script>

<template>
    <span
        v-if="leadColumn"
        :class="['nb-ui-menu-item__icon', checked ? 'i-lucide-check' : [icon, mutedIcon && icon ? 'text-[var(--text-secondary)]' : '']]"
        aria-hidden="true"
    ><slot name="lead" /></span>
    <slot name="label"><span class="nb-ui-menu-item__label">{{ label }}</span></slot>
    <span v-if="submenu" class="i-lucide-chevron-right nb-ui-menu-item__chevron" aria-hidden="true"></span>
    <slot v-else name="right"><span v-if="hint" class="nb-ui-menu-item__hint">{{ hint }}</span></slot>
    <slot name="trailing" />
</template>
