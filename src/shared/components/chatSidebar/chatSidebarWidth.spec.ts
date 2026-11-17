import {
    clampChatSidebarWidth,
    getMaximumChatSidebarWidth,
    MIN_CHAT_SIDEBAR_WIDTH,
    MIN_PAGE_WIDTH_BESIDE_CHAT_SIDEBAR,
} from './chatSidebarWidth';

describe('chatSidebarWidth', () => {
    it('leaves the page its minimum width', () => {
        expect(getMaximumChatSidebarWidth(1600)).toBe(
            1600 - MIN_PAGE_WIDTH_BESIDE_CHAT_SIDEBAR
        );
        expect(clampChatSidebarWidth(5000, 1600)).toBe(
            1600 - MIN_PAGE_WIDTH_BESIDE_CHAT_SIDEBAR
        );
    });

    it('keeps its own minimum width in a narrow window', () => {
        expect(getMaximumChatSidebarWidth(800)).toBe(MIN_CHAT_SIDEBAR_WIDTH);
        expect(clampChatSidebarWidth(100, 800)).toBe(MIN_CHAT_SIDEBAR_WIDTH);
    });

    it('never exceeds the window', () => {
        expect(clampChatSidebarWidth(400, 200)).toBe(200);
        expect(clampChatSidebarWidth(400, 0)).toBe(0);
    });
});
