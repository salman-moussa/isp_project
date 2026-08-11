import { useCallback, useEffect, useState } from 'react';

function routeIdFromHash(hash: string): string {
  const encodedId = hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0] ?? '';
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return '';
  }
}

export function useHashNavigation(routeIds: readonly string[], defaultId: string) {
  const readRoute = useCallback(() => {
    const routeId = routeIdFromHash(window.location.hash);
    return routeIds.includes(routeId) ? routeId : defaultId;
  }, [defaultId, routeIds]);
  const [activeId, setActiveId] = useState(readRoute);

  useEffect(() => {
    const syncFromHistory = () => setActiveId(readRoute());
    const routeId = routeIdFromHash(window.location.hash);
    if (!routeIds.includes(routeId)) {
      window.history.replaceState(window.history.state, '', `#/${defaultId}`);
    }
    syncFromHistory();
    window.addEventListener('hashchange', syncFromHistory);
    window.addEventListener('popstate', syncFromHistory);
    return () => {
      window.removeEventListener('hashchange', syncFromHistory);
      window.removeEventListener('popstate', syncFromHistory);
    };
  }, [defaultId, readRoute, routeIds]);

  const navigate = useCallback(
    (id: string) => {
      if (!routeIds.includes(id)) return;
      const nextHash = `#/${encodeURIComponent(id)}`;
      if (window.location.hash !== nextHash) {
        window.history.pushState(window.history.state, '', nextHash);
      }
      setActiveId(id);
    },
    [routeIds],
  );

  return { activeId, navigate };
}
