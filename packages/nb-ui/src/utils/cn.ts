import {clsx} from "clsx";
import type {ClassValue} from "clsx";
import {twMerge} from "tailwind-merge";

/**
 * 合并类名，冲突的原子类后者胜出。
 *
 * 组件把自己的默认外观和调用方传进来的 class 拼在一起时，光靠拼接是不够的：
 * `w-full` 与 `w-[170px]` 同在 utilities 层、特指度相同，谁生效取决于 Tailwind 输出这两条规则的先后，
 * 与 class 属性里的先后无关，调用方控制不了。
 * twMerge 在**类名层**就把前一个删掉，于是「调用方传的覆盖组件默认」成为确定行为。
 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
