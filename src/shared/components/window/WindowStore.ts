import { WindowWrapper } from 'cbioportal-frontend-commons';
import { action, computed, makeObservable, observable } from 'mobx';

// The window's size as the portal's pages may use it: the viewport minus the
// width the chat sidebar reserves on the right edge (see ChatSidebar), so
// views that size themselves to the window fit beside the sidebar instead of
// running under it.
class PortalWindowStore {
    private readonly viewport = new WindowWrapper();
    @observable private reservedRight = 0;

    constructor() {
        makeObservable(this);
    }

    @computed get size(): { width: number; height: number } {
        return {
            width: Math.max(0, this.viewport.size.width - this.reservedRight),
            height: this.viewport.size.height,
        };
    }

    getWindowWidth = () => this.size.width;

    getWindowHeight = () => this.size.height;

    @action setReservedRight(width: number) {
        this.reservedRight = Math.max(0, width);
    }
}

export default new PortalWindowStore();
