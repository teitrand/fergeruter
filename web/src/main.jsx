import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../assets/styles.css";
import { App } from "./App.jsx";
import { detectLang } from "./components/i18n.js";
import { routeOverride } from "./model/context.js";
import { dataBase } from "./model/data.js";
import { browserMemory, readHideArrivals, readRouteChoice } from "./model/storage.js";
import { initialUi } from "./state.js";

const lang = detectLang();
const startLang = lang === "en" ? "en" : "nn";
const initialState = initialUi({
  routeChoice: readRouteChoice(),
  lang: startLang,
  override: routeOverride(location),
  hideArrivals: readHideArrivals(),
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App dataBase={dataBase(import.meta.env)} initialState={initialState} memory={browserMemory()} />
  </StrictMode>
);
