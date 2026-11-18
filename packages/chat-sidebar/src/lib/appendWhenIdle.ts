// Sends a message the sidebar writes on the user's behalf once the chat is
// free: appending while a reply is still running would cut into it.

const RETRY_MS = 1500;
const GIVE_UP_MS = 120_000;

interface ThreadLike {
    getState(): { isRunning: boolean };
    append(text: string): void;
}

export function appendWhenIdle(
    thread: ThreadLike,
    text: string,
    onSent?: () => void
): void {
    const started = Date.now();
    const attempt = () => {
        if (thread.getState().isRunning) {
            if (Date.now() - started < GIVE_UP_MS) {
                setTimeout(attempt, RETRY_MS);
            }
            return;
        }
        thread.append(text);
        onSent?.();
    };
    attempt();
}
