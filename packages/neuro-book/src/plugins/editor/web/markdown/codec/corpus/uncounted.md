字数不计的内容与计入的内容挨着。

> [!NOTE]- 折叠的标题
> 内容

一段正文
> [!TIP] 跟在段落后的提示块

> 普通引用
> [!WARNING] 不在第一行的类型是文字

- [ ] 待办 task
- [x] 完成 done

正文<html>
<p>粘在正文后的 HTML</p>
</html>

<script>
let 脚本 = "不计";

</script>

<!--
多行的
HTML 注释
-->

<div>
块级 HTML 到空行为止
</div>

[定义]: https://example.com/a
  "下一行的标题"

行内 $$a$$ 不是公式块。

$$x + y$$

<kbd>
没配上的标签独占一行

Word<br>Next，`<comment body="代码里">x</comment>` 的标签计入，`` `<sup>` `` 也是。

&#20013;&#25991; 解码后计入；\&lt;br> 与 \<kbd> 是文字。
