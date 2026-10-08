<!--
  The channel of the active document (plan §7.12: `status-item` with `data-item="channel"`,
  AD-32). Registered by `contrib/channels.ts`, next to the machine item.

  Hidden unless the document's machine declares channels and this document is one of them:
    - one program with sections: the channel the cursor is in ("Channel: Turret A");
    - one file per channel: "Turret A (1 of 2)", then what is wrong with the others
      ("Turret B not open", "Turret B not found"); a file that could not be checked says so;
    - a machine that is set up for one file per channel but a file no name or marker claims:
      "Channel: not set", and the click offers the assignment;
    - broken channel settings: "Channel rules are broken";
    - a program that took too long to read: "Channels: too slow to read" (M12 fix F4).
  Channel names are the machine's own text and stay untranslated.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { channelStatusView } from './channelStatusView';
  import { commands } from '$lib/app/registry/commands';
  import { editor } from '$lib/monaco/editorService';
  import { channels } from '$lib/stores/channels';
  import { docs } from '$lib/stores/documents';

  const active = docs.active;
  const revision = channels.revision;
  let cursorLine = $state(editor.cursor()?.line ?? 0);

  // A document that was just made active: the cursor it has, not the one the last one had.
  $effect(() => {
    void $active?.id;
    cursorLine = editor.cursor()?.line ?? 0;
  });

  onMount(() =>
    editor.onDidChangeCursor((info) => {
      cursorLine = info.line;
    }),
  );

  const view = $derived.by(() => {
    void $revision;
    const doc = $active;
    if (!doc) return null;
    return channelStatusView({
      set: channels.forDoc(doc.id),
      params: channels.params(doc.id),
      unassigned: channels.unassigned(doc.id),
      cursorLine,
      channelAt: (line) => channels.channelAt(doc.id, line),
    });
  });
</script>

{#if view}
  <button
    class="item"
    class:broken={view.broken}
    type="button"
    title={view.tooltip}
    onclick={() => void commands.run('channels.select')}
    data-testid="status-item"
    data-item="channel"
    data-channel-id={view.id}
    data-channel-count={view.count}
    data-layout={view.layout}
    data-missing={view.missing}
    data-open={view.open}
    data-slow={view.slow ? '1' : undefined}
  >
    {view.label}
  </button>
{/if}

<style>
  .item {
    padding: 0 4px;
    color: inherit;
    font: inherit;
    background: transparent;
    border: 0;
    border-radius: 2px;
    cursor: pointer;
  }
  .item:hover:enabled {
    background-color: rgb(255 255 255 / 20%);
  }
  .item:focus-visible {
    outline: 1px solid currentcolor;
    outline-offset: -1px;
  }
  .broken {
    text-decoration: underline wavy;
  }
</style>
