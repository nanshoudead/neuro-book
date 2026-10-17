import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {getIconData, iconToHTML, iconToSVG} from "@iconify/utils";
import {icons as lucideIcons} from "@iconify-json/lucide";
import {defineConfig, presetIcons, presetUno} from "unocss";

/*
 * 位移 / 缩放 / 旋转 / 斜切的类名必须按 nb-ui 发货的那一份封禁掉。
 *
 * 页面上同时装着两套原子 CSS：应用自己的 UnoCSS，和 nb-ui 编译好的 Tailwind v4。
 * 两边都会生成 `.translate-x-4`、`.rotate-180` 这类同名类，但语义不同——
 * Tailwind v4 写进 `translate:` / `rotate:` 独立属性，UnoCSS 写进 `transform`。
 * 同名类同时命中时两个属性各生效一次，位移与角度直接翻倍：
 * Switch 的滑块会溢出轨道，chevron 转 180° 变成 360°（看起来没转）。
 *
 * 为什么在这里封而不是在 nb-ui 里改：类名的语义分歧只在「两套引擎同时在场」时成立，
 * 而消费方装什么是消费方的事。封禁让这一类类名在页面上只有 nb-ui 那一份实现，
 * 应用自己用到的同名类照常生效（值一样，只是来源换了）。
 *
 * 名单从 nb-ui 的发货产物里现读，不手抄：nb-ui 改了用法，重启开发服务器后自动跟上。
 * 只封 nb-ui 真正发货的名字——把整个 `scale-*` 家族一刀切会连应用自己在用的
 * `hover:-translate-y-0.5` 一起封掉（nb-ui 没有同名实现，那个悬停位移会静默失效）。
 */
function readNbUiTransformClasses(): string[] {
    const cssPath = resolve(import.meta.dirname, "../nb-ui/dist/nb-ui.css");
    let css: string;
    try {
        css = readFileSync(cssPath, "utf-8");
    } catch {
        throw new Error(`读不到 nb-ui 的样式产物：${cssPath}。先跑 \`bun run --cwd packages/nb-ui build:css\`。`);
    }
    const names = new Set<string>();
    for (const rule of css.matchAll(/(?:^|[},])\s*([^{}]+?)\s*\{/g)) {
        for (const match of rule[1]!.matchAll(/\.((?:\\[^\s]|[A-Za-z0-9_-])+)/g)) {
            const className = match[1]!.replace(/\\(.)/g, "$1");
            if (/(?:^|:)-?(?:translate|scale|rotate|skew)-/.test(className)) {
                names.add(className);
            }
        }
    }
    return [...names].sort();
}

/*
 * preset-icons 的规则带 prefix，UnoCSS 把它放进 fallback。
 * preset-uno 里有一条可选前缀的正则能配上任意类名，于是 fallback 不会再被查询，
 * `i-lucide-*` 一条样式都产不出来。这里写成不带 prefix 的具体规则，才能进索引。
 * 只写 `--svg`：遮罩、尺寸由 nb-ui 的 `[class*="i-lucide-"]` 垫片负责。
 */
function lucideMaskUrl(name: string): string | undefined {
    const data = getIconData(lucideIcons, name);
    if (!data) return;
    const rendered = iconToSVG(data);
    const svg = iconToHTML(rendered.body.replaceAll("currentColor", "black"), rendered.attributes);
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export default defineConfig({
    presets: [
        presetUno(),
        presetIcons(),
    ],
    rules: [
        [/^i-lucide-([a-z0-9-]+)$/, ([, name]) => {
            if (!name) return;
            const url = lucideMaskUrl(name);
            if (!url) return;
            return {"--svg": url};
        }],
    ],
    safelist: Object.keys(lucideIcons.icons).map((iconName) => `i-lucide-${iconName}`),
    blocklist: readNbUiTransformClasses(),
});
