import { useApp } from '../app/store';
import { PageHeader, Panel, EmptyState } from '../components/ui';
import { ALL_ITEMS, type RouteId } from '../app/nav';

// The router's fallback for a route id that has no page, and nothing else. It was written as the
// placeholder for workspaces without a backend command surface; there are none left — every
// `RouteId` has a page in `SCREENS` (app/routes.tsx), and the store refuses an unknown id at all
// three places a route is set (`routeFromHash`, `setRoute`, `openEntity`), so the running app
// does not reach this component. A test does, by casting an unknown id. No mock data.
export function Generic({ route }: { route: RouteId }) {
  const { t } = useApp();
  // Guard: an unknown id (the one case left — see above) must not crash — fall back to the raw
  // id rather than dereferencing a missing nav item.
  const item = ALL_ITEMS.find((i) => i.id === route);
  return (
    <>
      <PageHeader title={item ? t(item.labelKey) : String(route)} subtitle={item ? t(item.subtitleKey) : ''} />
      <Panel>
        <EmptyState title={t('generic.title')} hint={t('generic.hint')} />
      </Panel>
    </>
  );
}
