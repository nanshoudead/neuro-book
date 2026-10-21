import "./app.css";
import {createApp} from "vue";
import App from "./App.vue";
import {readAppearance} from "./host/prefs.js";
import {applyAppearance} from "./host/theme.js";
import {router} from "./router.js";

applyAppearance(readAppearance());
createApp(App).use(router).mount("#app");
