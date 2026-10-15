---
标签: []
---

# 页面状态

一页在取数或出错时的占位：出错时写出原因与“重试”，只影响这一页（docs/specs/story/viewer.md F4）；既不在取也没出错时什么也不画。

## 数据

```ts
defineProps<{loading: boolean; error: string | null}>();
defineEmits<{retry: []}>();
```

没有 slots、expose；attrs 透传。出错时根元素带 `data-testid="page-error"`。
