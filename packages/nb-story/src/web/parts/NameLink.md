---
标签: ["state:inject"]
---

# 人名链接

把一个人物或事物的名字写成带淡底色的可点文字，点了在抽屉里打开它的人物卡（docs/specs/story/viewer.md 输出 20），不离开当前页。

## 数据

```ts
defineProps<{
    /** 点的 id（查询结果里 NodeRef 的 id）。必填。 */
    id: string;
    /** 显示的名字。必填。 */
    label: string;
    /** 打开人物卡时停在哪个页签，缺省 "summary"。 */
    tab?: "summary" | "relations" | "records" | "episodes";
    /** 加粗（主要人物），缺省 false。 */
    strong?: boolean;
}>();
```

没有 emits、slots、expose；attrs 透传到按钮上。

## 隐藏通道理由

`state:inject`：经 `useBook()` 调 `openCard`，理由同 RefLink：名字到处都是，人物卡属于书的外壳。

## 注意事项

点击会 `stop` 冒泡。
