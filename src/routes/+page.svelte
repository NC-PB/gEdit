<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Ribbon from "../lib/components/Ribbon.svelte";
  import MonacoEditor from "../lib/components/MonacoEditor.svelte";
  import ScriptOutputPanel from "../lib/components/ScriptOutputPanel.svelte";
  import { open, save, message } from "@tauri-apps/plugin-dialog";
  import { readFile, writeFile } from "@tauri-apps/plugin-fs";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { RefreshCw, Wrench, MessageSquare } from "lucide-svelte";

  import { insertCodeBlock } from "../lib/utils/insertBlock";
  import {
    parseProgramStructure,
    type StructureItem,
  } from "../lib/utils/gcodeParser";
  import { detectLanguage } from "../lib/utils/detectLanguage";
  import { DIALECTS, type Dialect } from "../lib/utils/dialects";
  import {
    baseName,
    isMacPlatform,
    isTauriRuntime,
  } from "../lib/utils/platform";
  import {
    UTF8,
    codePointLabel,
    decodeBytes,
    encodeText,
    encodeUtf8,
    encodingLabel,
    unsupportedContent,
    type DecodedText,
    type FileEncoding,
    type Unencodable,
  } from "../lib/utils/textCodec";
  import type { CursorInfo } from "../lib/monaco/types";

  /** Shape of the `run_python_script` command result. */
  interface ScriptResult {
    stdout: string;
    stderr: string;
    success: boolean;
    data: unknown;
  }

  // False in a plain browser (`npm run dev` without Tauri): window APIs are skipped there.
  const IN_TAURI = isTauriRuntime();
  const IS_MAC = isMacPlatform();
  const TREE_REFRESH_DELAY_MS = 300;

  // Buttons of the unsaved-changes prompt. With custom yes/no/cancel buttons the
  // dialog plugin resolves message() to the label of the clicked button.
  const SAVE_LABEL = "Save";
  const DONT_SAVE_LABEL = "Don't Save";
  const CANCEL_LABEL = "Cancel";
  // Offered when the text no longer fits the file's Windows-1252 encoding.
  const SAVE_UTF8_LABEL = "Save as UTF-8";

  const initialContent = "% \nO1000\nG0 X0 Y0\nM30 \n%";

  let activeLanguage: Dialect = "fanuc-gcode";

  // Single Editor Ref
  let editorRef: MonacoEditor | undefined;

  // Document state: null path = untitled buffer
  let currentFilePath: string | null = null;
  // Encoding the file was read with; saving writes the text back in it.
  let fileEncoding: FileEncoding = UTF8;
  let dirty = false;

  // Status bar
  let cursor: CursorInfo = { line: 1, column: 1, selectedChars: 0, selections: 1 };
  let statusMessage = "";
  let statusIsError = false;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  // Browser structure
  let structure: StructureItem[] = [];
  let treeTimer: ReturnType<typeof setTimeout> | undefined;

  // Python Scripts state
  let scriptsFolder = "";
  let availableScripts: string[] = [];
  let scriptStdout = "";
  let scriptStderr = "";
  let scriptData: unknown = null;
  let isScriptRunning = false;
  let showOutputPanel = false;

  let fileOpBusy = false;
  let unlistenClose: UnlistenFn | undefined;
  let destroyed = false;
  let appliedTitle = "";

  $: fileName = currentFilePath ? baseName(currentFilePath) : "Untitled";
  $: applyWindowTitle(`${dirty ? "● " : ""}${fileName} — gEdit`);
  $: onDialectChange(activeLanguage);
  $: cursorLabel =
    `Ln ${cursor.line}, Col ${cursor.column}` +
    (cursor.selections > 1
      ? ` (${cursor.selections} selections)`
      : cursor.selectedChars > 0
        ? ` (${cursor.selectedChars} selected)`
        : "");

  onMount(() => {
    if (IN_TAURI) void registerCloseGuard();
  });

  onDestroy(() => {
    destroyed = true;
    unlistenClose?.();
    unlistenClose = undefined;
    clearTimeout(treeTimer);
    clearTimeout(statusTimer);
  });

  // ---------------------------------------------------------------- status

  function setStatus(text: string, { error = false, sticky = false } = {}) {
    clearTimeout(statusTimer);
    statusMessage = text;
    statusIsError = error;
    statusTimer = sticky
      ? undefined
      : setTimeout(
          () => {
            statusMessage = "";
            statusIsError = false;
          },
          error ? 8000 : 4000,
        );
  }

  function errorText(err: unknown): string {
    if (typeof err === "string") return err;
    if (err instanceof Error) return err.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  /** Shows an error in the status bar and, inside Tauri, as an error dialog. */
  async function reportError(summary: string, err: unknown) {
    const detail = errorText(err);
    console.error(summary, err);
    setStatus(`${summary}: ${detail}`, { error: true });
    if (!IN_TAURI) return;
    try {
      await message(detail, { title: summary, kind: "error" });
    } catch (dialogErr) {
      console.error("Failed to show the error dialog", dialogErr);
    }
  }

  /** File and script features need the Tauri backend; in a plain browser say so instead of failing. */
  function desktopOnly(feature: string): boolean {
    if (IN_TAURI) return true;
    setStatus(`${feature} is only available in the gEdit desktop app`, { error: true });
    return false;
  }

  function applyWindowTitle(title: string) {
    if (title === appliedTitle) return;
    appliedTitle = title;
    document.title = title;
    if (IN_TAURI) {
      getCurrentWindow()
        .setTitle(title)
        .catch((err) => console.error("Failed to set the window title", err));
    }
  }

  // ---------------------------------------------------------------- editor events

  function updateDirty() {
    dirty = editorRef?.isDirty() ?? false;
  }

  function refreshTree() {
    clearTimeout(treeTimer);
    treeTimer = undefined;
    const textToParse = editorRef ? editorRef.getEditorValue() : initialContent;
    structure = parseProgramStructure(textToParse, activeLanguage);
  }

  function scheduleTreeRefresh() {
    clearTimeout(treeTimer);
    treeTimer = setTimeout(refreshTree, TREE_REFRESH_DELAY_MS);
  }

  function onDialectChange(_dialect: Dialect) {
    refreshTree();
  }

  function handleEditorChange() {
    updateDirty();
    scheduleTreeRefresh();
  }

  function handleEditorReady() {
    updateDirty();
    refreshTree();
  }

  function handleCursorChange(info: CursorInfo) {
    cursor = info;
  }

  // ---------------------------------------------------------------- file operations

  /** Runs one file operation at a time (ribbon, shortcuts and the close guard share this). */
  async function exclusive<T>(op: () => Promise<T>): Promise<T | undefined> {
    if (fileOpBusy) return undefined;
    fileOpBusy = true;
    try {
      return await op();
    } finally {
      fileOpBusy = false;
    }
  }

  /**
   * Asks whether a file whose text Windows-1252 cannot store may be saved as UTF-8.
   * Resolves to false on Cancel, which aborts the save (and a pending open or close).
   */
  async function confirmUtf8Fallback(
    path: string,
    { badChar, line, column }: Unencodable,
  ): Promise<boolean> {
    const detail =
      `${baseName(path)} uses the Windows-1252 encoding, which cannot store "${badChar}" ` +
      `(${codePointLabel(badChar)}, line ${line}, column ${column}).\n\n` +
      "Save it as UTF-8 instead? Software that expects Windows-1252 may then show accented characters incorrectly.";
    if (!IN_TAURI) return window.confirm(detail);
    try {
      // Two custom buttons must be ok/cancel (the plugin ignores yes/cancel); the clicked label comes back.
      const choice = await message(detail, {
        title: "Encoding",
        kind: "warning",
        buttons: { ok: SAVE_UTF8_LABEL, cancel: CANCEL_LABEL },
      });
      return choice === SAVE_UTF8_LABEL;
    } catch (err) {
      await reportError("Could not ask about the file encoding", err);
      return false;
    }
  }

  async function writeDocument(path: string): Promise<boolean> {
    const text = editorRef ? editorRef.getEditorValue() : initialContent;
    const savedVersion = editorRef?.getVersionId();

    // Keep the file's encoding; switch to UTF-8 only if the user agrees.
    let encoding = fileEncoding;
    let bytes: Uint8Array;
    const encoded = encodeText(text, encoding);
    if (encoded.ok) {
      bytes = encoded.bytes;
    } else {
      if (!(await confirmUtf8Fallback(path, encoded))) return false;
      encoding = UTF8;
      bytes = encodeUtf8(text);
    }

    try {
      await writeFile(path, bytes);
    } catch (err) {
      await reportError(`Could not save ${baseName(path)}`, err);
      return false;
    }
    const switchedToUtf8 = encoding !== fileEncoding;
    currentFilePath = path;
    fileEncoding = encoding;
    // Mark the version that was written as clean (edits made during the write stay dirty).
    editorRef?.markClean(savedVersion);
    updateDirty();
    setStatus(`Saved ${baseName(path)}${switchedToUtf8 ? " as UTF-8" : ""}`);
    return true;
  }

  /** Asks for a target file and saves there. Resolves to false if cancelled or failed. */
  async function saveDocumentAs(): Promise<boolean> {
    if (!desktopOnly("Saving files")) return false;
    const dialect = DIALECTS[activeLanguage];
    const otherFilters = (Object.keys(DIALECTS) as Dialect[])
      .filter((d) => d !== activeLanguage)
      .map((d) => ({ name: DIALECTS[d].filterName, extensions: DIALECTS[d].extensions }));
    let path: string | null;
    try {
      path = await save({
        title: "Save As",
        defaultPath: currentFilePath ?? dialect.defaultFileName,
        filters: [{ name: dialect.filterName, extensions: dialect.extensions }, ...otherFilters],
      });
    } catch (err) {
      await reportError("Could not open the save dialog", err);
      return false;
    }
    if (!path) return false; // dialog cancelled
    return writeDocument(path);
  }

  /** Uses the read permission gEdit already has; any read failure counts as missing. */
  async function fileStillExists(path: string): Promise<boolean> {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Saves to the current file, or falls through to Save As for an untitled buffer. */
  async function saveDocument(): Promise<boolean> {
    if (!currentFilePath) return saveDocumentAs();
    // Rewriting an unchanged file could only alter it (e.g. normalized line endings),
    // unless it has disappeared from disk since it was opened or saved.
    updateDirty();
    if (!dirty && (await fileStillExists(currentFilePath))) {
      setStatus(`${baseName(currentFilePath)} is unchanged since it was last opened or saved`);
      return true;
    }
    return writeDocument(currentFilePath);
  }

  /**
   * If the buffer has unsaved changes, asks Save / Don't Save / Cancel.
   * Resolves to true when it is fine to discard the buffer.
   */
  async function resolveUnsavedChanges(): Promise<boolean> {
    updateDirty();
    if (!dirty) return true;

    let choice: string;
    if (IN_TAURI) {
      try {
        choice = await message(
          `Do you want to save the changes you made to ${fileName}?\n\nYour changes will be lost if you don't save them.`,
          {
            title: "Unsaved Changes",
            kind: "warning",
            buttons: { yes: SAVE_LABEL, no: DONT_SAVE_LABEL, cancel: CANCEL_LABEL },
          },
        );
      } catch (err) {
        await reportError("Could not ask about unsaved changes", err);
        return false;
      }
    } else {
      choice = window.confirm(`${fileName} has unsaved changes. Discard them?`)
        ? DONT_SAVE_LABEL
        : CANCEL_LABEL;
    }

    if (choice === SAVE_LABEL) return saveDocument(); // false if the save was cancelled or failed
    if (choice === DONT_SAVE_LABEL) return true;
    return false; // Cancel, Escape or anything unexpected
  }

  async function openDocument(): Promise<void> {
    if (!desktopOnly("Opening files")) return;
    let selected: string | string[] | null;
    try {
      selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "NC Programs", extensions: ["nc", "h", "min", "txt"] }],
      });
    } catch (err) {
      await reportError("Could not open the file dialog", err);
      return;
    }
    if (typeof selected !== "string") return; // dialog cancelled

    // Ask before reading, so choosing "Save" on the file being reopened loads the saved text.
    if (!(await resolveUnsavedChanges())) return;

    let decoded: DecodedText;
    try {
      const bytes = await readFile(selected);
      const unsupported = unsupportedContent(bytes);
      if (unsupported) throw new Error(`Refusing to open it because ${unsupported}.`);
      decoded = decodeBytes(bytes);
    } catch (err) {
      await reportError(`Could not open ${baseName(selected)}`, err);
      return;
    }
    const { text, encoding, hasBom } = decoded;

    const dialect = detectLanguage(selected, text, activeLanguage);
    activeLanguage = dialect;
    editorRef?.loadDocument(text, dialect); // sets the language before the text
    currentFilePath = selected;
    fileEncoding = { encoding, hasBom };
    updateDirty();
    refreshTree();
    setStatus(
      `Opened ${baseName(selected)} (${DIALECTS[dialect].label})` +
        (encoding === "windows-1252" ? " as Windows-1252 (not valid UTF-8)" : ""),
    );
    editorRef?.focus();
  }

  async function registerCloseGuard() {
    try {
      const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        // Busy (e.g. a save dialog is open) or the user cancelled: keep the window.
        const mayClose = await exclusive(resolveUnsavedChanges);
        if (mayClose !== true) event.preventDefault();
      });
      if (destroyed) unlisten();
      else unlistenClose = unlisten;
    } catch (err) {
      await reportError("Could not install the unsaved-changes guard", err);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing || e.altKey) return;
    const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (!mod) return;

    const key = typeof e.key === "string" ? e.key.toLowerCase() : ""; // synthetic events may lack `key`
    let action: (() => Promise<unknown>) | undefined;
    if (key === "s") action = e.shiftKey ? saveDocumentAs : saveDocument;
    else if (key === "o" && !e.shiftKey) action = openDocument;
    if (!action) return;

    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) void exclusive(action);
  }

  function handleBeforeUnload(e: BeforeUnloadEvent) {
    // Plain-browser only; inside Tauri the close-requested guard handles this.
    if (!IN_TAURI && editorRef?.isDirty()) e.preventDefault();
  }

  // ---------------------------------------------------------------- blocks & scripts

  function handleInsertBlock(blockType: string) {
    insertCodeBlock(activeLanguage, blockType, editorRef);
  }

  async function handleSetScriptsFolder() {
    if (!desktopOnly("Python scripts")) return;
    let selectedPath: string | string[] | null;
    try {
      selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Python Scripts Folder",
      });
    } catch (err) {
      await reportError("Could not open the folder dialog", err);
      return;
    }
    if (typeof selectedPath !== "string") return;

    scriptsFolder = selectedPath;
    try {
      availableScripts = await invoke<string[]>("list_python_scripts", {
        folderPath: scriptsFolder,
      });
      setStatus(
        availableScripts.length > 0
          ? `Found ${availableScripts.length} script(s) in ${baseName(scriptsFolder)}`
          : `No .py files found in ${baseName(scriptsFolder)}`,
      );
    } catch (err) {
      availableScripts = [];
      await reportError("Could not list the Python scripts", err);
    }
  }

  async function handleRunScript(scriptName: string) {
    if (!scriptsFolder || !scriptName || isScriptRunning) return;

    // Get selected text, fall back to full editor content
    const inputText = editorRef
      ? editorRef.getSelectedText() || editorRef.getEditorValue()
      : initialContent;

    isScriptRunning = true;
    showOutputPanel = true;
    scriptStdout = "";
    scriptStderr = "";
    scriptData = null;
    setStatus(`Running ${scriptName}…`, { sticky: true });

    try {
      // The backend joins folder + name and validates the name.
      const result = await invoke<ScriptResult>("run_python_script", {
        folderPath: scriptsFolder,
        scriptName,
        inputText,
      });
      scriptStdout = result.stdout || "";
      scriptStderr = result.stderr || "";
      scriptData = result.data ?? null;
      if (result.success) setStatus(`${scriptName} finished`);
      else setStatus(`${scriptName} failed, see Script Output`, { error: true });
    } catch (err) {
      scriptStderr = errorText(err) || "Unknown error";
      setStatus(`Could not run ${scriptName}: ${scriptStderr}`, { error: true });
    } finally {
      isScriptRunning = false;
    }
  }

  function handleCloseOutputPanel() {
    showOutputPanel = false;
  }
</script>

<svelte:window on:keydown={handleKeydown} on:beforeunload={handleBeforeUnload} />

<div
  class="flex flex-col h-screen w-screen overflow-hidden"
  style="background-color: var(--bg-app);"
>
  <!-- Ribbon Toolbar -->
  <Ribbon
    bind:activeLanguage
    onOpen={() => exclusive(openDocument)}
    onSave={() => exclusive(saveDocument)}
    onSaveAs={() => exclusive(saveDocumentAs)}
    onInsertBlock={handleInsertBlock}
    onSetScriptsFolder={handleSetScriptsFolder}
    onRunScript={handleRunScript}
    {scriptsFolder}
    {availableScripts}
  />

  <!-- Main Application Body -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Left Browser Panel -->
    <div
      class="w-64 flex flex-col flex-shrink-0"
      style="background-color: var(--bg-panel); border-right: 1px solid var(--border-color);"
    >
      <!-- Browser Header -->
      <div
        class="px-3 py-1.5 flex justify-between items-center bg-[var(--bg-ribbon)] border-b border-[var(--border-color)]"
      >
        <span
          class="text-xs font-semibold uppercase tracking-wider text-[var(--text-main)]"
          >Browser</span
        >
        <button on:click={refreshTree} title="Refresh Structure">
          <RefreshCw
            size={14}
            class="text-[var(--text-muted)] hover:text-[#0078d4] cursor-pointer transition-colors"
          />
        </button>
      </div>

      <!-- Tree Content -->
      <div class="p-2 flex-1 overflow-y-auto">
        <div
          class="flex flex-col gap-1 text-sm pt-1"
          style="color: var(--text-main);"
        >
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-white/5"
            on:click={refreshTree}
          >
            <span
              class="w-4 h-4 flex items-center justify-center border border-current opacity-50 text-[10px] bg-black/20"
              >-</span
            >
            <span class="font-medium text-slate-300">Program Map</span>
          </div>

          {#each structure as item (item.id)}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
              class="flex items-center gap-2 px-2 py-1 ml-4 rounded cursor-pointer hover:bg-white/5 opacity-80"
              style="color: var(--text-muted);"
              title="Line {item.line}"
              on:click={() => editorRef?.alignToLine(item.line)}
            >
              <div
                style="width: 10px; height: 10px; border-left: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); margin-left: -12px; margin-top: -8px;"
              ></div>

              {#if item.type === "tool"}
                <Wrench size={14} class="text-[#dcb67a] flex-shrink-0" />
                <span class="text-slate-200 truncate">{item.text}</span>
              {:else}
                <MessageSquare size={14} class="text-[#10b981] flex-shrink-0" />
                <span class="italic text-slate-400 truncate">{item.text}</span>
              {/if}
            </div>
          {/each}

          {#if structure.length === 0}
            <div class="ml-6 py-2 text-xs italic opacity-50 text-slate-400">
              No Tool Calls or independent comments found in program.
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Main Viewport (Editor) -->
    <div
      class="flex-1 flex flex-col relative bg-black/20"
      style="min-width: 0;"
    >
      <MonacoEditor
        bind:this={editorRef}
        language={activeLanguage}
        text={initialContent}
        onChange={handleEditorChange}
        onCursorChange={handleCursorChange}
        onReady={handleEditorReady}
      />
    </div>

    <!-- Right Output Panel -->
    <ScriptOutputPanel
      stdout={scriptStdout}
      stderr={scriptStderr}
      data={scriptData}
      isRunning={isScriptRunning}
      visible={showOutputPanel}
      onClose={handleCloseOutputPanel}
    />
  </div>

  <!-- Status Bar -->
  <div
    class="flex items-center justify-between gap-4 px-3 h-6 flex-shrink-0 text-[11px]"
    style="background-color: var(--accent); color: white;"
  >
    <div class="flex items-center gap-3 min-w-0">
      <span class="truncate flex-shrink-0" title={currentFilePath ?? "Untitled"}
        >{fileName}{dirty ? " ● Modified" : ""}</span
      >
      {#if statusMessage}
        <span
          class="truncate {statusIsError ? 'bg-[#c42b1c] px-1.5 rounded-sm' : 'opacity-90'}"
          role={statusIsError ? "alert" : "status"}
          title={statusMessage}>{statusMessage}</span
        >
      {/if}
    </div>
    <div class="flex items-center gap-4 flex-shrink-0">
      <span>{DIALECTS[activeLanguage].label}</span>
      <span>{encodingLabel(fileEncoding)}</span>
      <span>{cursorLabel}</span>
    </div>
  </div>
</div>
