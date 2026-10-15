import {applyColorway, installTheme} from "@notnotype/nb-ui";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import {readonly, ref} from "vue";

import {readTheme, writeTheme, type ThemeChoice} from "./prefs";

/**
 * 不经 Nuxt 装 nbook 主题（照 dev-panel 的 host/theme.ts）：装主题模块，在 `<html>` 上写主题与明暗，再套配色。
 * 明暗有跟随系统、亮色、暗色三档（docs/specs/story/viewer.md 输出 34），选择存在浏览器本地；跟随系统时系统切换跟着切。
 */
const choice = ref<ThemeChoice>("system");
/** 实际生效的明暗。画布（Sigma）的颜色在绘制时读一次，要靠它知道该重画了。 */
const resolved = ref<"light" | "dark">("light");
let media: MediaQueryList | null = null;

function apply(): void {
    resolved.value = choice.value === "system" ? (media?.matches ? "dark" : "light") : choice.value;
    const root = document.documentElement;
    root.dataset.nbTheme = "nbook";
    root.dataset.nbAppearance = resolved.value;
    applyColorway(root, nbookTheme.colorways![resolved.value === "light" ? "nbook-light" : "nbook-dark"]!);
}

/** 实际生效的明暗（只读）。 */
export const appearance = readonly(resolved);

export function installAppearance(): void {
    installTheme(nbookTheme);
    choice.value = readTheme();
    media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", () => {
        if (choice.value === "system") apply();
    });
    apply();
}

/** 顶栏的明暗切换用：当前选择与改选择。 */
export function useAppearance(): {choice: Readonly<typeof choice>; set(value: ThemeChoice): void} {
    return {
        choice: readonly(choice),
        set(value) {
            choice.value = value;
            writeTheme(value);
            apply();
        },
    };
}
