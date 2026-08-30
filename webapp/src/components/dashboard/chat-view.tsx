"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BelethSprite } from "@/components/beleth-sprite";
import type { BelethScene } from "@/lib/beleth";
import { rateChatMessageAction } from "@/app/dashboard/chat/actions";
import type {
  ChatDisplayMessage,
  ChatEditResponse,
  ChatRating,
  ChatResponse,
} from "@/lib/chat/types";
import {
  IconArrowRight,
  IconChat,
  IconCheck,
  IconCopy,
  IconPencil,
  IconThumbsDown,
  IconThumbsUp,
} from "@/components/icons";

const SUGGESTIONS = [
  "What's your latest decision, and why?",
  "How do you decide whether to open a spread?",
  "Show me the risk checks you've failed recently.",
  "What's open on the book right now?",
];

type DisplayMsg = ChatDisplayMessage & { animate?: boolean; dbId?: string };
type PendingMsg = { id: string; role: "assistant"; content: string; pending: true };
type Msg = DisplayMsg | PendingMsg;

// Monotonic local ids for optimistic messages — no impure Date.now() in render.
let localSeq = 0;
const nextLocalId = (p: string) => `${p}-${(localSeq += 1)}`;

const isPendingMsg = (m: Msg): m is PendingMsg => "pending" in m;
/** The persisted row id when we have one, else the local React-key id. */
const realId = (m: Msg): string => ("dbId" in m && m.dbId ? m.dbId : m.id);
const isServerId = (id: string) =>
  !id.startsWith("local-") && !id.startsWith("pending-");

export function ChatView({
  sessionId,
  initialMessages,
  scene,
  mood,
}: {
  sessionId: string | null;
  initialMessages: ChatDisplayMessage[];
  scene: BelethScene;
  mood: "up" | "down" | null;
}) {
  const router = useRouter();
  const [sid, setSid] = useState<string | null>(sessionId);
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // A route the Next router still needs to adopt: we swapped the URL with
  // history.replaceState mid-answer (to avoid a remount), so the router thinks
  // it is still on /dashboard/chat. Reconciled once the answer finishes.
  const pendingRoute = useRef<string | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, pending, scrollToBottom]);

  // Last user / last assistant messages get their action row shown in the
  // clear; every other message reveals it on hover. Edit is last-user only.
  const { lastUserId, lastAssistantId } = useMemo(() => {
    let u: string | null = null;
    let a: string | null = null;
    for (const m of messages) {
      if (m.role === "user") u = m.id;
      else if (m.role === "assistant" && !isPendingMsg(m)) a = m.id;
    }
    return { lastUserId: u, lastAssistantId: a };
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending || editingId) return;
    setError(null);
    setInput("");
    const nowIso = new Date().toISOString();
    const userMsg: DisplayMsg = {
      id: nextLocalId("local"),
      role: "user",
      content: trimmed,
      created_at: nowIso,
    };
    const thinkingId = nextLocalId("pending");
    setMessages((m) => [
      ...m,
      userMsg,
      { id: thinkingId, role: "assistant", content: "", pending: true },
    ]);
    setPending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, message: trimmed }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setMessages((m) =>
        m.map((msg) => {
          if (msg.id === thinkingId) {
            return {
              id: thinkingId,
              role: "assistant" as const,
              content: data.answer,
              created_at: new Date().toISOString(),
              animate: true,
              dbId: data.assistantMessageId ?? undefined,
            };
          }
          if (msg.id === userMsg.id) {
            return { ...msg, dbId: data.userMessageId ?? undefined };
          }
          return msg;
        }),
      );

      if (!sid && data.sessionId) {
        setSid(data.sessionId);
        const url = `/dashboard/chat/${data.sessionId}`;
        // Update the address bar now WITHOUT a Next navigation — a router.replace
        // here would remount <ChatView> and kill the in-progress typewriter.
        // The router itself is reconciled to this URL in handleComposed, once
        // the answer has finished composing (so the remount is harmless), which
        // also makes the sidebar highlight this chat instead of "New chat".
        try {
          window.history.replaceState(window.history.state, "", url);
        } catch {
          /* non-fatal: URL just stays on /dashboard/chat */
        }
        pendingRoute.current = url;
      }
    } catch (err) {
      setMessages((m) => m.filter((msg) => msg.id !== thinkingId));
      setError((err as Error).message || "Something went wrong.");
    } finally {
      setPending(false);
      taRef.current?.focus();
    }
  }

  /** Edit the last user message: drop Beleth's last reply and regenerate. */
  async function submitEdit(keyId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending || !sid) return;
    const idx = messages.findIndex((m) => m.id === keyId);
    if (idx < 0) return;
    const target = messages[idx];
    const messageId = realId(target);
    if (!isServerId(messageId)) {
      // The message has not been persisted yet — nothing to regenerate against.
      setEditingId(null);
      return;
    }

    const snapshot = messages;
    setError(null);
    const editedUser: DisplayMsg = {
      ...(target as DisplayMsg),
      content: trimmed,
    };
    const thinkingId = nextLocalId("pending");
    setMessages([
      ...messages.slice(0, idx),
      editedUser,
      { id: thinkingId, role: "assistant", content: "", pending: true },
    ]);
    setEditingId(null);
    setPending(true);

    try {
      const res = await fetch("/api/chat/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, messageId, message: trimmed }),
      });
      const data = (await res.json()) as ChatEditResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setMessages((m) =>
        m.map((msg) => {
          if (msg.id === thinkingId) {
            return {
              id: thinkingId,
              role: "assistant" as const,
              content: data.answer,
              created_at: new Date().toISOString(),
              animate: true,
              dbId: data.assistantMessageId ?? undefined,
            };
          }
          if (msg.id === editedUser.id) {
            return { ...msg, dbId: data.userMessageId ?? undefined };
          }
          return msg;
        }),
      );
    } catch (err) {
      setMessages(snapshot);
      setError((err as Error).message || "Could not regenerate the answer.");
    } finally {
      setPending(false);
      taRef.current?.focus();
    }
  }

  /** Toggle the thumbs on one of Beleth's answers. */
  async function rate(keyId: string, next: ChatRating) {
    const msg = messages.find((m) => m.id === keyId);
    if (!msg || isPendingMsg(msg)) return;
    const current = (msg as DisplayMsg).rating ?? null;
    const value: ChatRating | null = current === next ? null : next;

    setMessages((m) =>
      m.map((x) => (x.id === keyId ? { ...x, rating: value } : x)),
    );

    const rid = realId(msg);
    if (!isServerId(rid)) return;
    const res = await rateChatMessageAction(rid, value).catch(() => ({
      ok: false,
    }));
    if (!res.ok) {
      setMessages((m) =>
        m.map((x) => (x.id === keyId ? { ...x, rating: current } : x)),
      );
    }
  }

  // Fired when a just-arrived answer finishes its typewriter reveal: drop the
  // animate flag and refresh server state. Deferred so no router work happens
  // mid-animation.
  const handleComposed = useCallback(
    (id: string) => {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === id && "animate" in msg ? { ...msg, animate: false } : msg,
        ),
      );
      if (pendingRoute.current) {
        const to = pendingRoute.current;
        pendingRoute.current = null;
        // Adopt the URL for real now — reconciles the router (so the sidebar
        // stops highlighting "New chat" and delete/navigation behave), then
        // refresh the shared layout so this chat appears in the recent list.
        router.replace(to);
      }
      router.refresh();
    },
    [router],
  );

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col gap-3 h-[calc(100dvh-8rem)] min-h-[420px]">
      <h1 className="flex items-center gap-2 text-[18px] font-light">
        <IconChat size={17} weight="bold" className="text-acc" />
        Chat with Beleth
      </h1>

      <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="w-20 opacity-90">
              <BelethSprite scene={scene} pnl={mood} />
            </div>
            <p className="max-w-sm text-[13px] text-sec leading-relaxed">
              Ask about the strategy, a recent decision, the risk checks, or
              what&apos;s on the book. Beleth reads its own data to answer — it
              can&apos;t trade from here.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-sec transition-colors hover:border-hoverline hover:text-txt"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-1">
            {messages.map((m) => (
              <Bubble
                key={m.id}
                msg={m}
                scene={scene}
                mood={mood}
                busy={pending}
                isLastUser={m.id === lastUserId}
                isLastAssistant={m.id === lastAssistantId}
                editing={editingId === m.id}
                onReveal={scrollToBottom}
                onComposed={handleComposed}
                onStartEdit={() => setEditingId(m.id)}
                onCancelEdit={() => setEditingId(null)}
                onSubmitEdit={(text) => submitEdit(m.id, text)}
                onRate={(r) => rate(m.id, r)}
              />
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded border border-killline/60 bg-down/5 px-3 py-2 text-[12px] text-down">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2 border-t border-line pt-3"
      >
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Ask Beleth…"
          disabled={!!editingId}
          className="max-h-32 min-h-[38px] flex-1 resize-none rounded-md border border-inputline bg-inset px-3 py-2 text-[13px] text-txt placeholder:text-faint focus:border-hoverline focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !input.trim() || !!editingId}
          aria-label="Send"
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md bg-acc/15 text-acc transition-colors hover:bg-acc/25 disabled:opacity-40"
        >
          <IconArrowRight size={16} weight="bold" />
        </button>
      </form>
    </div>
  );
}

function Bubble({
  msg,
  scene,
  mood,
  busy,
  isLastUser,
  isLastAssistant,
  editing,
  onReveal,
  onComposed,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRate,
}: {
  msg: Msg;
  scene: BelethScene;
  mood: "up" | "down" | null;
  busy: boolean;
  isLastUser: boolean;
  isLastAssistant: boolean;
  editing: boolean;
  onReveal: () => void;
  onComposed: (id: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (text: string) => void;
  onRate: (rating: ChatRating) => void;
}) {
  const isUser = msg.role === "user";
  const isPending = isPendingMsg(msg);
  const animate = !isUser && !isPending && "animate" in msg && Boolean(msg.animate);
  const rating = !isPending ? (msg as DisplayMsg).rating ?? null : null;

  if (isUser) {
    if (editing) {
      return (
        <div className="flex justify-end">
          <EditBox
            initial={msg.content}
            onCancel={onCancelEdit}
            onSubmit={onSubmitEdit}
          />
        </div>
      );
    }
    return (
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-chipbg px-3.5 py-2 text-[13px] leading-relaxed text-txt">
          {msg.content}
        </div>
        <MessageActions
          alwaysVisible={isLastUser}
          content={msg.content}
          onEdit={isLastUser && !busy ? onStartEdit : undefined}
        />
      </div>
    );
  }

  return (
    <div className="group flex gap-2.5">
      <div className="mt-0.5 w-7 shrink-0 opacity-90">
        <BelethSprite scene={scene} pnl={mood} />
      </div>
      <div className="min-w-0 max-w-[85%] pt-1">
        {isPending ? (
          <ComposingIndicator />
        ) : (
          <>
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-txt">
              {animate ? (
                <Typewriter
                  text={msg.content}
                  onReveal={onReveal}
                  onDone={() => onComposed(msg.id)}
                />
              ) : (
                msg.content
              )}
            </div>
            {!animate && (
              <MessageActions
                alwaysVisible={isLastAssistant}
                content={msg.content}
                rating={rating}
                onRate={busy ? undefined : onRate}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The like / dislike / copy / edit row under a message. */
function MessageActions({
  alwaysVisible,
  content,
  rating,
  onRate,
  onEdit,
}: {
  alwaysVisible: boolean;
  content: string;
  rating?: ChatRating | null;
  onRate?: (rating: ChatRating) => void;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div
      className={`flex items-center gap-0.5 text-faint transition-opacity ${
        alwaysVisible
          ? "opacity-100"
          : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
      }`}
    >
      {onRate && (
        <>
          <ActionButton
            label="Good answer"
            active={rating === "up"}
            onClick={() => onRate("up")}
          >
            <IconThumbsUp size={13} weight={rating === "up" ? "fill" : "regular"} />
          </ActionButton>
          <ActionButton
            label="Bad answer"
            active={rating === "down"}
            onClick={() => onRate("down")}
          >
            <IconThumbsDown
              size={13}
              weight={rating === "down" ? "fill" : "regular"}
            />
          </ActionButton>
        </>
      )}
      <ActionButton label={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? (
          <IconCheck size={13} className="text-up" />
        ) : (
          <IconCopy size={13} />
        )}
      </ActionButton>
      {onEdit && (
        <ActionButton label="Edit" onClick={onEdit}>
          <IconPencil size={13} />
        </ActionButton>
      )}
    </div>
  );
}

function ActionButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-hoverbg hover:text-sec ${
        active ? "text-acc" : ""
      }`}
    >
      {children}
    </button>
  );
}

function EditBox({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  return (
    <div className="w-full max-w-[min(85%,640px)] rounded-lg border border-inputline bg-inset p-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={2}
        maxLength={2000}
        className="max-h-40 min-h-[44px] w-full resize-none rounded bg-transparent px-1.5 py-1 text-[13px] leading-relaxed text-txt focus:outline-none"
      />
      <div className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2.5 py-1 text-[11.5px] text-sec transition-colors hover:text-txt"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSubmit(value)}
          disabled={!value.trim()}
          className="rounded border border-emphline bg-acc/15 px-2.5 py-1 text-[11.5px] text-acc transition-colors hover:bg-acc/25 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}

/** Three dots that lift in sequence — "Beleth is composing…". */
function ComposingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Beleth is composing">
      {["0s", "0.18s", "0.36s"].map((d) => (
        <span
          key={d}
          className="b-compose-dot inline-block h-1.5 w-1.5 rounded-full bg-sec"
          style={{ animationDelay: d }}
        />
      ))}
    </span>
  );
}

// Roughly how long the whole reveal should take, whatever the length.
const TYPEWRITER_DURATION_MS = 6000;
const TYPEWRITER_TICK_MS = 30;

/**
 * Reveals `text` progressively, as if Beleth were composing it — a steady pace
 * that lands on ~6s regardless of length. A pulsing dot leads the text and
 * disappears the moment the last character lands; `onDone` fires once then.
 */
function Typewriter({
  text,
  onReveal,
  onDone,
}: {
  text: string;
  onReveal: () => void;
  onDone: () => void;
}) {
  const [n, setN] = useState(0);
  const step = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(text.length / (TYPEWRITER_DURATION_MS / TYPEWRITER_TICK_MS)),
      ),
    [text],
  );
  const doneFired = useRef(false);

  useEffect(() => {
    if (n >= text.length) {
      if (!doneFired.current) {
        doneFired.current = true;
        onDone();
      }
      return;
    }
    const id = window.setTimeout(() => {
      setN((v) => Math.min(text.length, v + step));
      onReveal();
    }, TYPEWRITER_TICK_MS);
    return () => window.clearTimeout(id);
  }, [n, text, step, onReveal, onDone]);

  const done = n >= text.length;
  return (
    <>
      {!done && (
        <span className="b-compose-dot mr-1.5 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-acc/80 align-middle" />
      )}
      {text.slice(0, n)}
    </>
  );
}
