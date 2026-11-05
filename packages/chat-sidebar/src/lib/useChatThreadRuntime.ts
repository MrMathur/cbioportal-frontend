import { useMemo, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import {
    DefaultChatTransport,
    lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import {
    AssistantRuntime,
    SimpleImageAttachmentAdapter,
    useAuiState,
} from '@assistant-ui/react';
import { useAISDKRuntime } from '@assistant-ui/ai-sdk';
import { AuthErrorStatus, getSelectedModel, setAuthError } from './chatSession';
import { notifyNavigate, resolvePortalLink } from './portal-link';
import { detailsForModel, getLatestPageEvents } from './page-events';
import {
    applyClassification,
    expectPageNavigation,
    setClassificationFailed,
    setLatestFinding,
    setResearchQuestionFromChat,
} from './researchQuestion';
import { isClassification } from './classification';
import { guidanceEnabled } from './guidanceFlags';
import { buildGuidancePayload } from './guidanceRequest';
import { findingFromReply } from './topics';
import { buildPlan, markKey, RequestedMark } from './badgePlan';
import { setActivePlan } from './badgeState';
import { logGuidanceEvent } from './guidanceLog';
import { markNavigationStarted, waitForPageReady } from './navigationState';
import { markableTargets, pageCandidates, pageTypeOf } from './pageTargets';
import { latestParts } from './messageParts';
import { syncPortalToClassification } from './portalSync';

export class ChatAuthError extends Error {
    constructor(readonly status: AuthErrorStatus) {
        super(`the portal rejected the chat request (${status})`);
    }
}

// Stateless — one instance for the app's lifetime rather than one per thread.
const attachmentAdapter = new SimpleImageAttachmentAdapter();

// Runs once per thread the session has visited, each with its own chat and
// history, which is what lets a run keep streaming after the user switches
// away. Nothing app-wide belongs in here — a fetch would fire once per thread.
export function useChatThreadRuntime(): AssistantRuntime {
    const threadId = useAuiState(s => s.threadListItem.id);
    // Read at tool-call time: a chat gets its remote id with its first message.
    const remoteId = useAuiState(s => s.threadListItem.remoteId);
    const threadIdsRef = useRef({ remoteId, threadId });
    threadIdsRef.current = { remoteId, threadId };

    const transport = useMemo(
        () =>
            new DefaultChatTransport({
                api: '/api/chat/message',
                // The portal proxies this endpoint and rejects it when the
                // session has lapsed or the user lacks the chat role.
                fetch: async (input, init) => {
                    const response = await fetch(input, init);
                    if (response.status === 401 || response.status === 403) {
                        throw new ChatAuthError(response.status);
                    }
                    return response;
                },
                // Evaluated per request, so the model picker stays live even
                // though this hook never re-reads it.
                body: () => ({
                    model: getSelectedModel(),
                    pageHref: getLatestPageEvents().snapshot?.href ?? null,
                }),
                // The guided assistant's classification context, built from
                // the message being sent. Mirrors the default request body
                // otherwise.
                prepareSendMessagesRequest: async ({
                    id,
                    messages,
                    body,
                    trigger,
                    messageId,
                }) => {
                    const ids = threadIdsRef.current;
                    const guidance = await buildGuidancePayload(
                        messages,
                        ids.remoteId,
                        ids.threadId
                    );
                    return {
                        body: {
                            ...body,
                            id,
                            messages,
                            trigger,
                            messageId,
                            ...(guidance ? { guidance } : {}),
                        },
                    };
                },
            }),
        []
    );

    const chat = useChat({
        id: threadId,
        transport,
        // Model decides whether to navigate now vs. just link — see
        // go_to_page guidance in the system prompt.
        onToolCall: async ({ toolCall }) => {
            if (toolCall.toolName === 'go_to_page') {
                const { url } = toolCall.input as { url: string };
                const path = resolvePortalLink(url)?.path;
                const navigated = Boolean(path);
                if (path) {
                    expectPageNavigation();
                    markNavigationStarted(
                        getLatestPageEvents().settledSnapshot?.href
                    );
                    notifyNavigate(path);
                }
                // In guided chats, the reply's marks go on the page it just
                // opened: wait for it, and list what can be marked there.
                const page =
                    guidanceEnabled && navigated
                        ? await waitForPageReady()
                        : undefined;
                addToolOutput({
                    tool: 'go_to_page',
                    toolCallId: toolCall.toolCallId,
                    output: page
                        ? {
                              navigated,
                              page: {
                                  type: pageTypeOf(page),
                                  elements: markableTargets(page),
                              },
                          }
                        : { navigated },
                });
                return;
            }
            if (toolCall.toolName === 'set_highlights') {
                const page = await waitForPageReady();
                const input = toolCall.input as { marks?: unknown };
                const requested = Array.isArray(input?.marks)
                    ? (input.marks as RequestedMark[])
                    : [];
                const parts = latestParts(chat.messages);
                const { plan, rejected } = buildPlan(
                    requested,
                    pageCandidates(page),
                    parts
                );
                const replyId = chat.messages.at(-1)?.id;
                if (replyId) {
                    setActivePlan({ messageId: replyId, plan, linked: true });
                }
                const ids = threadIdsRef.current;
                logGuidanceEvent('badge_plan', ids.remoteId ?? ids.threadId, {
                    message_id: replyId,
                    marks: plan.marks.map(m => ({
                        token: m.token,
                        target: markKey(m),
                        part: m.part,
                        tooltip: m.tooltip,
                    })),
                    rejected,
                    href: page?.href ?? null,
                });
                addToolOutput({
                    tool: 'set_highlights',
                    toolCallId: toolCall.toolCallId,
                    output: {
                        accepted: plan.marks.map(m => ({
                            token: m.token,
                            cue: m.cue,
                            element: m.label,
                            part: m.part,
                            tooltip: m.tooltip,
                            ...(m.elsewhere ? { onAnotherPage: true } : {}),
                        })),
                        rejected,
                        reminder: plan.marks.length
                            ? 'Start each matching sentence or list item with its token, each token once.'
                            : 'No marks were accepted: write the answer without tokens.',
                        plan,
                    },
                });
                return;
            }
            if (toolCall.toolName === 'get_page_details') {
                // The latest rather than the latest settled one, which can be
                // a page the user has since left; pending says it's mid-load.
                const snapshot = getLatestPageEvents().snapshot;
                addToolOutput({
                    tool: 'get_page_details',
                    toolCallId: toolCall.toolCallId,
                    output: snapshot
                        ? {
                              ...detailsForModel(snapshot.details),
                              pending: snapshot.pending,
                          }
                        : { available: false },
                });
                return;
            }
            if (toolCall.toolName === 'set_research_question') {
                const { question } = toolCall.input as { question: string };
                const ok = Boolean(question?.trim());
                if (ok) {
                    const ids = threadIdsRef.current;
                    setResearchQuestionFromChat(
                        ids.remoteId,
                        ids.threadId,
                        question
                    );
                }
                addToolOutput({
                    tool: 'set_research_question',
                    toolCallId: toolCall.toolCallId,
                    output: { ok },
                });
                return;
            }
        },
        onData: dataPart => {
            if (
                guidanceEnabled &&
                dataPart.type === 'data-classification-error'
            ) {
                const { message } = (dataPart.data ?? {}) as {
                    message?: unknown;
                };
                if (typeof message === 'string') {
                    const ids = threadIdsRef.current;
                    setClassificationFailed(
                        ids.remoteId,
                        ids.threadId,
                        message
                    );
                }
                return;
            }
            if (
                guidanceEnabled &&
                dataPart.type === 'data-classification' &&
                isClassification(dataPart.data)
            ) {
                const ids = threadIdsRef.current;
                applyClassification(
                    ids.remoteId,
                    ids.threadId,
                    dataPart.data,
                    getLatestPageEvents().settledSnapshot?.href
                );
                syncPortalToClassification(dataPart.data, ids.threadId);
            }
        },
        onFinish: ({ message, isAbort, isError }) => {
            if (!guidanceEnabled || isAbort || isError) return;
            const lastText = [...message.parts]
                .reverse()
                .find(part => part.type === 'text');
            const finding =
                lastText?.type === 'text'
                    ? findingFromReply(lastText.text)
                    : undefined;
            if (!finding) return;
            const ids = threadIdsRef.current;
            setLatestFinding(ids.remoteId, ids.threadId, finding);
        },
        onError: error => {
            if (error instanceof ChatAuthError) setAuthError(error.status);
        },
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    });
    const { addToolOutput } = chat;

    return useAISDKRuntime(chat, {
        adapters: { attachments: attachmentAdapter },
    });
}
