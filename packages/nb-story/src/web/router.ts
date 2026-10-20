import {createRouter, createWebHistory} from "vue-router";

import BookShell from "./shell/BookShell.vue";
import ImportPage from "./shell/ImportPage.vue";
import IngestPage from "./shell/IngestPage.vue";
import LibraryPage from "./shell/LibraryPage.vue";

/**
 * 地址的形状见 docs/specs/story/viewer.md 的“边界与兼容”：`/book/<书 id>/<页面>?at=&perspective=&entity=&tab=`，另有
 * 导入页 `/import` 与进度页 `/ingest/<书 id>`。
 */
export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: "/", component: LibraryPage},
        {path: "/book/:id/:page?", component: BookShell},
        {path: "/import", component: ImportPage},
        {path: "/ingest/:id", component: IngestPage},
        {path: "/:rest(.*)", redirect: "/"},
    ],
});
