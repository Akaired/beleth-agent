"use client";

/**
 * Turns every inert <div class="tv-embed" data-tv-widget …> the sanitiser let
 * through into a live TradingView embed: the official container markup, the
 * required attribution link, and the per-widget <script> carrying its JSON
 * config as text content. Mirrors <HighlightCode> — mounted once on the topic
 * page, re-runs when `signature` changes (a post was edited).
 *
 * The scripts load straight from s3.tradingview.com; no API key, no account.
 * The `.tradingview-widget-copyright` link is mandatory under TradingView's
 * embed terms — it is always rendered and must never be stripped.
 */
import { useEffect } from "react";
import {
  TV_WIDGET_BY_ID,
  tvScriptSrc,
  type TvTheme,
} from "@/lib/forum/tradingview";

/**
 * Build the real TradingView container inside `host`, replacing whatever it
 * held. Shared by the render-side walker below and the insert modal's live
 * preview.
 */
export function mountTradingViewWidget(
  host: HTMLElement,
  widgetId: string,
  symbol: string,
  theme: TvTheme,
): void {
  const def = TV_WIDGET_BY_ID[widgetId];
  if (!def) return;

  host.textContent = "";
  host.style.height = `${def.height}px`;

  const container = document.createElement("div");
  container.className = "tradingview-widget-container";
  container.style.height = "100%";
  container.style.width = "100%";

  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  widget.style.height = "calc(100% - 32px)";
  widget.style.width = "100%";

  const copyright = document.createElement("div");
  copyright.className = "tradingview-widget-copyright";
  const link = document.createElement("a");
  link.href = "https://www.tradingview.com/";
  link.rel = "noopener nofollow";
  link.target = "_blank";
  link.textContent = "Track all markets on TradingView";
  copyright.appendChild(link);

  const script = document.createElement("script");
  script.type = "text/javascript";
  script.async = true;
  script.src = tvScriptSrc(widgetId);
  script.textContent = JSON.stringify(def.build(symbol, theme));

  container.append(widget, copyright, script);
  host.appendChild(container);
}

export function TradingViewEmbeds({ signature }: { signature: string }) {
  useEffect(() => {
    document
      .querySelectorAll<HTMLElement>(".forum-prose .tv-embed[data-tv-widget]")
      .forEach((el) => {
        if (el.dataset.tvMounted === "yes") return;
        const widgetId = el.dataset.tvWidget ?? "";
        if (!TV_WIDGET_BY_ID[widgetId]) return;
        const symbol = el.dataset.tvSymbol ?? "";
        const theme: TvTheme = el.dataset.tvTheme === "light" ? "light" : "dark";
        el.dataset.tvMounted = "yes";
        mountTradingViewWidget(el, widgetId, symbol, theme);
      });
  }, [signature]);

  return null;
}
