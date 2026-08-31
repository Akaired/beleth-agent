"use client";

/**
 * A single TradingView embed, mounted client-side. Thin wrapper over the forum
 * mounter (`mountTradingViewWidget`) so the Portfolio page can drop a chart in
 * without the forum's editor or sanitiser. Scripts load straight from
 * s3.tradingview.com, no API key. The mandatory attribution link is rendered
 * by the mounter and must not be removed.
 *
 * The server renders a sized placeholder only, so there is no hydration
 * surface and the layout does not jump when the widget swaps in.
 */
import { useEffect, useRef } from "react";
import { mountTradingViewWidget } from "@/components/forum/tradingview-embeds";
import { TV_WIDGET_BY_ID, type TvTheme } from "@/lib/forum/tradingview";

function resolveTheme(): TvTheme {
  if (typeof document !== "undefined") {
    const t = document.documentElement.dataset.theme;
    if (t === "light") return "light";
  }
  return "dark";
}

export function TvWidget({
  widgetId,
  symbol,
  className = "",
}: {
  widgetId: string;
  symbol: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const height = TV_WIDGET_BY_ID[widgetId]?.height ?? 240;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    mountTradingViewWidget(el, widgetId, symbol, resolveTheme());
    return () => {
      el.textContent = "";
    };
  }, [widgetId, symbol]);

  return (
    <div
      ref={hostRef}
      style={{ height }}
      className={`overflow-hidden rounded-sm ${className}`}
    />
  );
}
