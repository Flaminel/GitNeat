# Evidence: Source 11.9.0 diff and merge views

Source root: scratchpad gk (extracted app.asar). R = src/render/static/entryPoints/main/render.bundle.js, S = src/strings/en-us.json, T = src/main/static/defaultThemes/*.jsonc-default, C = src/css/styles.css.
Tags: Observed means read directly in the files. Inferred means deduced from them.

## 1. Strings (S, key = value)
FileViewPanel-DiffView = Diff View; FileViewPanel-FileView = File View; FileViewPanel-HunkView = Hunk View; FileViewPanel-InlineView = Inline View; FileViewPanel-SplitView = Split View. Observed.
FileViewPanel-NextDiff = Next Change; FileViewPanel-PreviousDiff = Previous Change. Observed.
FileViewPanel-IgnoreWhiteSpace = Ignore Leading/Trailing Whitespace; FileViewPanel-WordWrap = Word Wrap. Observed.
FileViewPanel-History = History; FileViewPanel-Blame = Blame; FileViewPanel-EditThisFile = Edit This File; FileViewPanel-EditInWorkDir = Edit in Working Directory; FileViewPanel-SaveChanges = Save Changes; FileViewPanel-ExitReview = Exit Review; FileViewPanel-Editable = editable; FileViewPanel-FileViewCode = Code; FileViewPanel-FileViewPreview = Preview; FileViewPanel-OpenInJira = Open in Jira; FileViewPanel-DiffFileMode = File Mode Changes from {0} to {1}. Observed.
FileContentsPanel-Binary = Binary file; FileContentsPanel-Deleted = File was deleted; FileContentsPanel-EmptyDiff = File contents are unchanged; LoadingDiffWithEllipsis = Loading diff... Observed.
StageThisHunk = Stage Hunk; UnstageThisHunk = Unstage Hunk; DiscardThisHunk = Discard Hunk; RevertThisHunk = Revert Hunk (tooltip: Apply the inverse of this hunk to your working directory). Observed.
StageThisLine = Stage this line; UnstageThisLine = Unstage this line; StageSelectedLines = Stage selected lines; StageThisFile = Stage File; UnstageThisFile = Unstage File; StageAllChanges = Stage All Changes; UnstageAllChanges = Unstage All Changes; StageFilemodeChange = Stage filemode change; UnstageFilemodeChange = Unstage filemode change; DiscardUnstagedChangesButtonLabel = Discard Unstaged Changes. Observed.
FileHistory = File History; FileHistory-ShowBlame = Show blame details; FileHistory-BlameButtonLabel = Blame; FileHistory-End = End of History; FileHistory-ContinueLooking = Go Deeper; File-Blame = File Blame. Observed.
OpenInDiffTool = Open in diff tool; OpenInMergeTool = Open in merge tool; ToolPreferences-ExternalDiffTool = External Diff Tool; ToolPreferences-ExternalMergeTool = External Merge Tool; ViewDiffToolSettings = View Diff Tool Settings; KeyBinding-OpenFileInExternalDiffOrMergeTool = Open Selected File in External Diff/Merge Tool. Observed.
EditorPreferences-EOLCharacter = End of Line Character (LF, CRLF); EditorPreferences also has Font, FontSize, TabSize, ShowLineNumbers = Show Line Numbers, SyntaxHighlighting = Syntax Highlighting, WordWrap = Word Wrap, ShowOnlyMonospace. Encoding-Label = Encoding (repo default). Observed.
FuzzyFinder-ToggleSyntaxHighlighting = Toggle Syntax Highlighting. Observed.
Errors: Error-StageSelectionFailed, Error-UnstageSelectionFailed, Error-UpdateDiffFailed, ErrorMessage-ChunkHeaderFailure (file too large). SaveAndStageEditorChanges-Message asks to save before staging (Save and stage, Stage saved changes only). Observed.

## 2. View modes
Three modes exist: hunk, inline, split. Observed in R: fileDisplayModes = {CONTENT:"content",HUNK:"hunk",INLINE:"inline",SPLIT:"split"}; diffDisplayModes = {HUNK,INLINE,SPLIT}. "content" is the file editor mode.
Default is hunk. Observed: profile defaults contain fileView:{diffDisplayMode:"hunk"} and the select saga falls back to fileDisplayModes.HUNK.
Persistence key: profile path ["fileView","diffDisplayMode"]. Observed: each setXMode handler calls setCurrentProfileSetting(["fileView","diffDisplayMode"], mode) after tryCloseEditor() succeeds. Switching closes any open editor first. Observed.
Hunk view shows only the changed hunks with context, each with a 26px strip of hunk buttons above it. Inferred from the 26px view zones below. Whether hunk view is also a Monaco diff editor is not settled.
Inline view is the Monaco diff editor with renderSideBySide false; split view is the same editor with it true. Observed: renderSideBySide:this.props.fileDisplayMode===pr, useInlineViewWhenSpaceIsLimited:!1. In inline mode the layout width is widened by 30 (width+30). Observed; the reason is Inferred.
Mode buttons are disabled for images, submodules and binary files. Observed.
Other settings: ["actions","commit","ignoreWhiteSpace"], ["editor","wordWrap"], ["editor","fontFamily"], ["editor","fontSize"]. Observed.

## 3. Header toolbar
One row, className "flex items-center px2 mt2 mb3 shrink-0", three flex-1 regions. Observed in R.
Left region: edit button (Edit This File, Edit in Working Directory, Edit to Suggest Changes to PR {n}, or the Exit Review and Save Changes component while editing), then Open in Jira when linked. Observed.
Center region: the diff options component (data-testid "diff-options"), then for markdown files a Code | Preview toggle (ids markdown-code-view-button, markdown-preview-view-button). Observed.
Diff options order, Observed:
1. previousDiffButton "Previous Change", icon fas arrow-up
2. nextDiffButton "Next Change", icon fas arrow-down (1 and 2 are one button group)
3. toggleHunkViewButton "Hunk View", icon far list-alt
4. toggleInlineViewButton "Inline View", icon far list
5. toggleSplitViewButton "Split View", icon far columns (3 to 5 are one group, ml2, active state shows current mode)
6. ignore-whitespace-button "Ignore Leading/Trailing Whitespace", icon far paragraph
7. WordWrapToggleButton id word-wrap-button, class btn-small (6 and 7 are one group)
Right region: a group with Blame then History (btn-small, ids blame-button and history-button, each hidden when that view is already open), then a group with the word wrap toggle (shown under a condition, Inferred as editing mode), then a trailing node. Observed.
Not in this header: breadcrumb, stage or unstage file button, close button. Stage File and Unstage File are file list row actions (btn-success and btn-danger). Syntax highlighting is a preference, not a header button. Observed by absence in the header code.
Keybindings (src/keyBindings): command-d select:openSelectedFileInExternalFileCompareTool; command-shift-s repo:stageAll; u repo:unstage; command-shift-u repo:unstageAll; command-s mergeResolution:saveAndResolveFile. KeyBinding-Stage = Stage Current File; KeyBinding-CommitWithStage = Stage All + Commit. Observed. No dedicated next or previous change key was found. Observed.
Next and previous change call diffEditor.goToDiff("next") and goToDiff("previous"); on model change it calls diffEditor.revealFirstDiff(). Observed.

## 4. Rendering tech
Inline and split use Monaco: getMonaco().editor.createDiffEditor(container, buildDiffOptions()). Observed.
Options: fontLigatures true, ignoreTrimWhitespace from the ignoreWhitespace prop, minimap undefined, originalEditable, readOnly, scrollBeyondLastLine false, wordWrap on or off. Observed. Monaco assets live in src/render/static/monaco. Observed.
No filename2prism hits. Language comes from Monaco. Inferred.
Monaco theme "gk" is built per app theme through defineTheme then setTheme. Base is "vs" for light and "vs-dark" otherwise, inherit true. Observed.
Theme mapping, Observed: diffEditor.insertedTextBackground = --added-line; insertedLineBackground = same faded to 0.25; removedTextBackground = --deleted-line; removedLineBackground = same faded to 0.25. So word level highlight uses the full alpha and the whole line uses a quarter of it. Inferred reading of the fade.
Values, dark: added-line fade(green,20%) with green #5CB85C; deleted-line fade(red,20%) with red #D9413D; modified-line fade(#000000,25%); code-bg = app__bg0; stats-added-color #347d39; stats-deleted-color #c93c37. Observed in T.
Values, light: added-line #00a85726; deleted-line #9f1a1626; modified-line #00000033. Observed.
CSS classes for non-Monaco diffs: .diff-line-added and .diff-line-deleted use var(--added-line) and var(--deleted-line); .diff-hunk-panel-wrapper has 10px scrollbars on code-bg; .gl-diff-addition and .gl-diff-deletion use the same vars. Observed in C.
Blame is a set of Monaco decorations (makeDefaultBlameDecorations, linesDecorationsClassName on a one column Range per line). Observed.
Filemode changes show in .diff-filemode-item (monospace, padding 7px 10px, panel__bg1, text-secondary). Observed.
A hunk header line like "@@ -a,b +c,d @@" was not found as UI text. Inferred that none is shown.

## 5. Staging UI
Hunk level: for each changed region a div is created with min and max height 26px and width 100%, placed about 25px above the region top as a Monaco view zone. Observed.
Unstaged modified file: two buttons in order [Discard Hunk (btn-danger, xsmall)] then [Stage Hunk (btn-success, xsmall)]. Observed.
Staged file: one button [Unstage Hunk] (btn-danger). Observed.
Where hunk staging is not allowed (committed diffs): [Revert Hunk] (btn-default) with tooltip. Observed.
Buttons are disabled while an index change is pending. Inferred from a disabled flag.
Line level has no checkboxes. Monaco context menu group "1_modification" holds actions stageLine "Stage this line" (precondition !hasMultiLineSelection), stageSelection "Stage selected lines" (hasMultiLineSelection), discardLine, discardSelection. Unstage variants use UnstageThisLine. Observed.
File row config also carries lineActionText "+" for unstaged and "-" for staged with the tooltips above, so a +/- glyph per line is expected. Config Observed, rendering Inferred.
Implementation splices the lines of the diff content and writes the result (performContentAction). Inferred that it does not use git apply.
File level: row buttons Stage File, Unstage File, Mark conflicted (btn-warning); group buttons Stage All Changes and Unstage All Changes. Observed.

## 6. Merge conflict tool
Panel class .merge-resolution-panel with .panel-header (min-height 38px) and .panel-content. Observed.
Layout: left and right source panes (.diff3-wrapper.left with border-right, and right), plus an Output pane (.diff3-wrapper.output), each header 35px tall. Left header badge "A" with a branch label, right "B". Observed. Output below the two sources is Inferred from the usual three pane layout.
Output header: title "Output", next and previous conflict controls, and a Reset button (btn btn-xs btn-primary) when reset is possible. Observed.
Each source header has a checkbox: title "Take all" when unchecked, "Untake all" when checked. Hunk and line widgets have checkboxes too, titles "Take this line" and "Don't take this line". Observed.
Strings: conflict {0} of {1}; (1 conflict); ({0} conflicts); Clear Selections; Reset; Save Output; Create Conflict Chunks; Commit; No ancestor file; Binary File; No image; Merge tool automatically resolved your conflict; Applied patch or stash. Observed.
Unresolved save prompt: "You have unresolved conflicts. How would you like to proceed?" with Save Output (success), Create Conflict Chunks (danger), Cancel. Observed.
Editing the output is gated: Premium Source Feature, "to edit file output". Observed.
Colors (dark): left border #15a0bf, right border #f2ca33, output border #c517b6, each background is the border color at 25%; conflict-info-color #15a0bf. Markers are a 4px left border plus tinted fill. Observed in T and C.
Delete vs modify prompts: Keep Base Version, Keep Modified Version, Keep New Version, Delete The File. Observed.
Lists: "Conflicted Files ({0})", "Resolved Files ({0})", "Mark all resolved". Observed. AI auto resolve strings also exist and can be skipped.

## 7. Image and binary
DiffImage-OldImage = Old image; DiffImage-NewImage = New image; DiffImage-ShowDiffOverlay = Diff overlay old image. Observed.
CSS: .diff-image-header monospace bold on panel__bg1; .diff-image-container with section-border. Observed.
Image, submodule and binary files disable the mode, whitespace and wrap buttons. Observed. Text shown is "Binary file". Observed.
