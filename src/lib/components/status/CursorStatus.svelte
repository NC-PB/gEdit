<!--
  The cursor / selection status item (plan §5 WP1.2, §7.9: `status-item` with
  `data-item="cursor"`).

  Fed by `editor.onDidChangeCursor`, which the editor service throttles to one animation
  frame, so a fast cursor move repaints the status bar at most once per frame.
  The text keeps the M0 shape "Ln 1, Col 1 (3 selected)"; the runtime scenarios read it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '$lib/monaco/editorService';
  import { t } from '$lib/i18n';
  import type { CursorInfo } from '$lib/app/types';

  const NO_CURSOR: CursorInfo = { line: 1, column: 1, selectedChars: 0, selections: 1 };

  let info = $state<CursorInfo>(NO_CURSOR);

  const label = $derived(
    t('editor.position', { line: info.line, column: info.column }) +
      (info.selections > 1
        ? ` ${t('editor.selectionCount', { count: info.selections })}`
        : info.selectedChars > 0
          ? ` ${t('editor.selectedChars', { count: info.selectedChars })}`
          : ''),
  );

  onMount(() => {
    info = editor.cursor() ?? NO_CURSOR;
    return editor.onDidChangeCursor((next) => {
      info = next;
    });
  });
</script>

<span data-testid="status-item" data-item="cursor">{label}</span>
