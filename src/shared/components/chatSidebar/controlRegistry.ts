// Controls on screen that the chat may point at (the Study View Groups button
// that leads to Compare, the study search box, the gene/OQL query box,
// Download), registered by the components that render them. Observable so
// the page snapshot updates as they mount and unmount.

import { action, observable } from 'mobx';

export type ControlId =
    | 'study-view-compare'
    | 'study-search'
    | 'gene-query'
    | 'download';

export const CONTROL_LABELS: Record<ControlId, string> = {
    'study-view-compare': 'Groups button (create groups and Compare them)',
    'study-search': 'Study search box',
    'gene-query': 'Gene / OQL query box',
    download: 'Download button',
};

export const CONTROL_DESCRIPTIONS: Record<ControlId, string> = {
    'study-view-compare':
        'Study View header button: save selections as groups and open Group Comparison',
    'study-search': 'Home page box for finding studies by name or keyword',
    'gene-query': 'Box for entering genes or OQL to query',
    download: 'Downloads the data of the current page or study',
};

// Counted, since a control can be mounted more than once (e.g. two query
// boxes) and must stay registered until the last one unmounts.
const mounted = observable.map<ControlId, number>({}, { deep: false });

export const registerControl = action((id: ControlId) => {
    mounted.set(id, (mounted.get(id) ?? 0) + 1);
});

export const unregisterControl = action((id: ControlId) => {
    const count = (mounted.get(id) ?? 0) - 1;
    if (count > 0) mounted.set(id, count);
    else mounted.delete(id);
});

export function getRegisteredControls(): ControlId[] {
    return Array.from(mounted.keys());
}
