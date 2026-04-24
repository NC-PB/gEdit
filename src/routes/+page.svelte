<script lang="ts">
  import { onMount } from "svelte";
  import Ribbon from "../lib/components/Ribbon.svelte";
  import MonacoEditor from "../lib/components/MonacoEditor.svelte";
  import ScriptOutputPanel from "../lib/components/ScriptOutputPanel.svelte";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
  import { invoke } from "@tauri-apps/api/core";
  import { RefreshCw, Wrench, MessageSquare } from "lucide-svelte";

  import { insertCodeBlock } from "../lib/utils/insertBlock";
  import {
    parseProgramStructure,
    type StructureItem,
  } from "../lib/utils/gcodeParser";

  // Monaco initialization for custom languages
  import loader from "@monaco-editor/loader";
  import {
    fanucLanguageDef,
    getFanucCompletions,
  } from "../lib/languages/fanuc";
  import {
    heidenhainLanguageDef,
    getHeidenhainCompletions,
  } from "../lib/languages/heidenhain";

  let monacoInstance: any;

  onMount(async () => {
    monacoInstance = await loader.init();

    // Register custom languages
    monacoInstance.languages.register({ id: "fanuc-gcode" });
    monacoInstance.languages.setMonarchTokensProvider(
      "fanuc-gcode",
      fanucLanguageDef,
    );
    monacoInstance.languages.registerCompletionItemProvider(
      "fanuc-gcode",
      getFanucCompletions(monacoInstance),
    );

    monacoInstance.languages.register({ id: "heidenhain-klartext" });
    monacoInstance.languages.setMonarchTokensProvider(
      "heidenhain-klartext",
      heidenhainLanguageDef,
    );
    monacoInstance.languages.registerCompletionItemProvider(
      "heidenhain-klartext",
      getHeidenhainCompletions(monacoInstance),
    );
  });

  let activeLanguage = "fanuc-gcode";

  // Single Editor Ref
  let editorRef: any;
  let editorContent = "% \nO1000\nG0 X0 Y0\nM30 \n%";

  // Browser structure
  let structure: StructureItem[] = [];

  // Python Scripts state
  let scriptsFolder = "";
  let availableScripts: string[] = [];
  let scriptStdout = "";
  let scriptStderr = "";
  let isScriptRunning = false;
  let showOutputPanel = false;

  function refreshTree() {
    const textToParse = editorRef ? editorRef.getEditorValue() : editorContent;
    structure = parseProgramStructure(textToParse, activeLanguage);
  }

  async function handleOpen() {
    const selectedPath = await open({
      multiple: false,
      filters: [{ name: "G-Code", extensions: ["nc", "txt", "h", "min"] }],
    });

    if (typeof selectedPath === "string") {
      try {
        const text = await readTextFile(selectedPath);
        if (editorRef) {
          editorRef.setEditorValue(text);
        }
      } catch (err) {
        console.error("Failed to read file", err);
      }
    }
  }

  async function handleSave() {
    const textToSave = editorRef ? editorRef.getEditorValue() : editorContent;

    const savePath = await save({
      filters: [{ name: "G-Code", extensions: ["nc", "txt", "h"] }],
    });

    if (typeof savePath === "string") {
      try {
        await writeTextFile(savePath, textToSave);
      } catch (err) {
        console.error("Failed to save file", err);
      }
    }
  }

  function handleInsertBlock(blockType: string) {
    insertCodeBlock(activeLanguage, blockType, editorRef);
  }

  async function handleSetScriptsFolder() {
    //DEBUG
    console.log("SET SCRIPTS FOLDER ECECUTE");

    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Select Python Scripts Folder",
    });

    if (typeof selectedPath === "string") {
      scriptsFolder = selectedPath;
      try {
        availableScripts = await invoke("list_python_scripts", {
          folderPath: scriptsFolder,
        });
      } catch (err) {
        console.error("Failed to list scripts", err);
        availableScripts = [];
      }
    }
  }

  let scriptData: any = null;

  async function handleRunScript(scriptName: string) {
    console.log("RUN SCRIPT ECECUTE (+page.svelte, handleRunScript)");
    if (!scriptsFolder || !scriptName) return;

    // Get selected text, fall back to full editor content
    let inputText = "";
    if (editorRef) {
      inputText = editorRef.getSelectedText();
      if (!inputText) {
        inputText = editorRef.getEditorValue();
      }
    } else {
      inputText = editorContent;
    }

    const scriptPath = scriptsFolder + "\\" + scriptName;

    isScriptRunning = true;
    showOutputPanel = true;
    scriptStdout = "";
    scriptStderr = "";
    scriptData = null;

    try {
      const result: any = await invoke("run_python_script", {
        scriptPath,
        inputText,
      });
      scriptStdout = result.stdout || "";
      scriptStderr = result.stderr || "";
      scriptData = result.data;
      console.log("Script Execution Successful. Data:", scriptData);
    } catch (err: any) {
      scriptStderr =
        typeof err === "string" ? err : err?.message || "Unknown error";
    } finally {
      isScriptRunning = false;
    }
  }

  function handleCloseOutputPanel() {
    showOutputPanel = false;
  }
</script>

<div
  class="flex flex-col h-screen w-screen overflow-hidden"
  style="background-color: var(--bg-app);"
>
  <!-- Ribbon Toolbar -->
  <Ribbon
    bind:activeLanguage
    onOpen={handleOpen}
    onSave={handleSave}
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

          {#each structure as item}
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
        text={editorContent}
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
    class="flex items-center justify-between px-3 h-6 flex-shrink-0 text-[11px]"
    style="background-color: var(--accent); color: white;"
  >
    <div class="flex items-center gap-4">
      <span>Ready</span>
    </div>
    <div class="flex items-center gap-4">
      <span>{activeLanguage === "fanuc-gcode" ? "Fanuc" : "Heidenhain"}</span>
      <span>UTF-8</span>
      <span>Ln 1, Col 1</span>
    </div>
  </div>
</div>
