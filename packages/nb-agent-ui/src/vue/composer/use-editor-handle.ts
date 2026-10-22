/**
 * 注入编辑器的句柄。注入的编辑器可以是异步组件（`nbook.markdown` 的就是），加载完成前 ref 是 null：这期间的调用按顺序
 * 暂存，编辑器出现后补做，不让“聚焦”与“添加附件”选好的文件被悄悄丢掉。输入框与以后的就地编辑共用。
 */
import {ref, watch, type Ref} from "vue";

export function useEditorHandle<Editor>(): {editorRef: Ref<Editor | null>; withEditor: (call: (editor: Editor) => void) => void} {
    const editorRef = ref(null) as Ref<Editor | null>;
    const pending: Array<(editor: Editor) => void> = [];
    function withEditor(call: (editor: Editor) => void): void {
        if (editorRef.value !== null) call(editorRef.value);
        else pending.push(call);
    }
    watch(editorRef, (editor) => {
        if (editor === null) return;
        for (const call of pending.splice(0)) call(editor);
    });
    return {editorRef, withEditor};
}
