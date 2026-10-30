// Tabs on screen that the chat may highlight, published by MSKTabs instances
// given a highlightTargetType. Observable so the page snapshot updates as tabs
// appear (many are hidden until their data loads).

import { action, comparer, observable } from 'mobx';
import { HighlightTargetType } from './highlightStore';

export interface RegisteredTab {
    id: string;
    label: string;
}

const tabs = observable.map<HighlightTargetType, RegisteredTab[]>(
    {},
    { deep: false }
);

export const registerTabs = action(
    (targetType: HighlightTargetType, next: RegisteredTab[]) => {
        if (comparer.structural(tabs.get(targetType), next)) return;
        tabs.set(targetType, next);
    }
);

export const unregisterTabs = action((targetType: HighlightTargetType) => {
    tabs.delete(targetType);
});

export function getRegisteredTabs(
    targetType: HighlightTargetType
): readonly RegisteredTab[] {
    return tabs.get(targetType) ?? [];
}
