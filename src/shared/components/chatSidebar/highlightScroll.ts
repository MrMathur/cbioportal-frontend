// Brings a badged element into view for the chat (a number chip clicked, an
// edge indicator). The page already leaves the sidebar's width free, so only
// the vertical position needs care: centred, below any sticky header.

const STICKY_HEADER_ALLOWANCE = 80;

export function findHighlightElement(key: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(
        `[data-chat-highlight-target="${CSS.escape(key)}"]`
    );
}

export function scrollToHighlight(key: string): boolean {
    const element = findHighlightElement(key);
    if (!element) return false;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // An element taller than the viewport: its top, clear of a sticky header.
    const rect = element.getBoundingClientRect();
    if (rect.height > window.innerHeight - STICKY_HEADER_ALLOWANCE) {
        window.scrollBy({
            top: rect.top - STICKY_HEADER_ALLOWANCE,
            behavior: 'smooth',
        });
    }
    return true;
}

// Whether any part of the element shows: inside the viewport and inside
// every scrolling ancestor (e.g. the home page's study list).
export function isElementVisible(element: HTMLElement): boolean {
    let rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
    for (
        let parent = element.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
    ) {
        const style = getComputedStyle(parent);
        if (!/(auto|scroll|hidden)/.test(style.overflowY)) continue;
        const box = parent.getBoundingClientRect();
        if (rect.bottom <= box.top || rect.top >= box.bottom) return false;
    }
    return true;
}

/** Whether a hidden element lies above or below what's on screen. */
export function directionOf(element: HTMLElement): 'above' | 'below' {
    return element.getBoundingClientRect().top < 0 ? 'above' : 'below';
}
