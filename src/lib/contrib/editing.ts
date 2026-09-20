// Monaco's editing features, in the ribbon (plan §5 WP4.4). Owner: WP4.4.
// One feature per file (plan AD-3); see ./README.md.
//
// Everything Monaco can already do and nobody can find: undo, find and replace, the line
// operations, folding, the quick outline, the display toggles and the font zoom. The
// commands are thin — `editor.focus()` and then the Monaco action — but they are what
// puts those features on the Home and View tabs and into one enablement rule.
//
// Three rules hold this file together:
//
//  1. **No shortcuts.** Monaco brings its own (Mod+Z, Mod+F, Mod+Shift+O, …) and they
//     keep working; a `keys` here would be a second claim on the same key, which the
//     command registry reports as a `console.error` and the runtime harness fails on.
//     §7.11 lists every binding the app assigns, and none of them is in this file.
//  2. **`palette: false`, except for three.** F1 lists Monaco's *editor actions* itself,
//     so a `gedit.*` twin would only duplicate the entry. `undo`, `redo` and
//     `editor.action.selectAll` are plain commands (`MultiCommand`), which the standalone
//     palette does not list — those three keep their entry and are the reason the rule is
//     "where F1 already lists it" and not "always".
//  3. **`editor.focus()` first.** `undo`, `redo` and `editor.action.selectAll` resolve
//     through `getFocusedCodeEditor()`, and the find widget and the quick outline open
//     inside the editor. Clicking a ribbon button moves focus to the button, so without
//     the focus call the ribbon's Undo would run the browser's own undo on the button.
//     `contrib/palette.ts` does the same for F1.
//
// The four display toggles are not Monaco actions but settings: they write
// `editor.renderWhitespace`, `editor.wordWrap`, `editor.minimap` and
// `editor.stickyScroll`, and `monaco/editorOptions.ts` (subscribed by `contrib/theme.ts`)
// is the single place that applies them. That is what makes the ribbon button, the
// settings dialog and `settings.json` agree, and it is why the button persists while the
// font zoom — a Monaco action with no setting behind it — does not.

import ArrowDown from 'lucide-svelte/icons/arrow-down';
import ArrowUp from 'lucide-svelte/icons/arrow-up';
import CaseLower from 'lucide-svelte/icons/case-lower';
import CaseUpper from 'lucide-svelte/icons/case-upper';
import CopyPlus from 'lucide-svelte/icons/copy-plus';
import CornerDownLeft from 'lucide-svelte/icons/corner-down-left';
import FoldVertical from 'lucide-svelte/icons/fold-vertical';
import ListTree from 'lucide-svelte/icons/list-tree';
import MapIcon from 'lucide-svelte/icons/map';
import MessageSquare from 'lucide-svelte/icons/message-square';
import Pilcrow from 'lucide-svelte/icons/pilcrow';
import Pin from 'lucide-svelte/icons/pin';
import Redo2 from 'lucide-svelte/icons/redo-2';
import Replace from 'lucide-svelte/icons/replace';
import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
import Search from 'lucide-svelte/icons/search';
import TextSelect from 'lucide-svelte/icons/text-select';
import Trash2 from 'lucide-svelte/icons/trash-2';
import Undo2 from 'lucide-svelte/icons/undo-2';
import UnfoldVertical from 'lucide-svelte/icons/unfold-vertical';
import ZoomIn from 'lucide-svelte/icons/zoom-in';
import ZoomOut from 'lucide-svelte/icons/zoom-out';
import { asIcon } from '$lib/app/icons';
import { status } from '$lib/app/status';
import { editor } from '$lib/monaco/editorService';
import { settings } from '$lib/stores/settings';
import { t } from '$lib/i18n';
import type { Settings } from '$lib/core/settings/schema';
import type {
  CommandContext,
  CommandDef,
  Contribution,
  RibbonItemDef,
  RibbonTab,
} from '$lib/app/types';

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

/** Focus first, then the action: see rule 3 in the file header. */
function runAction(actionId: string): void {
  editor.focus();
  editor.triggerAction(actionId);
}

/** One ribbon button that wraps one Monaco action or command. */
interface ActionSpec {
  /** gEdit command id (plan §7.11 names none of these, because none has a shortcut). */
  id: string;
  /** i18n key in the `editing` namespace. */
  title: string;
  icon: CommandDef['icon'];
  /** The Monaco action or command id `editor.trigger` is called with. */
  action: string;
  /** True only for the three that F1 does not list; see rule 2 in the file header. */
  palette?: true;
}

/**
 * Home → Edit. `undo` and `redo` are Monaco's `MultiCommand`s, not editor actions, which
 * is why they carry `palette` and the rest do not.
 */
const EDIT: ActionSpec[] = [
  { id: 'edit.undo', title: 'editing.undo', icon: asIcon(Undo2), action: 'undo', palette: true },
  { id: 'edit.redo', title: 'editing.redo', icon: asIcon(Redo2), action: 'redo', palette: true },
  { id: 'edit.find', title: 'editing.find', icon: asIcon(Search), action: 'actions.find' },
  {
    id: 'edit.replace',
    title: 'editing.replace',
    icon: asIcon(Replace),
    action: 'editor.action.startFindReplaceAction',
  },
  {
    id: 'edit.toggleComment',
    title: 'editing.toggleComment',
    icon: asIcon(MessageSquare),
    action: 'editor.action.commentLine',
  },
  {
    id: 'edit.duplicateLine',
    title: 'editing.duplicateLine',
    icon: asIcon(CopyPlus),
    action: 'editor.action.copyLinesDownAction',
  },
  {
    id: 'edit.moveLineUp',
    title: 'editing.moveLineUp',
    icon: asIcon(ArrowUp),
    action: 'editor.action.moveLinesUpAction',
  },
  {
    id: 'edit.moveLineDown',
    title: 'editing.moveLineDown',
    icon: asIcon(ArrowDown),
    action: 'editor.action.moveLinesDownAction',
  },
  {
    id: 'edit.deleteLine',
    title: 'editing.deleteLine',
    icon: asIcon(Trash2),
    action: 'editor.action.deleteLines',
  },
  {
    id: 'edit.selectAll',
    title: 'editing.selectAll',
    icon: asIcon(TextSelect),
    action: 'editor.action.selectAll',
    palette: true,
  },
  {
    id: 'edit.upperCase',
    title: 'editing.upperCase',
    icon: asIcon(CaseUpper),
    action: 'editor.action.transformToUppercase',
  },
  {
    id: 'edit.lowerCase',
    title: 'editing.lowerCase',
    icon: asIcon(CaseLower),
    action: 'editor.action.transformToLowercase',
  },
];

/** View → Code: folding and the symbol list M3's provider feeds. */
const CODE: ActionSpec[] = [
  { id: 'view.foldAll', title: 'editing.foldAll', icon: asIcon(FoldVertical), action: 'editor.foldAll' },
  {
    id: 'view.unfoldAll',
    title: 'editing.unfoldAll',
    icon: asIcon(UnfoldVertical),
    action: 'editor.unfoldAll',
  },
  {
    id: 'view.quickOutline',
    title: 'editing.quickOutline',
    icon: asIcon(ListTree),
    action: 'editor.action.quickOutline',
  },
];

/** View → Zoom. Monaco's font zoom is session-only; it writes no setting. */
const ZOOM: ActionSpec[] = [
  { id: 'view.zoomIn', title: 'editing.zoomIn', icon: asIcon(ZoomIn), action: 'editor.action.fontZoomIn' },
  { id: 'view.zoomOut', title: 'editing.zoomOut', icon: asIcon(ZoomOut), action: 'editor.action.fontZoomOut' },
  {
    id: 'view.zoomReset',
    title: 'editing.zoomReset',
    icon: asIcon(RotateCcw),
    action: 'editor.action.fontZoomReset',
  },
];

/** `category` decides the F1 label, so the View-tab wrappers do not read "Edit: Fold All". */
function actionCommand(category: string): (spec: ActionSpec) => CommandDef {
  return (spec) => ({
    id: spec.id,
    title: spec.title,
    category,
    icon: spec.icon,
    palette: spec.palette === true,
    enabled: hasDocument,
    run: () => runAction(spec.action),
  });
}

/** Writes the flipped setting and says what happened; `name` is already translated. */
async function toggleSetting(patch: Partial<Settings>, name: string, on: boolean): Promise<void> {
  await settings.save(patch);
  status.show(on ? t('editing.turnedOn', { name }) : t('editing.turnedOff', { name }));
}

/**
 * View → Display. Unlike the action wrappers these are always enabled: they are settings,
 * and a window with no document open may still be configured.
 */
const TOGGLES: CommandDef[] = [
  {
    id: 'view.toggleWhitespace',
    title: 'editing.toggleWhitespace',
    category: 'editing.categoryView',
    icon: asIcon(Pilcrow),
    // Three values, one button: anything but 'none' counts as on, and on means 'all'.
    run: () => {
      const on = settings.get('editor.renderWhitespace') === 'none';
      return toggleSetting({ 'editor.renderWhitespace': on ? 'all' : 'none' }, t('editing.whitespace'), on);
    },
  },
  {
    id: 'view.toggleWordWrap',
    title: 'editing.toggleWordWrap',
    category: 'editing.categoryView',
    icon: asIcon(CornerDownLeft),
    run: () => {
      const on = !settings.get('editor.wordWrap');
      return toggleSetting({ 'editor.wordWrap': on }, t('editing.wordWrap'), on);
    },
  },
  {
    id: 'view.toggleMinimap',
    title: 'editing.toggleMinimap',
    category: 'editing.categoryView',
    icon: asIcon(MapIcon),
    run: () => {
      const on = !settings.get('editor.minimap');
      return toggleSetting({ 'editor.minimap': on }, t('editing.minimap'), on);
    },
  },
  {
    id: 'view.toggleStickyScroll',
    title: 'editing.toggleStickyScroll',
    category: 'editing.categoryView',
    icon: asIcon(Pin),
    run: () => {
      const on = !settings.get('editor.stickyScroll');
      return toggleSetting({ 'editor.stickyScroll': on }, t('editing.stickyScroll'), on);
    },
  },
];

/**
 * A group's place in its tab is the smallest `order` any of its items carries, and an
 * item's place inside the group is that same number (`components/shell/ribbonModel.ts`).
 * One counter per group therefore decides both, which is why the bases are spread out:
 * 40, 50 and 60 keep Code, Display and Zoom in that order and all three ahead of the
 * Appearance (90), Settings (95) and Help (100) groups of the View tab.
 */
function ribbonItems(specs: { id: string }[], tab: RibbonTab, group: string, base: number): RibbonItemDef[] {
  return specs.map((spec, i) => ({ tab, group, command: spec.id, order: base + i }));
}

export default {
  id: 'editing',
  commands: [
    ...EDIT.map(actionCommand('editing.category')),
    ...CODE.map(actionCommand('editing.categoryView')),
    ...ZOOM.map(actionCommand('editing.categoryView')),
    ...TOGGLES,
  ],
  ribbon: [
    // 110 leaves the Home tab's File (10-60), Recent (15) and Program (20) groups in front.
    ...ribbonItems(EDIT, 'home', 'editing.groupEdit', 110),
    ...ribbonItems(CODE, 'view', 'editing.groupCode', 40),
    ...ribbonItems(TOGGLES, 'view', 'editing.groupDisplay', 50),
    ...ribbonItems(ZOOM, 'view', 'editing.groupZoom', 60),
  ],
} satisfies Contribution;
