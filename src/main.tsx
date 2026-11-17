import "./tauri-api";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import "./styles.css";
import { UiProvider } from "./ui";

createRoot(document.getElementById("root") as HTMLElement).render(
  <UiProvider>
    <App />
  </UiProvider>,
);
