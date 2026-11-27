"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountMenu } from "@/modules/auth/components/account-menu";
import type { AccountInfo, AuthProvider } from "@/modules/auth/types";
import { parseConversationList } from "@/modules/chat/conversation-validation";
import { ChatComposer, type UploadStatus } from "@/modules/chat/components/chat-composer";
import { ChatHeader } from "@/modules/chat/components/chat-header";
import { ChatMessageList } from "@/modules/chat/components/chat-message-list";
import { ChatSidebar } from "@/modules/chat/components/chat-sidebar";
import { SourcePanel } from "@/modules/chat/components/source-panel";
import { isChatResponse, isUploadJobResponse } from "@/modules/chat/response-validation";
import type {
  Conversation,
  Message,
} from "@/modules/chat/types";
import {
  collectConversationUpdates,
  type ConversationUpdate,
} from "@/modules/chat/conversation-diff";
import type { ModelProvider } from "@/modules/account/types";
import { DEFAULT_PREFERENCES } from "@/modules/account/defaults";
import { parsePreferences, parseProviders } from "@/modules/account/components/account-dashboard-helpers";
import { Toast, ToastViewport } from "@/modules/shared/components/ui/notice";
import { isRecord } from "@/modules/shared/lib/guards";
import {
  chatErrorMessage,
  documentErrorMessage,
  networkErrorMessage,
} from "@/modules/shared/lib/user-facing-error";
import { applyTheme, getStoredTheme, isTheme, type Theme } from "@/modules/shared/lib/theme";
import { createId } from "@/modules/shared/lib/utils";
import { getStoredChatRuntimeSettings } from "@/modules/chat/runtime-settings";
import { createLineParser } from "@/modules/chat/stream-parser";
import {
  addToOutbox,
  readOutbox,
  removeFromOutbox,
} from "@/modules/chat/save-outbox";

const EMPTY_CONVERSATION: Conversation = {
  id: "new-chat",
  title: "New conversation",
  messages: [],
  updatedAt: 0,
};

function createConversation(): Conversation {
  return {
    id: createId(),
    title: "New conversation",
    messages: [],
    updatedAt: Date.now(),
  };
}

function isDesktopViewport() {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;
}

export function ChatWorkspace({
  account,
  authProvider,
}: {
  account: AccountInfo;
  authProvider: AuthProvider;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: "new-chat", title: "New conversation", messages: [], updatedAt: Date.now() },
  ]);
  const [activeId, setActiveId] = useState("new-chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [theme, setTheme] = useState<Theme>("light");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [accountSettingsError, setAccountSettingsError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ModelProvider>(DEFAULT_PREFERENCES.provider);
  const [model, setModel] = useState<string>(DEFAULT_PREFERENCES.model);
  const [pendingCitationId, setPendingCitationId] = useState<number | null>(null);
  const [dismissedErrorId, setDismissedErrorId] = useState<string | null>(null);
  const abortControllers = useRef(new Map<string, AbortController>());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<{
    ownerId: string;
    updates: ConversationUpdate[];
  } | null>(null);
  const persistedConversationsRef = useRef(new Map<string, Conversation>());
  const loadedMessagesRef = useRef(new Map<string, Message[]>());
  const [messagesLoading, setMessagesLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active =
    conversations.find((conversation) => conversation.id === activeId) ??
    conversations[0] ??
    EMPTY_CONVERSATION;
  const latestAssistant = active.messages.findLast((message) => message.role === "assistant");
  const latestCitations = useMemo(() => latestAssistant?.citations ?? [], [latestAssistant]);
  const totalTokens = useMemo(
    () => active.messages.reduce((total, message) => total + (message.tokens ?? 0), 0),
    [active.messages],
  );

  useEffect(() => {
    if (!isDesktopViewport()) {
      setSidebarOpen(false);
      setSourcesOpen(false);
    }
  }, []);

  useEffect(() => {
    const saved = getStoredTheme();
    if (saved) {
      setTheme(saved);
      applyTheme(saved);
    }

    if (authProvider !== "local") return;
    let cancelled = false;
    async function loadThemePreference() {
      try {
        const response = await fetch("/api/account/preferences", { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok || !isRecord(payload) || !isRecord(payload.preferences)) {
          throw new Error("Appearance settings could not be loaded.");
        }
        if (typeof payload.initialized !== "boolean") {
          throw new Error("Appearance settings were invalid.");
        }
        const savedTheme = payload.preferences.theme;
        if (!isTheme(savedTheme)) {
          throw new Error("Appearance settings were invalid.");
        }

        // Prefer the theme chosen on this device, then sync it back to the account.
        const themeToApply = saved ?? savedTheme;
        if (saved && (saved !== savedTheme || !payload.initialized)) {
          void fetch("/api/account/preferences", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ theme: saved }),
          });
        }

        if (cancelled) return;
        setTheme(themeToApply);
        applyTheme(themeToApply);
        setAccountSettingsError(null);
      } catch (error) {
        if (!cancelled) {
          setAccountSettingsError(error instanceof Error ? error.message : "Appearance settings could not be loaded.");
        }
      }
    }

    void loadThemePreference();
    return () => {
      cancelled = true;
    };
  }, [authProvider]);

  useEffect(() => {
    if (authProvider !== "local") {
      try {
        const raw = localStorage.getItem("atlas-chat-model-preference");
        const saved: unknown = raw ? JSON.parse(raw) : null;
        if (
          typeof saved === "object" &&
          saved !== null &&
          "provider" in saved &&
          "model" in saved &&
          typeof saved.provider === "string" &&
          typeof saved.model === "string"
        ) {
          const allowed = ["openai", "anthropic", "google", "ollama"];
          if (allowed.includes(saved.provider)) {
            setProvider(saved.provider as ModelProvider);
            setModel(saved.model);
            return;
          }
        }
      } catch {
        // Fall back to defaults for malformed local preferences.
      }
      setProvider(DEFAULT_PREFERENCES.provider);
      setModel(DEFAULT_PREFERENCES.model);
      return;
    }

    let cancelled = false;
    async function loadProviderPreference() {
      try {
        const [preferencesResponse, modelsResponse] = await Promise.all([
          fetch("/api/account/preferences", { cache: "no-store" }),
          fetch("/api/account/models", { cache: "no-store" }),
        ]);
        const [preferencesPayload, modelsPayload]: unknown[] = await Promise.all([
          preferencesResponse.json(),
          modelsResponse.json(),
        ]);
        if (!preferencesResponse.ok || !modelsResponse.ok) {
          throw new Error("The selected model provider could not be loaded.");
        }
        if (!isRecord(preferencesPayload)) throw new Error("The selected model provider response was invalid.");
        const preferences = parsePreferences(preferencesPayload.preferences);
        if (!preferences) throw new Error("The selected model provider was invalid.");
        if (!isRecord(modelsPayload)) throw new Error("The model list response was invalid.");
        const providers = parseProviders(modelsPayload.providers);
        if (!providers) throw new Error("The model list response was invalid.");
        if (cancelled) return;
        setProvider(preferences.provider);
        setModel(preferences.model);
      } catch (error) {
        if (!cancelled) {
          setAccountSettingsError(error instanceof Error ? error.message : "The selected model provider could not be loaded.");
        }
      }
    }

    void loadProviderPreference();
    return () => {
      cancelled = true;
    };
  }, [authProvider]);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryLoadedFor(null);
    setHistoryError(null);
    setConversations([createConversation()]);

    async function loadConversations() {
      try {
        const response = await fetch("/api/conversations", { cache: "no-store" });
        if (!response.ok) throw new Error(`Chat history could not be loaded (HTTP ${response.status}).`);
        const payload: unknown = await response.json();
        const loaded = isRecord(payload) ? parseConversationList(payload.conversations) : null;
        if (!loaded) throw new Error("The chat history response was invalid.");
        if (cancelled) return;

        persistedConversationsRef.current = new Map(
          loaded.map((conversation) => [conversation.id, conversation]),
        );
        const restored = loaded.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.status === "streaming"
              ? {
                ...message,
                content: message.content || "Response interrupted before it completed.",
                status: "stopped" as const,
                stage: "done" as const,
              }
              : message,
          ),
        }));
        const initial = restored.length ? restored : [createConversation()];
        setConversations(initial);
        setActiveId(initial[0].id);
        setHistoryLoadedFor(account.id);
        setHistoryError(null);
      } catch {
        if (!cancelled) {
          setHistoryError("Chat history could not be loaded. Your chats may not be saved.");
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    void loadConversations();
    return () => {
      cancelled = true;
    };
  }, [account.id, authProvider]);

  const postUpdate = useCallback(
    async (ownerId: string, update: ConversationUpdate, keepalive: boolean) => {
      const { snapshot, ...payload } = update;
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId,
          conversation: {
            id: payload.conversation.id,
            title: payload.conversation.title,
            updatedAt: payload.conversation.updatedAt,
            ...(payload.conversation.archivedAt !== undefined
              ? { archivedAt: payload.conversation.archivedAt }
              : {}),
          },
          messages: payload.messages,
        }),
        keepalive,
      });
      if (!response.ok) {
        throw new Error(`Conversation save failed (HTTP ${response.status}).`);
      }
      persistedConversationsRef.current.set(snapshot.id, snapshot);
      loadedMessagesRef.current.set(snapshot.id, snapshot.messages);
    },
    [],
  );

  const flushOutbox = useCallback(
    async (keepalive: boolean) => {
      const entries = readOutbox();
      const succeeded: string[] = [];
      for (const entry of entries) {
        try {
          await postUpdate(entry.ownerId, entry.update, keepalive);
          succeeded.push(entry.key);
        } catch {
          // Keep the failed entry and stop the batch; a later retry replays it.
          break;
        }
      }
      if (succeeded.length > 0) removeFromOutbox(succeeded);
      return succeeded.length === entries.length;
    },
    [postUpdate],
  );

  // Messages are loaded per conversation instead of with the whole history so
  // large transcripts cannot be silently truncated by the REST row limit.
  useEffect(() => {
    if (!historyLoadedFor || active.id === "new-chat") return;
    if (loadedMessagesRef.current.has(active.id)) return;

    let cancelled = false;
    setMessagesLoading(true);
    void fetch(`/api/conversations?id=${encodeURIComponent(active.id)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Messages could not be loaded (HTTP ${response.status}).`);
        const payload: unknown = await response.json();
        if (!isRecord(payload) || !Array.isArray(payload.messages)) {
          throw new Error("The message response was invalid.");
        }
        const parsed = parseConversationList([{ id: active.id, title: active.title, messages: payload.messages, updatedAt: active.updatedAt }]);
        if (!parsed || !parsed[0]) throw new Error("The message response was invalid.");
        return parsed[0].messages.map((message) =>
          message.status === "streaming"
            ? {
                ...message,
                content: message.content || "Response interrupted before it completed.",
                status: "stopped" as const,
                stage: "done" as const,
              }
            : message,
        );
      })
      .then((messages) => {
        if (cancelled) return;
        loadedMessagesRef.current.set(active.id, messages);
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === active.id ? { ...conversation, messages } : conversation,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setHistoryError("This conversation's messages could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active.id, active.title, active.updatedAt, historyLoadedFor]);

  const flushPendingSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const pendingSave = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pendingSave || pendingSave.updates.length === 0) return;

    // Persist the batch before the network call so a failure or tab close can
    // never drop it. Upserts are idempotent, so replay is safe.
    addToOutbox(pendingSave.ownerId, pendingSave.updates);
    const operation = saveQueue.current.then(async () => {
      const complete = await flushOutbox(false);
      if (complete) setHistoryError(null);
    });
    saveQueue.current = operation.catch(() => {
      setHistoryError("Chat history is not saved yet. We will keep retrying.");
    });
  }, [flushOutbox]);

  const flushOnExit = useCallback(() => {
    const pendingSave = pendingSaveRef.current;
    if (pendingSave) {
      addToOutbox(pendingSave.ownerId, pendingSave.updates);
      pendingSaveRef.current = null;
    }
    for (const entry of readOutbox()) {
      void postUpdate(entry.ownerId, entry.update, true)
        .then(() => removeFromOutbox([entry.key]))
        .catch(() => undefined);
    }
  }, [postUpdate]);

  useEffect(() => {
    if (historyLoadedFor !== account.id) {
      pendingSaveRef.current = null;
      return;
    }

    // Do not persist intermediate in-flight streaming states
    if (abortControllers.current.size > 0) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      pendingSaveRef.current = null;
      return;
    }

    // Only conversations whose object changed since the last successful save can
    // have pending writes. This keeps a save O(changed transcript) instead of
    // scanning every conversation and message the user owns.
    const changedConversations = conversations.filter(
      (conversation) => persistedConversationsRef.current.get(conversation.id) !== conversation,
    );
    const updates = collectConversationUpdates(changedConversations, persistedConversationsRef.current);

    if (updates.length === 0) {
      pendingSaveRef.current = null;
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    pendingSaveRef.current = { ownerId: account.id, updates };
    saveTimeoutRef.current = setTimeout(flushPendingSave, 800);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [account.id, conversations, flushPendingSave, historyLoadedFor]);

  useEffect(() => {
    const retry = window.setInterval(() => {
      if (readOutbox().length === 0) return;
      saveQueue.current = saveQueue.current
        .then(async () => {
          const complete = await flushOutbox(false);
          if (complete) setHistoryError(null);
        })
        .catch(() => {
          setHistoryError("Chat history is not saved yet. We will keep retrying.");
        });
    }, 10_000);

    window.addEventListener("pagehide", flushOnExit);
    return () => {
      window.clearInterval(retry);
      window.removeEventListener("pagehide", flushOnExit);
      flushOnExit();
    };
  }, [flushOnExit, flushOutbox]);

  const lastMessageContent = active.messages.at(-1)?.content;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active.messages.length, lastMessageContent]);

  useEffect(() => {
    if (!sourcesOpen || pendingCitationId === null) return;
    document.getElementById(`cite-${pendingCitationId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setPendingCitationId(null);
  }, [latestCitations, pendingCitationId, sourcesOpen]);

  const updateActive = useCallback((updater: (conversation: Conversation) => Conversation) => {
    setConversations((current) =>
      current.map((conversation) => (conversation.id === activeId ? updater(conversation) : conversation)),
    );
  }, [activeId]);

  const setThemeMode = useCallback((nextTheme: Theme) => {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    if (authProvider !== "local") return;
    void fetch("/api/account/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: nextTheme }),
    }).then((response) => {
      if (!response.ok) throw new Error("Appearance settings could not be saved.");
      setAccountSettingsError(null);
    }).catch((error: unknown) => {
      setAccountSettingsError(error instanceof Error ? error.message : "Appearance settings could not be saved.");
    });
  }, [authProvider]);

  const stopGeneration = useCallback(() => {
    active.messages
      .filter((message) => message.status === "streaming")
      .forEach((message) => abortControllers.current.get(message.id)?.abort());
    updateActive((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.status === "streaming" ? { ...message, status: "stopped", stage: "done" } : message,
      ),
    }));
  }, [active.messages, updateActive]);

  const runCompletion = useCallback(
    async (input: {
      message: string;
      history: Array<{ role: "user" | "assistant"; content: string }>;
      assistantId: string;
    }) => {
      const controller = abortControllers.current.get(input.assistantId);
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input.message,
          history: input.history,
          provider,
          model,
          settings: getStoredChatRuntimeSettings(account.id),
        }),
        signal: controller?.signal,
      });
      if (!response.ok || !response.body) {
        const payload: unknown = await response.json().catch(() => null);
        throw new Error(chatErrorMessage(response.status, payload));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";

      const patchAssistant = (patch: Partial<Message>) => {
        updateActive((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === input.assistantId ? { ...message, ...patch } : message,
          ),
        }));
      };

      let completed = false;
      const handleLine = (line: string) => {
        const event: unknown = JSON.parse(line);
        if (!isRecord(event) || typeof event.type !== "string") return;
        if (event.type === "delta" && typeof event.text === "string") {
          answer += event.text;
          const snapshot = answer;
          patchAssistant({ content: snapshot, status: "streaming", stage: "retrieving" });
        } else if (event.type === "result") {
          if (!isChatResponse(event)) throw new Error("The backend returned an invalid response.");
          patchAssistant({
            content: event.answer,
            status: "done",
            stage: "done",
            citations: event.citations,
            tokens: event.tokens,
          });
          completed = true;
        } else if (event.type === "error") {
          throw new Error(
            typeof event.message === "string" ? event.message : "The response could not be completed.",
          );
        }
      };
      const parseChunk = createLineParser(handleLine);

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parseChunk(decoder.decode(value, { stream: true }));
        if (completed) return;
      }

      // The stream ended without a result event; keep whatever text arrived.
      if (answer) patchAssistant({ content: answer, status: "done", stage: "done" });
    },
    [account.id, model, provider, updateActive],
  );

  const submitPrompt = useCallback(async (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;

    const now = Date.now();
    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: text,
      status: "done",
      createdAt: now,
    };
    const assistantId = createId();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      stage: "retrieving",
      createdAt: now + 1,
    };
    const history = active.messages
      .filter((message) => message.status === "done")
      .slice(-8)
      .map((message) => ({ role: message.role, content: message.content }));
    const controller = new AbortController();
    abortControllers.current.set(assistantId, controller);

    updateActive((conversation) => ({
      ...conversation,
      title: conversation.messages.length === 0 ? text.slice(0, 36) : conversation.title,
      messages: [...conversation.messages, userMessage, assistantMessage],
      updatedAt: now,
      archivedAt: undefined,
    }));
    setDismissedErrorId(null);
    if (isDesktopViewport()) setSourcesOpen(true);

    try {
      await runCompletion({ message: text, history, assistantId });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      const errorMessage =
        error instanceof Error && error.name !== "TypeError"
          ? error.message
          : networkErrorMessage();
      updateActive((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === assistantId
            ? { ...message, content: errorMessage, status: "error", stage: "done" }
            : message,
        ),
      }));
    } finally {
      abortControllers.current.delete(assistantId);
    }
  }, [active.messages, runCompletion, updateActive]);

  const regenerateResponse = useCallback(async (targetAssistantId?: string) => {
    const messages = active.messages;
    const assistantIndex = targetAssistantId
      ? messages.findIndex((m) => m.id === targetAssistantId)
      : messages.findLastIndex((m) => m.role === "assistant");

    if (assistantIndex === -1) return;
    const assistantMessage = messages[assistantIndex];
    if (!assistantMessage) return;

    const userIndex = messages.slice(0, assistantIndex).findLastIndex((m) => m.role === "user");
    if (userIndex === -1) return;
    const userMessage = messages[userIndex];
    if (!userMessage) return;

    const text = userMessage.content;
    const history = messages
      .slice(0, userIndex)
      .filter((message) => message.status === "done")
      .slice(-8)
      .map((message) => ({ role: message.role, content: message.content }));

    const assistantId = assistantMessage.id;
    abortControllers.current.get(assistantId)?.abort();
    const controller = new AbortController();
    abortControllers.current.set(assistantId, controller);

    updateActive((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === assistantId
          ? {
            ...message,
            content: "",
            status: "streaming",
            stage: "retrieving",
            citations: undefined,
            tokens: undefined,
          }
          : message,
      ),
      updatedAt: Date.now(),
    }));
    setDismissedErrorId(null);
    if (isDesktopViewport()) setSourcesOpen(true);

    try {
      await runCompletion({ message: text, history, assistantId });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      const errorMessage =
        error instanceof Error && error.name !== "TypeError"
          ? error.message
          : networkErrorMessage();
      updateActive((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === assistantId
            ? { ...message, content: errorMessage, status: "error", stage: "done" }
            : message,
        ),
      }));
    } finally {
      abortControllers.current.delete(assistantId);
    }
  }, [active.messages, runCompletion, updateActive]);

  const uploadDocument = useCallback(async (file: File) => {
    setIsUploading(true);
    setUploadStatus({ message: `Indexing ${file.name}…`, error: false });
    const formData = new FormData();
    formData.set("file", file);

    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: {
          "x-atlas-chunk-size": String(getStoredChatRuntimeSettings(account.id).chunkSize),
        },
        body: formData,
      });
      const result: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isRecord(result) ||
        !isUploadJobResponse(result.document)
      ) {
        throw new Error(documentErrorMessage(response.status, result));
      }
      setUploadStatus({
        message: result.document.duplicate
          ? `${result.document.name} was already uploaded.`
          : `Queued ${result.document.name} for indexing.`,
        error: false,
      });
    } catch (error) {
      setUploadStatus({
        message:
          error instanceof Error && error.name !== "TypeError"
            ? error.message
            : networkErrorMessage(),
        error: true,
      });
    } finally {
      setIsUploading(false);
    }
  }, [account.id]);

  const newConversation = useCallback(() => {
    const conversation = createConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveId(conversation.id);
    if (!isDesktopViewport()) setSidebarOpen(false);
  }, []);

  const toggleArchiveConversation = useCallback((id: string) => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;

    if (conversation.archivedAt !== undefined) {
      setConversations((current) =>
        current.map((item) => item.id === id ? { ...item, archivedAt: undefined } : item),
      );
      return;
    }

    setConversations((current) =>
      current.map((item) => item.id === id ? { ...item, archivedAt: Date.now() } : item),
    );
    if (activeId !== id) return;

    const nextConversation = conversations
      .filter((item) => item.id !== id && item.archivedAt === undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (nextConversation) {
      setActiveId(nextConversation.id);
      return;
    }

    const emptyConversation = createConversation();
    setConversations((current) => [emptyConversation, ...current]);
    setActiveId(emptyConversation.id);
  }, [activeId, conversations]);

  const deleteConversation = useCallback((id: string) => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;

    conversation.messages
      .filter((message) => message.status === "streaming")
      .forEach((message) => abortControllers.current.get(message.id)?.abort());
    setConversations((current) => current.filter((item) => item.id !== id));
    const deletion = saveQueue.current.then(async () => {
      const response = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Conversation delete failed (HTTP ${response.status}).`);
      }
      persistedConversationsRef.current.delete(id);
    });
    saveQueue.current = deletion.catch(() => {
      setHistoryError("The conversation could not be deleted. Try again.");
    });
    if (activeId !== id) return;

    const nextConversation = conversations
      .filter((item) => item.id !== id && item.archivedAt === undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (nextConversation) {
      setActiveId(nextConversation.id);
      return;
    }

    const emptyConversation = createConversation();
    setConversations((current) => [emptyConversation, ...current.filter((item) => item.id !== id)]);
    setActiveId(emptyConversation.id);
  }, [activeId, conversations]);

  const copyMessage = useCallback(async (message: Message) => {
    await navigator.clipboard.writeText(message.content);
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId(null), 1200);
  }, []);

  const handleOpenSources = useCallback((citationId: number) => {
    setPendingCitationId(citationId);
    setSourcesOpen(true);
  }, []);
  const handleCloseSources = useCallback(() => setSourcesOpen(false), []);
  const handleCopyMessage = useCallback((message: Message) => void copyMessage(message), [copyMessage]);
  const regenerateResponseRef = useRef(regenerateResponse);
  useEffect(() => {
    regenerateResponseRef.current = regenerateResponse;
  }, [regenerateResponse]);
  // Stable identity: message items are memoized, so a changing callback would
  // re-render every message in the transcript on each update.
  const handleRegenerate = useCallback(() => void regenerateResponseRef.current(), []);
  const handleSuggestion = useCallback((prompt: string) => void submitPrompt(prompt), [submitPrompt]);
  const handleSend = useCallback((prompt: string) => void submitPrompt(prompt), [submitPrompt]);
  const handleFileSelected = useCallback((file: File) => void uploadDocument(file), [uploadDocument]);
  const handleOpenSidebar = useCallback(() => setSidebarOpen(true), []);
  const handleCloseSidebar = useCallback(() => setSidebarOpen(false), []);
  const handleSelectConversation = useCallback((id: string) => {
    setActiveId(id);
    if (!isDesktopViewport()) setSidebarOpen(false);
  }, []);
  const handleDismissUpload = useCallback(() => setUploadStatus(null), []);
  const handleToggleTheme = useCallback(
    () => setThemeMode(theme === "dark" ? "light" : "dark"),
    [setThemeMode, theme],
  );
  const handleToggleSources = useCallback(() => setSourcesOpen((open) => !open), []);

  const assistantError =
    latestAssistant?.status === "error" && dismissedErrorId !== latestAssistant.id
      ? latestAssistant
      : null;

  const announcement = historyLoading
    ? "Loading your chats."
    : messagesLoading
      ? "Loading messages."
      : active.messages.some((message) => message.status === "streaming")
        ? "Generating a response."
        : "";

  return (
    <main className="relative flex h-dvh overflow-hidden text-ink">
      {sidebarOpen && (
        <>
          <div
            className="animate-overlay fixed inset-0 z-30 bg-[color-mix(in_srgb,var(--ink)_26%,transparent)] xl:hidden"
            onClick={handleCloseSidebar}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-40 w-[260px] animate-panel xl:static xl:z-auto xl:h-full xl:w-[260px] xl:animate-none">
            <ChatSidebar
              conversations={conversations}
              activeConversationId={active.id}
              totalTokens={totalTokens}
              onNewConversation={newConversation}
              onSelectConversation={handleSelectConversation}
              onToggleArchiveConversation={toggleArchiveConversation}
              onDeleteConversation={deleteConversation}
              onClose={handleCloseSidebar}
            />
          </div>
        </>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          title={active.title}
          sidebarOpen={sidebarOpen}
          theme={theme}
          accountControl={<AccountMenu account={account} authProvider={authProvider} />}
          hasSources={latestCitations.length > 0}
          sourcesOpen={sourcesOpen}
          onRenameTitle={(title) =>
            updateActive((conversation) => ({ ...conversation, title, updatedAt: Date.now() }))
          }
          onOpenSidebar={handleOpenSidebar}
          onToggleSources={handleToggleSources}
          onToggleTheme={handleToggleTheme}
        />

        <div className="flex min-h-0 flex-1">
          <ChatMessageList
            messages={active.messages}
            announcement={announcement}
            bottomRef={bottomRef}
            copiedMessageId={copiedMessageId}
            onCopyMessage={handleCopyMessage}
            onRegenerate={handleRegenerate}
            onSuggestion={handleSuggestion}
            onOpenSources={handleOpenSources}
          />
          {sourcesOpen && <SourcePanel citations={latestCitations} onClose={handleCloseSources} />}
        </div>

        <ChatComposer
          isGenerating={active.messages.some((message) => message.status === "streaming")}
          isUploading={isUploading}
          uploadStatus={uploadStatus}
          uploadsEnabled={authProvider === "supabase"}
          onSend={handleSend}
          onStop={stopGeneration}
          onFileSelected={handleFileSelected}
          onDismissUpload={handleDismissUpload}
        />
      </section>

      <ToastViewport>
        {historyLoading && (
          <Toast tone="info">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-r-transparent" />
              Loading your chats…
            </span>
          </Toast>
        )}
        {!historyLoading && messagesLoading && (
          <Toast tone="info">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-r-transparent" />
              Loading messages…
            </span>
          </Toast>
        )}
        {assistantError && (
          <Toast tone="error" onDismiss={() => setDismissedErrorId(assistantError.id)}>
            {assistantError.content}
          </Toast>
        )}
        {historyError && !historyLoading && (
          <Toast tone="warning" onDismiss={() => setHistoryError(null)}>
            {historyError}
          </Toast>
        )}
        {accountSettingsError && (
          <Toast tone="warning" onDismiss={() => setAccountSettingsError(null)}>
            {accountSettingsError}
          </Toast>
        )}
      </ToastViewport>
    </main>
  );
}
