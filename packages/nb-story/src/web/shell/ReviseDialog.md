---
标签: ["state:local"]
---

# 修订对话框

人物卡“⋯”菜单打开的三个对话框（docs/specs/story/viewer.md 输出 60）：连到另一个对象、改对象种类、某个称呼属于别的对象。三个都要选一句依据（默认列这个对象在已读章里出现的段，也可以直接写“章.段”），写明“修订从这一段起生效，读到它之前看不到”，底部列“改完会怎样”。失败（目标不存在、没有意义的改动）在对话框里写出原因，不关闭。

## 数据

```ts
defineProps<{
    open: boolean;
    mode: "link" | "kind" | "name";
    /** 人物卡的对象编号、显示名与现在的种类、称呼表。必填。 */
    entity: string;
    label: string;
    kind: string;
    names: string[];
}>();
defineEmits<{"update:open": [value: boolean]}>();
```

## 隐藏通道理由

`state:local`：无；取数经 `useStoryQuery`（`revisions.evidence`、`entities.list`），写入经 `useRevise`。

## 注意事项

依据段只列阅读位置之前的（接口保证）；手写的“章.段”由服务端校验。
