import {createRouter, createWebHistory} from "vue-router";

import BookShell from "./shell/BookShell.vue";
import LibraryPage from "./shell/LibraryPage.vue";

/** 地址的形状见 docs/specs/story/viewer.md 的“边界与兼容”：`/book/<书 id>/<页面>?at=&perspective=&entity=&tab=`。 */
export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: "/", component: LibraryPage},
        {path: "/book/:id/:page?", component: BookShell},
        {path: "/:rest(.*)", redirect: "/"},
    ],
});
