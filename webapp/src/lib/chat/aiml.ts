/**
 * Minimal client for AI/ML API (https://aimlapi.com), reached through its
 * OpenAI-compatible `/chat/completions` endpoint with a plain `fetch` — no SDK,
 * matching this repo's dependency-light style (see `src/lib/supabase.ts`).
 *
 * This is the ONLY place the webapp calls an LLM. The agent keeps OpenRouter;
 * "Chat with Beleth" is a webapp-only feature and uses AI/ML API on a free
 * model. Provider/model are env-driven:
 *   AIML_API_KEY   (required, server-only — never NEXT_PUBLIC)
 *   AIML_MODEL     (default below; keep it a free model)
 *   AIML_BASE_URL  (default below)
 */
import "server-only";
import { buildSystemPrompt, type BelethMood } from "@/lib/chat/persona";
import { TOOL_SCHEMAS, runTool, type ToolContext } from "@/lib/chat/tools";
import type { ToolCall } from "@/lib/chat/types";

/** A model-call failure with a visitor-safe message and an HTTP status hint. */
export class ChatModelError extends Error {
  status: number;
  userMessage: string;
  constructor(message: string, status: number, userMessage: string) {
    super(message);
    this.name = "ChatModelError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

const DEFAULT_BASE_URL = "https://api.aimlapi.com/v1";
const DEFAULT_MODEL = "openai/gpt-oss-20b";
/** Hard ceiling on model round-trips per user message (tool hops included). */
const MAX_TURNS = 5;
const REQUEST_TIMEOUT_MS = 55_000;
/**
 * gpt-oss is a reasoning model: with the default budget it spends the whole
 * allowance "thinking" and returns an EMPTY answer (observed: 897/900
 * completion tokens were reasoning). Keep the reasoning short and leave real
 * room for the reply.
 */
const MAX_OUTPUT_TOKENS = 1600;
const REASONING_EFFORT = "low";

type ApiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type ApiChoice = {
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: ToolCall[] | null;
  };
  finish_reason?: string;
};

type ApiResponse = {
  choices?: ApiChoice[];
  usage?: Record<string, number>;
  error?: unknown;
};

/** One persisted transcript row produced by a turn (maps to public.chat_messages). */
export type TurnMessage = {
  role: "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[] | null;
  tool_call_id?: string | null;
};

export type BelethTurnResult = {
  /** New rows to persist, in order (assistant / tool / ... / assistant). */
  newMessages: TurnMessage[];
  /** The final assistant answer text, for the immediate response. */
  answer: string;
  model: string;
  usage: Record<string, number> | null;
};

function config() {
  const apiKey = process.env.AIML_API_KEY;
  if (!apiKey) {
    throw new Error("AIML_API_KEY is not set");
  }
  return {
    apiKey,
    model: process.env.AIML_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: (process.env.AIML_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    ),
  };
}

async function callModel(
  messages: ApiMessage[],
  opts: {
    apiKey: string;
    model: string;
    baseUrl: string;
    withTools: boolean;
    maxTokens?: number;
  },
): Promise<{ choice: ApiChoice; usage: Record<string, number> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: 0.4,
        max_tokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS,
        // Passed through by AI/ML API for gpt-oss; harmless if a model ignores it.
        reasoning_effort: REASONING_EFFORT,
        ...(opts.withTools
          ? { tools: TOOL_SCHEMAS, tool_choice: "auto" }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof ChatModelError) throw err;
    throw new ChatModelError(
      `AI/ML API unreachable: ${(err as Error).message ?? "network error"}`,
      502,
      "Beleth could not reach the model. Try again in a moment.",
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    const body = text.slice(0, 400);
    const quota =
      res.status === 429 ||
      (res.status === 403 && /quota|limit exceeded/i.test(body));
    if (quota) {
      throw new ChatModelError(
        `AI/ML API quota: HTTP ${res.status}: ${body}`,
        429,
        "Beleth's free model quota for today is used up. Please try again later.",
      );
    }
    throw new ChatModelError(
      `AI/ML API HTTP ${res.status}: ${body}`,
      502,
      "Beleth could not reach the model. Try again in a moment.",
    );
  }
  let data: ApiResponse;
  try {
    data = JSON.parse(text) as ApiResponse;
  } catch {
    throw new Error("AI/ML API returned a non-JSON body");
  }
  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error("AI/ML API returned no choices");
  }
  return { choice, usage: data.usage ?? null };
}

/**
 * Run one user message through Beleth: system prompt + prior transcript + the
 * new message, then a bounded tool-calling loop. Returns the rows to persist
 * and the final answer. Token usage is logged per call.
 */
export async function runBelethTurn(params: {
  mood: BelethMood;
  history: ApiMessage[];
  userMessage: string;
  toolContext: ToolContext;
}): Promise<BelethTurnResult> {
  const { apiKey, model, baseUrl } = config();

  const messages: ApiMessage[] = [
    { role: "system", content: buildSystemPrompt(params.mood) },
    ...params.history,
    { role: "user", content: params.userMessage },
  ];

  const newMessages: TurnMessage[] = [];
  let lastUsage: Record<string, number> | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const isLast = turn === MAX_TURNS - 1;
    const { choice, usage } = await callModel(messages, {
      apiKey,
      model,
      baseUrl,
      withTools: !isLast,
    });
    lastUsage = usage;
    if (usage) {
      console.info(
        `[chat] model=${model} turn=${turn} tokens=${JSON.stringify(usage)}`,
      );
    }

    const toolCalls = choice.message.tool_calls ?? [];
    const rawContent = choice.message.content ?? "";
    const content = rawContent.trim();

    if (!toolCalls.length) {
      // Answer turn. gpt-oss sometimes spends its whole budget "reasoning" and
      // returns an EMPTY answer — retry once, no tools, a bigger budget, with a
      // nudge to answer straight away.
      let answer = content;
      if (!answer) {
        const retry = await callModel(
          [
            ...messages,
            {
              role: "user",
              content:
                "Give your answer now — in character, one short paragraph, no tools.",
            },
          ],
          { apiKey, model, baseUrl, withTools: false, maxTokens: 2400 },
        );
        if (retry.usage) {
          lastUsage = retry.usage;
          console.info(
            `[chat] model=${model} retry tokens=${JSON.stringify(retry.usage)}`,
          );
        }
        answer =
          (retry.choice.message.content ?? "").trim() ||
          "I lost the thread on that one — ask me again and I'll keep it short.";
      }
      messages.push({ role: "assistant", content: answer });
      newMessages.push({ role: "assistant", content: answer, tool_calls: null });
      return { newMessages, answer, model, usage: lastUsage };
    }

    // Tool-call turn — record it, run the tools, feed the results back.
    messages.push({ role: "assistant", content: rawContent, tool_calls: toolCalls });
    newMessages.push({
      role: "assistant",
      content: rawContent,
      tool_calls: toolCalls,
    });
    for (const call of toolCalls) {
      const result = await runTool(
        call.function.name,
        call.function.arguments ?? "",
        params.toolContext,
      );
      const payload = JSON.stringify(result).slice(0, 12_000);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: payload,
      });
      newMessages.push({
        role: "tool",
        content: payload,
        tool_call_id: call.id,
      });
    }
  }

  // Loop exhausted without a plain answer — synthesise a safe closing line.
  const fallback =
    "I gathered the data but ran out of room to finish that thought — ask me again and I'll be more direct.";
  messages.push({ role: "assistant", content: fallback });
  newMessages.push({ role: "assistant", content: fallback, tool_calls: null });
  return { newMessages, answer: fallback, model, usage: lastUsage };
}

export type { ApiMessage };
