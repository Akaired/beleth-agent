"use client";

/**
 * Centered modal for the editor's "TradingView widget" button: pick a widget
 * type, type a symbol (for the widgets that take one), see a live preview, then
 * insert. The preview mounts the exact same embed the reader will get, so what
 * you see here is what lands in the post. Same visual shell as PromptDialog;
 * backdrop click and Escape cancel, body scroll is locked while open.
 *
 * The forum renders dark only, so the embed theme is fixed to "dark" — it is
 * still stored on the placeholder for forward-compatibility.
 */
import { useEffect, useId, useRef, useState } from "react";
import {
  TV_WIDGETS,
  TV_WIDGET_BY_ID,
  TV_DEFAULT_SYMBOL,
  TV_SYMBOL_RE,
  normalizeTvSymbol,
} from "@/lib/forum/tradingview";
import { mountTradingViewWidget } from "@/components/forum/tradingview-embeds";

export interface TvInsert {
  widget: string;
  symbol: string;
  theme: "dark";
}

export function TradingViewDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: (value: TvInsert) => void;
  onCancel: () => void;
}) {
  const [widget, setWidget] = useState(TV_WIDGETS[0].id);
  const [symbol, setSymbol] = useState(TV_DEFAULT_SYMBOL);
  const [prevOpen, setPrevOpen] = useState(open);
  const previewRef = useRef<HTMLDivElement>(null);
  const selectId = useId();
  const symbolId = useId();

  // The dialog stays mounted between opens — reset the fields each time it opens.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setWidget(TV_WIDGETS[0].id);
      setSymbol(TV_DEFAULT_SYMBOL);
    }
  }

  const def = TV_WIDGET_BY_ID[widget];
  const normSymbol = normalizeTvSymbol(symbol);
  const symbolOk = !def.needsSymbol || TV_SYMBOL_RE.test(normSymbol);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onCancel]);

  // Debounced live preview — rebuild the embed a beat after the last change.
  useEffect(() => {
    if (!open) return;
    const host = previewRef.current;
    if (!host) return;
    if (!symbolOk) {
      host.textContent = "";
      return;
    }
    const t = window.setTimeout(() => {
      mountTradingViewWidget(host, widget, normSymbol, "dark");
    }, 350);
    return () => window.clearTimeout(t);
  }, [open, widget, normSymbol, symbolOk]);

  if (!open) return null;

  const submit = () => {
    if (!symbolOk) return;
    onConfirm({
      widget,
      symbol: def.needsSymbol ? normSymbol : "",
      theme: "dark",
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Insert TradingView widget"
        className="relative flex w-full max-w-2xl flex-col rounded-lg border border-line bg-panel shadow-2xl"
      >
        <div className="grid gap-4 px-5 pt-4 pb-3 sm:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-3">
            <h2 className="text-[14px] font-medium text-txt">
              TradingView widget
            </h2>

            <div>
              <label
                htmlFor={selectId}
                className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-sec"
              >
                Widget
              </label>
              <select
                id={selectId}
                value={widget}
                onChange={(e) => setWidget(e.target.value)}
                className="w-full rounded border border-inputline bg-inset px-2 py-1.5 text-[12.5px] text-txt outline-none transition-colors focus:border-hoverline"
              >
                {TV_WIDGETS.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] leading-relaxed text-dim">
                {def.blurb}
              </p>
            </div>

            {def.needsSymbol && (
              <div>
                <label
                  htmlFor={symbolId}
                  className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-sec"
                >
                  Symbol
                </label>
                <input
                  id={symbolId}
                  value={symbol}
                  spellCheck={false}
                  onChange={(e) => setSymbol(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="AMEX:SPY"
                  className="w-full rounded border border-inputline bg-inset px-3 py-2 font-mono text-[12.5px] text-txt outline-none transition-colors focus:border-hoverline"
                />
                <p className="mt-1 text-[11px] leading-relaxed text-dim">
                  EXCHANGE:TICKER — e.g. NASDAQ:AAPL, AMEX:SPY, SP:SPX.
                </p>
                {!symbolOk && normSymbol !== "" && (
                  <p className="mt-1 text-[11px] text-down">
                    That is not a valid symbol.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="min-h-[280px] overflow-hidden rounded border border-line bg-inset p-2">
            <div ref={previewRef} className="tv-preview h-full w-full" />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <span className="text-[11px] text-dim">
            The TradingView attribution link is added automatically.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-3 py-1.5 text-[12px] text-sec transition-colors hover:text-txt"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!symbolOk}
              className="rounded border border-emphline bg-acc/15 px-3 py-1.5 text-[12px] font-medium text-acc transition-colors hover:bg-acc/25 disabled:opacity-50"
            >
              Insert widget
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
