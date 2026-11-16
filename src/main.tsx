import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { UiProvider } from "./ui";

createRoot(document.getElementById("root") as HTMLElement).render(
  <UiProvider>
    <App />
  </UiProvider>,
);
