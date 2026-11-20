import "./tauri-api";
import "./electron-api";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import "./styles.css";
import { UiProvider } from "./ui";

document.addEventListener("contextmenu", (e) => {
  if (!(e.target instanceof Element && e.target.closest("input, textarea, .monaco-editor, .xterm"))) {
    e.preventDefault();
  }
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <UiProvider>
    <App />
  </UiProvider>,
);
