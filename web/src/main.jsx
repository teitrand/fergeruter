import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../assets/styles.css";
import { App } from "./App.jsx";
import { detectLang } from "./components/i18n.js";
import { routeOverride } from "../../packages/core/index.js";
import { dataBase, liveDataBase } from "./model/data.js";
import { browserMemory, messageCache, readHideArrivals, readRouteChoice } from "./model/storage.js";
import { initialUi } from "./state.js";

const initialState = initialUi({
  routeChoice: readRouteChoice(),
  lang: detectLang(),
  override: routeOverride(location),
  hideArrivals: readHideArrivals(),
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App
      dataBase={dataBase(import.meta.env)}
      liveDataBase={liveDataBase(import.meta.env, location)}
      messageCache={messageCache()}
      initialState={initialState}
      memory={browserMemory()}
    />
  </StrictMode>
);
