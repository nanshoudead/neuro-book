---
标签: []
---

# CheckoutSwitch

文档页顶部的 checkout 切换：在已检出的 checkout 里选一个看它的文档。不是主工作区时在旁边标出来（这不是 master 的文档）。从 Task 页进入时，Task 的执行 checkout 候选排在最前并标“这个 Task”。

## 数据

```ts
type CheckoutRef = {key: string; branch: string | null; isMain: boolean};
interface CheckoutSwitchProps {
    /** 可选的 checkout；必填 */
    checkouts: CheckoutRef[];
    /** 当前选中的 key；受控；必填 */
    modelValue: string;
    /** 当前 Task 的执行 checkout 候选（key）；可选，默认空 */
    preferred?: string[];
}
interface CheckoutSwitchEmits {
    (event: "update:modelValue", key: string): void;
}
```

没有插槽与 expose。底层是 nb-ui 的 `Select`。
