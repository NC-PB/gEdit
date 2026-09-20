<!--
  The status bar (plan §5 WP1.5, §7.9). Owner: WP1.5.

  One item belongs to the shell itself and is rendered here: the single status message
  (`data-item="message"`), because `status.current` is shell state and no contribution
  provides it. Everything else - the file name (WP1.6's `contrib/files.ts`), profile,
  encoding, EOL and the cursor (WP1.2) - is a registered status item, sorted by the
  registry (left first, then `order`, then registration).

  I2: the file name used to be hard-coded here as well as registered by `contrib/files.ts`,
  which put two `data-item="file"` elements in the DOM. §7.9 allows one element per
  `data-item`, so the registered one won and this renders only the message.

  The message sits after the registered left items so that a transient message never
  shifts a stable item.
-->
<script lang="ts">
  import { status } from '$lib/app/status';
  import { statusItems } from '$lib/app/registry/statusItems';
  import { t } from '$lib/i18n';

  const items = statusItems.items;
  const message = status.current;

  const left = $derived($items.filter((item) => item.side === 'left'));
  const right = $derived($items.filter((item) => item.side === 'right'));
</script>

<div class="status-bar" data-testid="status-bar" aria-label={t('shell.statusBar')}>
  <div class="side">
    {#each left as item (item.id)}
      {@const Item = item.component}
      <Item />
    {/each}
    <!-- The wrapper is transparent to the layout, so the inner span is the flex item. -->
    <span class="message-slot" data-testid="status-item" data-item="message">
      {#if $message}
        <span
          class="message"
          class:error={$message.error}
          role={$message.error ? 'alert' : 'status'}
          title={$message.detail ?? $message.text}
          data-testid="status-message"
          data-error={$message.error ? '1' : '0'}>{$message.text}</span
        >
      {/if}
    </span>
  </div>
  <div class="side right">
    {#each right as item (item.id)}
      {@const Item = item.component}
      <Item />
    {/each}
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 24px;
    padding: 0 12px;
    color: var(--status-text);
    font-size: 11px;
    background-color: var(--status-bg);
  }

  .side {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .side.right {
    flex: 0 0 auto;
    gap: 16px;
  }

  .message-slot {
    display: contents;
  }

  .message {
    flex: 0 1 auto;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    opacity: 0.9;
  }
  .message.error {
    padding: 0 6px;
    background-color: var(--danger);
    border-radius: 2px;
    opacity: 1;
  }
</style>
