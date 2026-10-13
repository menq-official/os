import type { DictKey } from '../i18n/en';
import type { Lang } from '../domain/enums';
import { STR as BRIDGE_STR } from '../features/Bridge.strings';

export type RouteId =
  | 'home' | 'command' | 'chat' | 'groupChat' | 'projects' | 'tasks' | 'agents'
  | 'knowledge' | 'memory' | 'decisions' | 'bridge' | 'research' | 'library'
  | 'calendar' | 'automations' | 'approvals' | 'activity' | 'notifications'
  | 'files' | 'integrations' | 'analytics' | 'security' | 'settings';

/** A trilingual string authored next to the page that owns it, rather than in the
 *  shared `i18n/*.ts` dictionaries. Same shape as a `*.strings.ts` entry. */
export type NavCopy = Readonly<Record<Lang, string>>;

export interface NavItem {
  id: RouteId;
  labelKey: DictKey;
  subtitleKey: DictKey;
  /** Inline trilingual copy owned by the page itself. When present it WINS over
   *  `labelKey` — see `navLabel`. Used by pages that keep all of their copy in a
   *  co-located `*.strings.ts` catalog instead of the shared dictionaries. */
  labelCopy?: NavCopy;
  /** Inline trilingual subtitle; wins over `subtitleKey`. See `navSubtitle`. */
  subtitleCopy?: NavCopy;
}

export interface NavGroup {
  labelKey: DictKey;
  items: NavItem[];
}

/**
 * Bridge keeps ALL of its copy in `features/Bridge.strings.ts` — the per-feature
 * pattern every other page follows — so it has no entry in the shared dictionaries
 * and `i18n/en.ts|hy.ts|ru.ts` stay untouched. These two ids are the slots it would
 * occupy if its copy ever moved there; nothing resolves them today, because
 * `labelCopy`/`subtitleCopy` below are the real source and `navLabel`/`navSubtitle`
 * prefer them. The cast exists only so `NavItem` can keep `labelKey` REQUIRED —
 * `features/Generic.tsx` (owned elsewhere) passes it straight to `t()`.
 */
const BRIDGE_LABEL_KEY = 'nav.bridge' as DictKey;
const BRIDGE_SUBTITLE_KEY = 'bridge.subtitle' as DictKey;

/** The nav label for `item`, in `lang`: the page's own copy when it carries one,
 *  otherwise the shared dictionary via `t`. */
export function navLabel(item: NavItem, lang: Lang, t: (k: DictKey) => string): string {
  return item.labelCopy ? item.labelCopy[lang] || item.labelCopy.en : t(item.labelKey);
}

/** The nav subtitle for `item`, in `lang`. Same precedence as `navLabel`. */
export function navSubtitle(item: NavItem, lang: Lang, t: (k: DictKey) => string): string {
  return item.subtitleCopy ? item.subtitleCopy[lang] || item.subtitleCopy.en : t(item.subtitleKey);
}

export const NAV: NavGroup[] = [
  {
    labelKey: 'nav.group.core',
    items: [
      { id: 'home', labelKey: 'nav.home', subtitleKey: 'home.subtitle' },
      { id: 'command', labelKey: 'nav.command', subtitleKey: 'command.subtitle' },
      { id: 'chat', labelKey: 'nav.chat', subtitleKey: 'chat.subtitle' },
      { id: 'groupChat', labelKey: 'nav.groupChat', subtitleKey: 'groupChat.subtitle' },
      { id: 'projects', labelKey: 'nav.projects', subtitleKey: 'projects.subtitle' },
      { id: 'tasks', labelKey: 'nav.tasks', subtitleKey: 'tasks.subtitle' },
      { id: 'agents', labelKey: 'nav.agents', subtitleKey: 'agents.subtitle' },
    ],
  },
  {
    labelKey: 'nav.group.intelligence',
    items: [
      { id: 'knowledge', labelKey: 'nav.knowledge', subtitleKey: 'knowledge.subtitle' },
      { id: 'memory', labelKey: 'nav.memory', subtitleKey: 'memory.subtitle' },
      { id: 'decisions', labelKey: 'nav.decisions', subtitleKey: 'decisions.subtitle' },
      {
        id: 'bridge',
        labelKey: BRIDGE_LABEL_KEY,
        subtitleKey: BRIDGE_SUBTITLE_KEY,
        labelCopy: BRIDGE_STR.panelTitle,
        subtitleCopy: BRIDGE_STR.panelEyebrow,
      },
      { id: 'research', labelKey: 'nav.research', subtitleKey: 'research.subtitle' },
      { id: 'library', labelKey: 'nav.library', subtitleKey: 'library.subtitle' },
    ],
  },
  {
    labelKey: 'nav.group.operations',
    items: [
      { id: 'calendar', labelKey: 'nav.calendar', subtitleKey: 'calendar.subtitle' },
      { id: 'automations', labelKey: 'nav.automations', subtitleKey: 'automations.subtitle' },
      { id: 'approvals', labelKey: 'nav.approvals', subtitleKey: 'approvals.subtitle' },
      { id: 'activity', labelKey: 'nav.activity', subtitleKey: 'activity.subtitle' },
      { id: 'notifications', labelKey: 'nav.notifications', subtitleKey: 'notifications.subtitle' },
    ],
  },
  {
    labelKey: 'nav.group.system',
    items: [
      { id: 'files', labelKey: 'nav.files', subtitleKey: 'files.subtitle' },
      { id: 'integrations', labelKey: 'nav.integrations', subtitleKey: 'integrations.subtitle' },
      { id: 'analytics', labelKey: 'nav.analytics', subtitleKey: 'analytics.subtitle' },
      { id: 'security', labelKey: 'nav.security', subtitleKey: 'security.subtitle' },
      { id: 'settings', labelKey: 'nav.settings', subtitleKey: 'settings.subtitle' },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);
