<script setup lang="ts">
import {computed, inject, useAttrs} from "vue";
import {
    SelectContent,
    SelectItem,
    SelectItemIndicator,
    SelectItemText,
    SelectPortal,
    SelectRoot,
    SelectTrigger,
    SelectValue,
    SelectViewport,
} from "reka-ui";
import PopupScrollbar from "../layout/PopupScrollbar.vue";
import {popoverInlineSurfaceStyle, usePopoverLayer} from "../../composables/usePopoverLayer";
import {usePopupScroll} from "../../composables/usePopupScroll";
import {cn} from "../../utils/cn";
import {useFieldContext} from "./field-context";

/**
 * 下拉选择。弹出层基于 reka 的 Select 原语：键盘漫游、选中、打开时滚到选中项都由 reka 负责。
 *
 * - 选项是弹出列表共用的一行（`.nb-ui-menu-item`）：一档行高与字号，选中只画左侧勾选列的勾、底色不变；
 * - 滚动由 `usePopupScroll` 给出：截在第 9 项中间、顶底渐隐、悬浮滑块，可滚动时视口右侧给滑块让位；
 * - 外框按 reka 给的可用高度夹紧；与触发器相距 7px，避开触发器聚焦时的光圈；
 * - 浮层的内联材质（四层投影、8px 模糊）与 `.nb-ui-popover-surface` 不一致，见 `usePopoverLayer.ts`。
 */

export type SelectSize = "default" | "sm";
export type SelectDirection = "auto" | "up" | "down";

export type SelectOption = {
    label: string;
    value: string;
    /** 次行说明文字，富选项场景使用 */
    description?: string;
    /** i-lucide-* 图标类，与 indicatorClass 互斥（indicator 优先） */
    iconClass?: string;
    /** 状态色圆点类（如 bg-emerald-500），与 iconClass 互斥（indicator 优先） */
    indicatorClass?: string;
    disabled?: boolean;
};

const props = withDefaults(defineProps<{
    modelValue?: string;
    options: SelectOption[];
    id?: string;
    name?: string;
    placeholder?: string;
    size?: SelectSize;
    dropdownDirection?: SelectDirection;
    disabled?: boolean;
    required?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文的出错取或。 */
    invalid?: boolean;
    /** 只读：可以聚焦、写 `aria-readonly`，交互不改值（docs/specs/ui/forms.md 输出 28）。 */
    readonly?: boolean;
    hideCheckmark?: boolean;
}>(), {
    modelValue: "",
    id: "",
    name: "",
    placeholder: "",
    size: "default",
    dropdownDirection: "auto",
    disabled: false,
    required: false,
    invalid: false,
    readonly: false,
    hideCheckmark: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

const field = useFieldContext();
const controlId = computed(() => props.id || field?.inputId.value || undefined);
const isRequired = computed(() => props.required || field?.required.value === true);
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);
const isSmall = computed(() => props.size === "sm");
const controlSizeClass = computed(() => isSmall.value
    ? "nb-ui-control-h-sm px-[calc(var(--control-px)*0.75)] text-[12px]"
    : "nb-ui-control-h-md nb-ui-control-px text-[13px]");

/*
 * SelectRoot 之上是 reka 的 PopperRoot（只 renderSlot，不产生元素），其下并列着触发器与
 * 浮层两个根节点。多根组件不会自动继承 class 与其他属性，Vue 会**静默丢弃**它们——
 * 调用方传的宽度、aria-label 全部落空。所以这里关掉自动继承，显式转发到触发器。
 *
 * class 单独走 cn()：触发器自带 w-full，与调用方传的宽度是同特指度的两条规则，
 * 拼接的话谁生效取决于样式表先后，而本包的预编译 CSS 与宿主的原子类不在同一张表。
 */
defineOptions({inheritAttrs: false});
const attrs = useAttrs();
const forwardedAttrs = computed(() => {
    const {class: _class, ...rest} = attrs;
    return rest;
});
const triggerClass = computed(() => cn(
    "nb-ui-control flex w-full items-center justify-between gap-1.5 rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)] outline-none disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer select-none font-medium shadow-sm transition-[border-color,box-shadow,background-color] [transition-duration:var(--motion-fast)]",
    controlSizeClass.value,
    isInvalid.value ? "nb-ui-control-invalid" : "",
    attrs.class as string | undefined,
));
const popperSide = computed(() => {
    if (props.dropdownDirection === "up") return "top" as const;
    if (props.dropdownDirection === "down") return "bottom" as const;
    return undefined;
});
const allowSideFlip = computed(() => props.dropdownDirection === "auto");

const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue));
const selectedLabel = computed(() => selectedOption.value?.label ?? "");
/** 有一项带图标或状态圆点时，其余项也留出这一列，名称左边对齐。 */
const iconColumn = computed(() => props.options.some((option) => option.indicatorClass || option.iconClass));

function handleUpdate(value: unknown): void {
    emit("update:modelValue", typeof value === "string" ? value : "");
}

const {zIndex} = usePopoverLayer();
const popoverStyle = {
    ...popoverInlineSurfaceStyle(zIndex),
    width: "var(--reka-select-trigger-width)",
    minWidth: "var(--reka-select-trigger-width)",
};

/** 滚动只接 reka 的 `SelectViewport`：打开时由 reka 滚到选中项，这里不重置滚动位置。 */
const scroll = usePopupScroll();

/** 关闭时不把焦点强行弹回触发器（reka 会先弹一次焦点再交还，触发器的焦点环会闪一下）。 */
function handleCloseAutoFocus(event: Event): void {
    event.preventDefault();
}
</script>

<template>
    <SelectRoot
        :model-value="props.modelValue"
        :disabled="props.disabled"
        :name="props.name || undefined"
        :required="isRequired"
        :modal="false"
        :open="props.readonly ? false : undefined"
        @update:model-value="handleUpdate"
    >
        <SelectTrigger
            v-bind="forwardedAttrs"
            :id="controlId"
            :aria-describedby="field?.ariaDescribedby.value"
            :aria-invalid="isInvalid || undefined"
            :aria-readonly="props.readonly || undefined"
            :class="triggerClass"
            @focus="emit('focus', $event)"
        >
            <span class="flex min-w-0 items-center gap-1.5 pr-1">
                <slot name="leading" :selected="selectedOption">
                    <span v-if="selectedOption?.indicatorClass" class="h-1.5 w-1.5 shrink-0 rounded-full shadow-sm" :class="selectedOption.indicatorClass" aria-hidden="true"></span>
                    <span v-else-if="selectedOption?.iconClass" class="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" :class="selectedOption.iconClass" aria-hidden="true"></span>
                </slot>
                <SelectValue class="min-w-0 truncate text-left" :placeholder="props.placeholder">{{ selectedLabel || props.placeholder }}</SelectValue>
            </span>
            <span
                class="i-lucide-chevron-down shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)] data-[state=open]:rotate-180"
                :class="isSmall ? 'h-3.5 w-3.5' : 'h-4 w-4'"
                aria-hidden="true"
            ></span>
        </SelectTrigger>

        <SelectPortal>
            <SelectContent
                position="popper"
                :side="popperSide"
                :side-flip="allowSideFlip"
                :avoid-collisions="allowSideFlip"
                :side-offset="7"
                :body-lock="false"
                :disable-outside-pointer-events="false"
                :style="popoverStyle"
                class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion relative flex max-h-[var(--reka-popper-available-height)] flex-col overflow-hidden"
                @close-auto-focus="handleCloseAutoFocus"
            >
                <SelectViewport
                    :ref="scroll.setViewport"
                    class="nb-ui-popover-scroll w-full"
                    :class="scroll.fadeClass.value"
                    :style="scroll.viewportStyle.value"
                    @scroll="scroll.onScroll"
                >
                    <SelectItem
                        v-for="option in props.options"
                        :key="option.value"
                        :value="option.value"
                        :data-value="option.value"
                        :disabled="option.disabled"
                        class="nb-ui-menu-item"
                        :class="{'nb-ui-menu-item--multiline': Boolean(option.description)}"
                    >
                        <span v-if="!props.hideCheckmark" class="nb-ui-menu-item__check">
                            <SelectItemIndicator class="inline-flex"><span class="i-lucide-check h-3.5 w-3.5" aria-hidden="true"></span></SelectItemIndicator>
                        </span>
                        <span v-if="option.indicatorClass" class="nb-ui-menu-item__icon inline-flex items-center justify-center" aria-hidden="true"><span class="h-1.5 w-1.5 rounded-full shadow-sm" :class="option.indicatorClass"></span></span>
                        <span v-else-if="option.iconClass" class="nb-ui-menu-item__icon text-[var(--text-secondary)]" :class="option.iconClass" aria-hidden="true"></span>
                        <span v-else-if="iconColumn" class="nb-ui-menu-item__icon" aria-hidden="true"></span>
                        <span class="nb-ui-menu-item__label">
                            <SelectItemText class="block truncate">{{ option.label }}</SelectItemText>
                            <span
                                v-if="option.description"
                                class="mt-0.5 block truncate text-[11px] leading-[14px] text-[var(--text-muted)]"
                            >{{ option.description }}</span>
                        </span>
                    </SelectItem>
                </SelectViewport>

                <PopupScrollbar :scroll="scroll" />
            </SelectContent>
        </SelectPortal>
    </SelectRoot>
</template>
