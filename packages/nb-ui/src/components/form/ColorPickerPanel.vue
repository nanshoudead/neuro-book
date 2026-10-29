<script setup lang="ts">
/**
 * 取色面板（内部部件，不从入口导出；行为写在 ColorSwatches.md 里）：饱和度与明度面、色相条、
 * 颜色值输入与可选的预设色板。`ColorSwatches` 的“自定义”色块用它。
 *
 * 面板内部按 HSB 保存当前颜色，三个控件都改这一个对象，不经 hex 来回转换：饱和度或明度为 0 时 hex 里没有色相，
 * 来回转一次色相就丢了，色相条会跳回红色。对外只发出不带透明度的小写 `#rrggbb`。
 */
import {
    ColorAreaArea,
    ColorAreaRoot,
    ColorAreaThumb,
    ColorFieldInput,
    ColorFieldRoot,
    ColorSliderRoot,
    ColorSliderThumb,
    ColorSliderTrack,
    ColorSwatchPickerItem,
    ColorSwatchPickerRoot,
    colorToHex,
    convertToRgb,
    normalizeColor,
} from "reka-ui";
import type {Color, HSBColor} from "reka-ui";
import {computed, ref, watch} from "vue";

import {useUiText} from "../../text-port";

const props = withDefaults(defineProps<{
    /** 当前颜色（任意 CSS 颜色字符串；读不懂或为空时按缺省蓝色显示） */
    modelValue: string;
    swatches?: string[];
    disabled?: boolean;
    readonly?: boolean;
}>(), {
    swatches: () => [],
    disabled: false,
    readonly: false,
});

const text = useUiText();

const emit = defineEmits<{
    (event: "update:modelValue", value: string): void;
}>();

const FALLBACK = "#3b82f6";

function toHsb(value: string): HSBColor {
    let color: Color;
    try {
        color = normalizeColor(value);
    } catch {
        color = normalizeColor(FALLBACK);
    }
    return toHsbSpace(color);
}

/** reka 按字符串的写法给出 rgb 或 hsl，换 hsb 的函数又没导出：先统一成 rgb（0–255），再算色相、饱和度、明度（0–100）。 */
function toHsbSpace(color: Color): HSBColor {
    if (color.space === "hsb") return {...color, alpha: 1};
    const {r, g, b} = convertToRgb(color);
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let h = 0;
    if (delta !== 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h = (h * 60 + 360) % 360;
    }
    return {space: "hsb", h, s: max === 0 ? 0 : (delta / max) * 100, b: (max / 255) * 100, alpha: 1};
}

const hexOf = (color: HSBColor): string => colorToHex({...color, alpha: 1}).toLowerCase();

const color = ref<HSBColor>(toHsb(props.modelValue));
const hex = computed(() => hexOf(color.value));
const locked = computed(() => props.disabled || props.readonly);

// 外面换了值（选了别的色块、宿主重置）才重设；自己刚发出去的值回来时不动，保住色相。
watch(() => props.modelValue, (value) => {
    if (value.toLowerCase() !== hex.value) color.value = toHsb(value);
});

function set(next: Color): void {
    if (locked.value) return;
    color.value = toHsbSpace(next);
    emit("update:modelValue", hex.value);
}

/** 预设色从色块的 `select` 事件取：受控时 reka 的色板根会把一次选择发两遍。 */
function pickSwatch(value: string): void {
    if (locked.value || value.toLowerCase() === hex.value) return;
    color.value = toHsb(value);
    emit("update:modelValue", hex.value);
}

/** 面的底色：横向从白到当前色相的纯色，再从上往下压黑。这是颜色空间本身，所以用颜色关键字而不是主题变量。 */
const areaBackground = computed(() => `linear-gradient(to top, black, transparent), linear-gradient(to right, white, hsl(${String(Math.round(color.value.h))} 100% 50%))`);
</script>

<template>
    <div class="nb-color-panel flex w-[216px] flex-col gap-3" data-color-panel>
        <ColorAreaRoot
            :model-value="color"
            color-space="hsb"
            x-channel="saturation"
            y-channel="brightness"
            :disabled="locked"
            class="block"
            @update:color="set"
        >
            <ColorAreaArea class="nb-color-panel__area relative block h-[140px] w-full touch-none rounded-[var(--radius-control)]" :style="{background: areaBackground}">
                <ColorAreaThumb class="nb-color-panel__thumb block h-3.5 w-3.5 rounded-full" :style="{backgroundColor: hex}" />
            </ColorAreaArea>
        </ColorAreaRoot>

        <ColorSliderRoot
            :model-value="color"
            color-space="hsb"
            channel="hue"
            :disabled="locked"
            class="relative flex h-3.5 w-full touch-none items-center select-none"
            @update:color="set"
        >
            <ColorSliderTrack class="nb-color-panel__track relative h-2.5 w-full grow rounded-full" />
            <ColorSliderThumb class="nb-color-panel__thumb block h-3.5 w-3.5 rounded-full" :style="{backgroundColor: `hsl(${Math.round(color.h)} 100% 50%)`}" />
        </ColorSliderRoot>

        <div class="flex items-center gap-2">
            <span class="nb-color-panel__preview h-6 w-6 shrink-0 rounded-[calc(var(--radius-control)*0.6)]" :style="{backgroundColor: hex}" aria-hidden="true" />
            <ColorFieldRoot :model-value="hex" :disabled="props.disabled" :readonly="props.readonly" class="min-w-0 flex-1" @update:color="set">
                <ColorFieldInput
                    class="nb-ui-control nb-ui-control-h-sm w-full rounded-[var(--radius-control)] border bg-[var(--control-surface)] px-2 font-mono text-xs text-[var(--text-main)] outline-none"
                    :aria-label="text('colorPicker.value')"
                    data-color-panel-input
                />
            </ColorFieldRoot>
        </div>

        <ColorSwatchPickerRoot
            v-if="props.swatches.length > 0"
            :model-value="props.swatches.find((value) => value.toLowerCase() === hex) ?? ''"
            orientation="horizontal"
            selection-behavior="replace"
            :disabled="locked"
            class="grid grid-cols-6 gap-1.5 border-t border-[var(--divider)] pt-3 outline-none"
            :aria-label="text('colorPicker.presets')"
        >
            <ColorSwatchPickerItem
                v-for="value in props.swatches"
                :key="value"
                :value="value"
                :aria-label="value.toLowerCase()"
                class="nb-color-panel__swatch nb-ui-focus-ring h-6 w-full cursor-pointer rounded-[calc(var(--radius-control)*0.6)] outline-none"
                :style="{backgroundColor: value}"
                data-color-panel-swatch
                @select="pickSwatch(value)"
            />
        </ColorSwatchPickerRoot>
    </div>
</template>

<style scoped>
.nb-color-panel__area,
.nb-color-panel__preview,
.nb-color-panel__swatch {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-main) 12%, transparent);
}

/* 滑块：白边加一圈细影，落在任何颜色上都看得见。 */
.nb-color-panel__thumb {
    border: 2px solid white;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-main) 35%, transparent), 0 1px 3px color-mix(in srgb, var(--shadow-color, black) 30%, transparent);
    outline: none;
}

.nb-color-panel__thumb:focus-visible {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-main) 35%, transparent), var(--focus-ring);
}

.nb-color-panel__swatch[data-state="checked"] {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-main) 12%, transparent), 0 0 0 2px var(--bg-panel), 0 0 0 3.5px var(--text-main);
}
</style>
