<!--
  The Tools tab's list of the scripts that ship with gEdit (B1 A9). A ribbon group
  component takes no props, so this is `ScriptsMenu` with its scope fixed.
-->
<script lang="ts">
  import ScriptsMenu from './ScriptsMenu.svelte';
</script>

<ScriptsMenu scope="bundled" />
