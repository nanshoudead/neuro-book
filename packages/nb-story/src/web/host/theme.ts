import {applyColorway, installTheme} from "@notnotype/nb-ui";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";

/**
 * 不经 Nuxt 装 nbook 主题（照 dev-panel 的 host/theme.ts）：装主题模块，在 `<html>` 上写主题与明暗，再套配色。
 * 查看器没有明暗开关，跟随系统；系统切换时跟着切。
 */
export function installAppearance(): void {
    installTheme(nbookTheme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
        const resolved = media.matches ? "dark" : "light";
        const root = document.documentElement;
        root.dataset.nbTheme = "nbook";
        root.dataset.nbAppearance = resolved;
        applyColorway(root, nbookTheme.colorways![resolved === "light" ? "nbook-light" : "nbook-dark"]!);
    };
    apply();
    media.addEventListener("change", apply);
}
