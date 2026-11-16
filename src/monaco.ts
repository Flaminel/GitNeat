import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/monaco.contribution";
import "monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.editor.defineTheme("gitneat", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#15171b",
    "editorGutter.background": "#15171b",
    "editor.lineHighlightBackground": "#ffffff08",
    "editorLineNumber.foreground": "#727272",
    "editorLineNumber.activeForeground": "#c6c6c6",
    "diffEditor.insertedTextBackground": "#5cb85c29",
    "diffEditor.removedTextBackground": "#d9413d28",
    "diffEditor.insertedLineBackground": "#5cb85c1d",
    "diffEditor.removedLineBackground": "#d9413d1d",
    "diffEditorGutter.insertedLineBackground": "#00000000",
    "diffEditorGutter.removedLineBackground": "#00000000",
    "diffEditor.diagonalFill": "#ffffff14",
    "diffEditor.border": "#2b2d32",
    "scrollbarSlider.background": "#ffffff20",
  },
});

monaco.editor.setTheme("gitneat");

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
