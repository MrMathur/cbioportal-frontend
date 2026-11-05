import * as React from 'react';
import { observer } from 'mobx-react';
import {
    observable,
    makeObservable,
    action,
    computed,
    reaction,
    IReactionDisposer,
} from 'mobx';
import WindowStore from 'shared/components/window/WindowStore';
import { getLoadConfig } from 'config/config';
import { getChatServerBase, getChatOrigin } from './chatServerBase';
import { goToPage, normalizeBasePath } from './navigateTool';
import { PortalWebMcp } from './portalWebMcp';
import { PageEvent, PageEventPublisher } from './pageEvents';
import {
    clearHighlights,
    emphasizeHighlight,
    setBadgeHoverListener,
    setHighlights,
    setHoveredHighlight,
} from './highlightStore';
import { ChatHighlightEdges } from './ChatHighlightEdges';
import { scrollToHighlight } from './highlightScroll';
import { getCatalog, getStudyContext } from './catalog';
import {
    captureViewport,
    waitForNetworkIdle,
    waitForViewReady,
} from './screenshot';
import {
    clampChatSidebarWidth,
    DEFAULT_CHAT_SIDEBAR_WIDTH,
    MIN_CHAT_SIDEBAR_WIDTH,
    readStoredChatSidebarWidth,
} from './chatSidebarWidth';
import './ChatSidebar.scss';

// The full panel, a thin strip the iframe draws its own controls in, or
// nothing but the launcher.
type ChatSidebarMode = 'expanded' | 'rail' | 'hidden';

const MODE_STORAGE_KEY = 'chat-sidebar:mode';
// Holds the open/closed boolean stored before the rail existed; read only
// when no mode has been stored.
const LEGACY_OPEN_STORAGE_KEY = 'chat-sidebar:open';
const WIDTH_STORAGE_KEY = 'chat-sidebar:width';
const KEYBOARD_RESIZE_STEP = 20;
// Width of the collapsed rail, as in ChatSidebar.scss.
const RAIL_WIDTH = 48;
// Below this much page width, the sidebar overlays the page rather than
// squeezing it (e.g. a narrow window with the chat dragged wide).
const MIN_PAGE_WIDTH = 480;
const RESERVED_WIDTH_VAR = '--chat-sidebar-reserved-width';
// Opt-in flags passed on to the iframe: the guided assistant (request
// classification, research question levels, earlier questions) and its
// per-reply debug badge.
const GUIDANCE_STORAGE_KEY = 'chat-sidebar:guidance';
const GUIDANCE_DEBUG_STORAGE_KEY = 'chat-sidebar:guidanceDebug';
// A user-study participant code, written to the guidance log.
const PARTICIPANT_STORAGE_KEY = 'chat-sidebar:participant';

function readFlag(key: string): boolean {
    try {
        return localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
}

function isChatSidebarMode(v: unknown): v is ChatSidebarMode {
    return v === 'expanded' || v === 'rail' || v === 'hidden';
}

function readStoredMode(): ChatSidebarMode {
    try {
        const mode = localStorage.getItem(MODE_STORAGE_KEY);
        if (isChatSidebarMode(mode)) return mode;
        if (localStorage.getItem(LEGACY_OPEN_STORAGE_KEY) === 'false') {
            return 'hidden';
        }
    } catch {
        /* localStorage may be unavailable */
    }
    return 'expanded';
}

// Mounted once globally in Container.tsx, outside routed content, so it
// survives page navigation.
@observer
export default class ChatSidebar extends React.Component<{}, {}> {
    @observable mode: ChatSidebarMode = readStoredMode();
    @observable width = readStoredChatSidebarWidth(
        localStorage,
        WIDTH_STORAGE_KEY
    );
    @observable resizing = false;

    constructor(props: {}) {
        super(props);
        makeObservable(this);
    }

    private iframeRef = React.createRef<HTMLIFrameElement>();
    private webMcp = new PortalWebMcp();
    private pageEvents = new PageEventPublisher();
    private disposeReservedWidth?: IReactionDisposer;
    private resizeStartX = 0;
    private resizeStartWidth = DEFAULT_CHAT_SIDEBAR_WIDTH;

    private get maximumWidth() {
        return window.innerWidth;
    }

    private get minimumWidth() {
        return Math.min(MIN_CHAT_SIDEBAR_WIDTH, this.maximumWidth);
    }

    private clampWidth(width: number) {
        return clampChatSidebarWidth(width, this.maximumWidth);
    }

    private storeWidth() {
        try {
            localStorage.setItem(WIDTH_STORAGE_KEY, String(this.width));
        } catch {
            /* localStorage may be unavailable */
        }
    }

    @action.bound
    stopResizing() {
        if (!this.resizing) return;
        this.resizing = false;
        document.body.classList.remove('chat-sidebar-resizing');
        this.storeWidth();
        this.committedWidth = this.width;
    }

    @action.bound
    setMode(mode: ChatSidebarMode) {
        if (mode === this.mode) return;
        if (this.resizing) this.stopResizing();
        this.mode = mode;
        try {
            localStorage.setItem(MODE_STORAGE_KEY, mode);
        } catch {
            /* ignore */
        }
        this.syncBodyClass();
        this.sendOpenState();
    }

    @action.bound
    expand() {
        this.setMode('expanded');
    }

    private syncBodyClass() {
        document.body.classList.toggle(
            'chat-sidebar-closed',
            this.mode !== 'expanded'
        );
    }

    // The width the page leaves free for the sidebar: all of it when
    // expanded, the rail when collapsed. Held at its last value while
    // dragging, so heavy views re-lay out once the drag ends.
    @computed get reservedWidth(): number {
        if (this.mode === 'hidden') return 0;
        const width = this.mode === 'rail' ? RAIL_WIDTH : this.committedWidth;
        return this.viewportWidth - width >= MIN_PAGE_WIDTH ? width : 0;
    }

    @observable private committedWidth = this.width;
    @observable private viewportWidth = window.innerWidth;

    private applyReservedWidth(width: number) {
        document.documentElement.style.setProperty(
            RESERVED_WIDTH_VAR,
            `${width}px`
        );
        document.body.classList.toggle('chat-sidebar-reserving', width > 0);
        WindowStore.setReservedRight(width);
    }

    componentDidMount() {
        this.disposeReservedWidth = reaction(
            () => this.reservedWidth,
            width => this.applyReservedWidth(width),
            { fireImmediately: true }
        );
        window.addEventListener('message', this.onMessage);
        window.addEventListener('resize', this.onWindowResize);
        this.onWindowResize();
        this.syncBodyClass();
        // Also registers go_to_page as a native WebMCP tool where supported;
        // no-op otherwise.
        this.webMcp.start();
        // A linked badge hovered on the page marks its sentence in the chat.
        setBadgeHoverListener(key =>
            this.postToIframe({ type: 'chat-sidebar:badgeHover', key })
        );
    }

    componentWillUnmount() {
        window.removeEventListener('message', this.onMessage);
        window.removeEventListener('resize', this.onWindowResize);
        document.body.classList.remove('chat-sidebar-closed');
        document.body.classList.remove('chat-sidebar-resizing');
        this.disposeReservedWidth?.();
        this.applyReservedWidth(0);
        clearHighlights();
        setBadgeHoverListener(undefined);
        this.webMcp.stop();
        this.pageEvents.stop();
    }

    @action.bound
    onWindowResize() {
        this.width = this.clampWidth(this.width);
        this.viewportWidth = window.innerWidth;
        if (!this.resizing) this.committedWidth = this.width;
    }

    @action.bound
    onResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (e.button !== 0) return;
        this.resizeStartX = e.clientX;
        this.resizeStartWidth = this.width;
        this.resizing = true;
        document.body.classList.add('chat-sidebar-resizing');
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    }

    @action.bound
    onResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (!this.resizing) return;
        this.width = this.clampWidth(
            this.resizeStartWidth + this.resizeStartX - e.clientX
        );
    }

    @action.bound
    onResizePointerEnd(e: React.PointerEvent<HTMLDivElement>) {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        this.stopResizing();
    }

    // The two clicks before it each start and end a resize that moved
    // nothing, so the width is left as it was.
    @action.bound
    onResizeDoubleClick() {
        this.setMode('rail');
    }

    @action.bound
    onResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
        let nextWidth = this.width;
        switch (e.key) {
            case 'ArrowLeft':
                nextWidth += KEYBOARD_RESIZE_STEP;
                break;
            case 'ArrowRight':
                nextWidth -= KEYBOARD_RESIZE_STEP;
                break;
            case 'Home':
                nextWidth = this.minimumWidth;
                break;
            case 'End':
                nextWidth = this.maximumWidth;
                break;
            default:
                return;
        }
        e.preventDefault();
        this.width = this.clampWidth(nextWidth);
        this.storeWidth();
        this.committedWidth = this.width;
    }

    // The iframe posts a portal path here since it can't call routingStore
    // itself.
    private handleNavigate(path: string) {
        goToPage(path);
    }

    private sendPageEvent = (event: PageEvent) => {
        this.iframeRef.current?.contentWindow?.postMessage(
            { type: 'chat-sidebar:pageEvent', event },
            getChatOrigin()
        );
    };

    // The iframe stays loaded in every mode; it holds off on work nobody would
    // see until it's expanded, and draws the rail itself. `open` is kept
    // alongside `mode` for chat servers deployed before the rail.
    private sendOpenState() {
        this.iframeRef.current?.contentWindow?.postMessage(
            {
                type: 'chat-sidebar:open',
                open: this.mode === 'expanded',
                mode: this.mode,
            },
            getChatOrigin()
        );
    }

    onMessage = (e: MessageEvent) => {
        if (e.source !== this.iframeRef.current?.contentWindow) return;
        if (e.origin !== getChatOrigin()) return;
        // Sent on every iframe load, once it's listening — anything posted
        // before then would be lost.
        if (e.data?.type === 'chat-sidebar:ready') {
            this.sendOpenState();
            this.pageEvents.start(this.sendPageEvent);
            return;
        }
        if (e.data?.type === 'chat-sidebar:navigate') {
            if (typeof e.data.path === 'string') {
                this.handleNavigate(e.data.path);
            }
            return;
        }
        // The iframe's collapse and expand buttons. Nothing in the UI hides
        // the sidebar; `hidden` is only reached from a stored mode.
        if (e.data?.type === 'chat-sidebar:setMode') {
            if (e.data.mode === 'expanded' || e.data.mode === 'rail') {
                this.setMode(e.data.mode);
            }
            return;
        }
        // The research question's highlights for the page on screen; the
        // iframe re-sends them on every page change, empty while loading.
        if (e.data?.type === 'chat-sidebar:highlights') {
            setHighlights(e.data.annotations, e.data.focus);
            return;
        }
        // A number chip in the chat is hovered (key null: no longer), or
        // clicked: pulse its badge, or scroll its element into view.
        if (e.data?.type === 'chat-sidebar:badgeHover') {
            setHoveredHighlight(
                typeof e.data.key === 'string' ? e.data.key : null
            );
            return;
        }
        if (e.data?.type === 'chat-sidebar:badgeScroll') {
            if (typeof e.data.key === 'string') {
                scrollToHighlight(e.data.key);
                emphasizeHighlight(e.data.key);
            }
            return;
        }
        if (e.data?.type === 'chat-sidebar:requestCatalog') {
            this.respondWithCatalog();
            return;
        }
        if (e.data?.type === 'chat-sidebar:requestStudyContext') {
            const studyIds = e.data.studyIds;
            if (
                Array.isArray(studyIds) &&
                studyIds.length > 0 &&
                studyIds.every(id => typeof id === 'string')
            ) {
                this.respondWithStudyContext(studyIds);
            }
            return;
        }
        if (e.data?.type === 'chat-sidebar:requestScreenshot') {
            const requestId = e.data.requestId;
            this.captureAndRespond(requestId);
            return;
        }
    };

    private postToIframe(message: object) {
        this.iframeRef.current?.contentWindow?.postMessage(
            message,
            getChatOrigin()
        );
    }

    private async respondWithCatalog() {
        try {
            const catalog = await getCatalog();
            this.postToIframe({ type: 'chat-sidebar:catalog', catalog });
        } catch (err) {
            this.postToIframe({
                type: 'chat-sidebar:catalog',
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private async respondWithStudyContext(studyIds: string[]) {
        try {
            const context = await getStudyContext(studyIds);
            this.postToIframe({ type: 'chat-sidebar:studyContext', context });
        } catch (err) {
            this.postToIframe({
                type: 'chat-sidebar:studyContext',
                studyIds,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private async captureAndRespond(requestId: string) {
        // Waits for the page to settle before capturing — a mid-fetch or
        // mid-paint screenshot is worse than a slightly slower one. Sequential
        // because spinners often only appear once data has arrived.
        await waitForNetworkIdle(1000, 15000);
        await waitForViewReady();
        const dataUrl = await captureViewport();
        this.iframeRef.current?.contentWindow?.postMessage(
            {
                type: 'chat-sidebar:screenshot',
                requestId,
                dataUrl,
            },
            getChatOrigin()
        );
    }

    get iframeSrc(): string {
        const apiRoot = getLoadConfig().apiRoot || '/';
        const params = new URLSearchParams();
        params.set('apiRoot', apiRoot);
        params.set('parentOrigin', window.location.origin);
        // Where the iframe points portal links, including any base path the
        // portal is served under.
        params.set(
            'portalUrl',
            window.location.origin + normalizeBasePath(getLoadConfig().basePath)
        );
        if (readFlag(GUIDANCE_STORAGE_KEY)) params.set('guidance', '1');
        if (readFlag(GUIDANCE_DEBUG_STORAGE_KEY)) {
            params.set('guidanceDebug', '1');
        }
        try {
            const participant = localStorage.getItem(PARTICIPANT_STORAGE_KEY);
            if (participant) params.set('participant', participant);
        } catch {
            /* no participant code */
        }
        return `${getChatServerBase()}/?${params.toString()}`;
    }

    render() {
        const expanded = this.mode === 'expanded';
        const rail = this.mode === 'rail';
        let panelClassName = 'chat-sidebar-panel';
        if (rail) panelClassName += ' chat-sidebar-panel-rail';
        if (this.resizing) panelClassName += ' chat-sidebar-panel-resizing';
        return (
            <>
                <ChatHighlightEdges />
                {this.mode === 'hidden' && (
                    <button
                        type="button"
                        className="chat-sidebar-launcher"
                        onClick={this.expand}
                        aria-label="Open chat"
                        title="Open chat"
                    >
                        <i className="fa fa-comment" aria-hidden="true" />
                    </button>
                )}
                <aside
                    className={panelClassName}
                    aria-label="Chat"
                    hidden={this.mode === 'hidden'}
                    // The rail's width, including its hover growth, is in
                    // the stylesheet.
                    style={rail ? undefined : { width: this.width }}
                >
                    {/* A conditional sibling keeps its slot when absent, so
                        the iframe below is never remounted (which would
                        reload the chat) as the mode changes. */}
                    {expanded && (
                        <div
                            className="chat-sidebar-resize-handle"
                            role="separator"
                            aria-label="Resize chat sidebar"
                            aria-orientation="vertical"
                            aria-valuemin={this.minimumWidth}
                            aria-valuemax={this.maximumWidth}
                            aria-valuenow={this.width}
                            tabIndex={0}
                            onPointerDown={this.onResizePointerDown}
                            onPointerMove={this.onResizePointerMove}
                            onPointerUp={this.onResizePointerEnd}
                            onPointerCancel={this.onResizePointerEnd}
                            onLostPointerCapture={this.stopResizing}
                            onKeyDown={this.onResizeKeyDown}
                            onDoubleClick={this.onResizeDoubleClick}
                        />
                    )}
                    <iframe
                        ref={this.iframeRef}
                        title="Chat"
                        src={this.iframeSrc}
                        className="chat-sidebar-iframe"
                        // navigator.clipboard is permission-policy gated, so a
                        // cross-origin chat server needs it delegated to copy.
                        allow="clipboard-write"
                    />
                </aside>
            </>
        );
    }
}
