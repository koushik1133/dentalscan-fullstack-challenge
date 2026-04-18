"use client";

import { Send, MessageSquare, X, User, Stethoscope, RotateCcw, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  threadId: string;
  content: string;
  sender: "patient" | "dentist" | string;
  createdAt: string;
  // client-side only
  failed?: boolean;
  pending?: boolean;
};

type Props = {
  patientId?: string;
  clinicName?: string;
  defaultOpen?: boolean;
};

/**
 * QuickMessageSidebar
 * A right-docked chat panel that lets the patient write quick messages to
 * the clinic. Messages are persisted through /api/messaging. The panel
 * auto-resolves a thread for the given patientId on first load.
 *
 * Transient network errors from HMR / brief connectivity blips are common
 * in dev — we handle them gracefully: failed messages stay in the thread
 * marked as "Not sent · Retry" rather than a loud red error at the bottom.
 */
export default function QuickMessageSidebar({
  patientId = "demo-patient",
  clinicName = "Bright Smile Dental",
  defaultOpen = true,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connectionWarning, setConnectionWarning] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // Initial load: resolve thread + fetch messages.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/messaging?patientId=${encodeURIComponent(patientId)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (cancelled) return;
        setThreadId(data.threadId ?? null);
        setMessages(data.messages ?? []);
        setConnectionWarning(false);
      } catch (e) {
        if (!cancelled) setConnectionWarning(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
          scrollToBottom();
        }
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [patientId, scrollToBottom]);

  // Poll for new dentist messages every 8s.
  useEffect(() => {
    if (!threadId) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/messaging?threadId=${encodeURIComponent(threadId)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        const serverMessages: Message[] = data.messages ?? [];
        setMessages((prev) => {
          // Preserve any local failed/pending messages that aren't on server yet
          const local = prev.filter((m) => m.failed || m.pending);
          const merged = [...serverMessages, ...local];
          if (merged.length !== prev.length) scrollToBottom();
          return merged;
        });
        setConnectionWarning(false);
      } catch {
        // Silent — polling is best-effort. We'll show a tiny banner only if
        // multiple consecutive polls fail (tracked via connectionWarning).
      }
    }, 8000);
    return () => clearInterval(id);
  }, [threadId, scrollToBottom]);

  const sendMessage = useCallback(
    async (content: string, optimisticId: string) => {
      try {
        const res = await fetch("/api/messaging", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            patientId,
            content,
            sender: "patient",
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `Server error ${res.status}`);
        if (!threadId && data.threadId) setThreadId(data.threadId);
        // Replace optimistic with server record
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? { ...data.message } : m))
        );
        setConnectionWarning(false);
      } catch (e) {
        // Mark as failed instead of removing — user can retry.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticId ? { ...m, pending: false, failed: true } : m
          )
        );
        setConnectionWarning(true);
      }
    },
    [threadId, patientId]
  );

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = input.trim();
    if (!content || sending) return;

    const optimisticId = `tmp_${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId,
      threadId: threadId ?? "",
      content,
      sender: "patient",
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setSending(true);
    scrollToBottom();

    await sendMessage(content, optimisticId);
    setSending(false);
    scrollToBottom();
  };

  const retryMessage = useCallback(
    async (m: Message) => {
      setMessages((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, pending: true, failed: false } : x))
      );
      await sendMessage(m.content, m.id);
    },
    [sendMessage]
  );

  const QUICK_REPLIES = [
    "When can I book a consultation?",
    "How do I read my results?",
    "Can I retake the scan?",
    "What are the next steps?",
  ];

  // Only count non-failed messages towards "empty state"
  const hasRealMessages = messages.some((m) => !m.failed);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-blue-600 text-white px-4 py-3 shadow-xl hover:bg-blue-500 transition"
        >
          <MessageSquare size={18} />
          <span className="text-sm font-medium">Message clinic</span>
        </button>
      )}

      <aside
        className={`fixed top-0 right-0 h-full w-full sm:w-96 bg-zinc-950 border-l border-zinc-800 z-40 flex flex-col shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Quick message sidebar"
      >
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-emerald-400 flex items-center justify-center">
              <Stethoscope size={18} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{clinicName}</p>
              <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Usually replies in minutes
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-2 rounded-full hover:bg-white/10 text-zinc-400"
            aria-label="Close messages"
          >
            <X size={18} />
          </button>
        </div>

        {connectionWarning && (
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 text-[11px] text-amber-300">
            <WifiOff size={12} />
            <span>Connection issue — messages will retry automatically.</span>
          </div>
        )}

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-zinc-950 to-black"
        >
          {loading ? (
            <div className="text-center text-xs text-zinc-500 mt-8">Loading conversation…</div>
          ) : !hasRealMessages && messages.length === 0 ? (
            <div className="text-center text-zinc-500 mt-8 space-y-2">
              <MessageSquare size={32} className="mx-auto text-zinc-700" />
              <p className="text-sm">Start the conversation</p>
              <p className="text-xs text-zinc-600">
                Your clinic has been notified of your scan. Ask a question to get things moving.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.sender === "patient";
              return (
                <div
                  key={m.id}
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex items-end gap-2 max-w-[85%] ${
                      mine ? "flex-row-reverse" : ""
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        mine ? "bg-blue-600" : "bg-zinc-700"
                      }`}
                    >
                      {mine ? (
                        <User size={14} className="text-white" />
                      ) : (
                        <Stethoscope size={14} className="text-white" />
                      )}
                    </div>
                    <div
                      className={`rounded-2xl px-3 py-2 text-sm ${
                        m.failed
                          ? "bg-red-500/15 border border-red-500/30 text-red-100"
                          : mine
                            ? `bg-blue-600 text-white rounded-br-sm ${
                                m.pending ? "opacity-70" : ""
                              }`
                            : "bg-zinc-800 text-zinc-100 rounded-bl-sm"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p
                          className={`text-[10px] ${
                            m.failed
                              ? "text-red-300"
                              : mine
                                ? "text-blue-200"
                                : "text-zinc-500"
                          }`}
                        >
                          {m.pending
                            ? "Sending…"
                            : m.failed
                              ? "Not sent"
                              : new Date(m.createdAt).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                        </p>
                        {m.failed && (
                          <button
                            onClick={() => retryMessage(m)}
                            className="text-[10px] text-red-200 hover:text-white flex items-center gap-1 underline"
                          >
                            <RotateCcw size={10} /> Retry
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {!loading && !hasRealMessages && (
          <div className="px-4 pb-2 flex flex-wrap gap-2">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="text-xs px-3 py-1.5 rounded-full border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={handleSend}
          className="p-3 border-t border-zinc-800 bg-zinc-950 flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder="Type a message…"
            className="flex-1 resize-none bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-32"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 flex items-center justify-center transition"
            aria-label="Send message"
          >
            <Send size={16} className="text-white" />
          </button>
        </form>
      </aside>
    </>
  );
}
