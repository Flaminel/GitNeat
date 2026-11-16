import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/monaco.contribution";
import "monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.editor.defineTheme("krill", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#1c1e23",
    "editorGutter.background": "#1c1e23",
    "editor.lineHighlightBackground": "#ffffff08",
    "editorLineNumber.foreground": "#ffffff55",
    "diffEditor.insertedTextBackground": "#5cb85c55",
    "diffEditor.removedTextBackground": "#d9413d55",
    "diffEditor.insertedLineBackground": "#5cb85c33",
    "diffEditor.removedLineBackground": "#d9413d33",
    "diffEditorGutter.insertedLineBackground": "#5cb85c33",
    "diffEditorGutter.removedLineBackground": "#d9413d33",
    "diffEditor.diagonalFill": "#ffffff10",
    "diffEditor.border": "#131418",
    "scrollbarSlider.background": "#ffffff20",
  },
});

monaco.editor.setTheme("krill");

export function languageFor(file: string): string {
  const name = file.split("/").pop()?.toLowerCase() ?? "";
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.filenames?.some((f) => f.toLowerCase() === name)) {
      return lang.id;
    }
    if (lang.extensions?.some((ext) => name.endsWith(ext.toLowerCase()))) {
      return lang.id;
    }
  }
  return "plaintext";
}

export { monaco };
