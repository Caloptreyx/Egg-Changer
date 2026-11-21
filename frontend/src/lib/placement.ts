// Where users find the egg changer, from the `placement` setting the backend renders into
// index.html. Kept free of React and panel imports so it can be tested with `node --test`.

export const PLACEMENTS = ['settings', 'page', 'both'] as const;

export type Placement = (typeof PLACEMENTS)[number];

/** The known placement, or `settings` (the only placement before 1.1.0) for anything else. */
export function placementOf(value: unknown): Placement {
  return PLACEMENTS.find((known) => known === value) ?? 'settings';
}

/** Which shells to mount: the section on the server's Settings page, the sidebar page, or both. */
export function placementShells(value: unknown): { settings: boolean; page: boolean } {
  const placement = placementOf(value);
  return { settings: placement !== 'page', page: placement !== 'settings' };
}
