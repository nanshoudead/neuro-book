import "./app.css";
import {createApp} from "vue";

import App from "./App.vue";
import {installAppearance} from "./host/theme";
import {router} from "./router";

installAppearance();
createApp(App).use(router).mount("#app");
