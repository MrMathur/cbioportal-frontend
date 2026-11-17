export const DEFAULT_CHAT_SIDEBAR_WIDTH = 400;
export const MIN_CHAT_SIDEBAR_WIDTH = 320;
export const CHAT_SIDEBAR_RAIL_WIDTH = 48;
// The sidebar sits beside the page, so it can't take the space the page needs.
export const MIN_PAGE_WIDTH_BESIDE_CHAT_SIDEBAR = 600;

export function getMaximumChatSidebarWidth(viewportWidth: number): number {
    const availableWidth = Math.max(0, viewportWidth);
    return Math.max(
        availableWidth - MIN_PAGE_WIDTH_BESIDE_CHAT_SIDEBAR,
        Math.min(MIN_CHAT_SIDEBAR_WIDTH, availableWidth)
    );
}

export function clampChatSidebarWidth(
    width: number,
    viewportWidth: number
): number {
    const maximumWidth = getMaximumChatSidebarWidth(viewportWidth);
    const minimumWidth = Math.min(MIN_CHAT_SIDEBAR_WIDTH, maximumWidth);
    return Math.min(Math.max(width, minimumWidth), maximumWidth);
}

export function readStoredChatSidebarWidth(
    storage: Pick<Storage, 'getItem'>,
    storageKey: string
): number {
    try {
        const storedWidth = Number(storage.getItem(storageKey));
        return Number.isFinite(storedWidth) && storedWidth > 0
            ? storedWidth
            : DEFAULT_CHAT_SIDEBAR_WIDTH;
    } catch {
        return DEFAULT_CHAT_SIDEBAR_WIDTH;
    }
}
