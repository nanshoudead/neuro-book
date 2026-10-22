---
schema: nbook.work/v1
workId: w00030-nb-ui-library-structure
issueId: null
status: active
updated: 2026-10-20
---

# nb-ui 库结构整理

## 目标

按 w00029 t05/evidences/lib-review.txt 的整改顺序第 2 到 4 步整理 nb-ui 的结构：样式进 CSS layer、不再被宿主的原子类改掉（L01，连同 L18、L06、L02 的 html 规则）；弹出列表一族收进一个目录并合并级联、定位、方向键漫游与行的共用零件（L24、L03、L21、L22、L04）；公开 API 一次对齐（打开态、关闭原因、尺寸与语调词表、Dialog 拆分，L05、L10、L08、L12、L16），先列迁移表。布局引擎拆包（L20）不在本 Work。先写计划交开发者确认；与 w00027 t07（低代码表单改 Select 与表单控件）排先后。

## 待确认

autonomous-delivery 推进时照推荐做、等开发者追认的决定：[pending-confirmations.md](pending-confirmations.md)。
