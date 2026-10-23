# 批注

她抬头<comment body="这里节奏太快">看了他一眼</comment>。

前文<inline-comment body="需要核对">原文</inline-comment>后文。

<comment body="整段视角混乱，需要重写">
老人走向祭坛。

风里带着灰烬的味道。
</comment>

123<comment id="c1" body="意见">one</comment>

<comment id="c1">two</comment>

<comment id="c1">three</comment>

a<comment body="外">b<comment body="内">c</comment>d</comment>e，`</comment>` 不是闭标签。

<comment id="c2">没有意见的截在前</comment>

<comment id="c2" body="后面的意见">带意见的截在后</comment>

<comment id="c3">只有没有意见的截</comment>

<comment body="属性里有 &quot;引号&quot; 与 &lt;尖括号&gt; 与&#10;换行">转义</comment>

<comment body="跨换行">第一行
第二行</comment>

```
<comment body="围栏里">不是批注</comment>
```

<comment body="块里有围栏">
```
</comment>
```
</comment>

> <comment body="引用里">引文</comment>

<comment>
没有意见的块
</comment>
