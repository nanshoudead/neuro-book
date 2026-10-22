/**
 * 一组可展开项的展开状态，按 id 记录。没被用户点过的项跟随调用处给的缺省值，所以缺省值可以随状态变化（例如运行中逐步
 * 展开、结束后回到折叠），用户点过的以用户为准。状态在组件实例里：组件卸载（例如整轮收起）后回到缺省。
 */
import {ref} from "vue";

export function useOpenSet() {
    const chosen = ref<Record<string, boolean>>({});
    return {
        isOpen: (id: string, fallback = false): boolean => chosen.value[id] ?? fallback,
        set: (id: string, open: boolean): void => {
            chosen.value = {...chosen.value, [id]: open};
        },
    };
}
