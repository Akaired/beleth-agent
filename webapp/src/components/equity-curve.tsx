"use client";

/**
 * The account equity curve, drawn with TradingView's lightweight-charts.
 *
 * A themed Baseline series (green above the account cost basis, red below) with
 * a subtle Beleth watermark, a range switcher (1D / 1W / 1M / ALL) that refetches
 * from `/api/equity`, an optional moving-average overlay, submitted-order
 * markers with a hover tooltip, and a crosshair-driven legend. Everything is
 * created inside an effect — the server renders only a sized placeholder, so
 * there is no hydration surface and lightweight-charts never touches `window`
 * on the server.
 *
 * Colours are read from the design tokens in globals.css so the chart stays in
 * lockstep with the rest of the UI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BaselineData,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  LineData,
  MouseEventParams,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import {
  EQUITY_RANGES,
  isEquityRange,
  type EquityBar,
  type EquityHistory,
  type EquityRange,
  type TradeMarker,
} from "@/lib/equity";
import { MarketChip } from "@/components/market-chip";

type Variant = "hero" | "panel";
type LwcModule = typeof import("lightweight-charts");

const HEIGHT: Record<Variant, number> = { hero: 360, panel: 260 };

const RANGE_LABEL: Record<EquityRange, string> = {
  "1D": "1D",
  "1W": "1W",
  "1M": "1M",
  ALL: "ALL",
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

const usd0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUsd(v: number): string {
  return `$${usd2.format(v)}`;
}

function formatSigned(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}$${usd2.format(Math.abs(v))}`;
}

function formatPct(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

function toLineData(points: EquityBar[]): LineData<Time>[] {
  return points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
}

/** Trailing simple moving average, as lightweight-charts line data. */
function movingAverage(points: EquityBar[]): LineData<Time>[] {
  const window = Math.min(40, Math.max(3, Math.round(points.length / 8)));
  const data: LineData<Time>[] = [];
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    sum += points[i].value;
    if (i >= window) sum -= points[i - window].value;
    if (i >= window - 1) {
      data.push({ time: points[i].time as UTCTimestamp, value: sum / window });
    }
  }
  return data;
}

/** Filtered markers for the visible window, plus an id → trade lookup for the tooltip. */
function buildMarkers(
  markers: TradeMarker[],
  points: EquityBar[],
  accent: string,
  muted: string,
): { markers: SeriesMarker<Time>[]; byId: Map<string, TradeMarker> } {
  const byId = new Map<string, TradeMarker>();
  if (points.length === 0) return { markers: [], byId };
  const from = points[0].time;
  const to = points[points.length - 1].time;
  const out = markers
    .filter((m) => m.time >= from && m.time <= to)
    .sort((a, b) => a.time - b.time)
    .map((m, i): SeriesMarker<Time> => {
      const id = `trade-${i}-${m.time}`;
      byId.set(id, m);
      const isExit = m.state === "exit";
      return {
        id,
        time: m.time as UTCTimestamp,
        position: isExit ? "aboveBar" : "belowBar",
        color: m.state === "open" ? accent : muted,
        shape: isExit ? "arrowDown" : "arrowUp",
        text: m.state === "open" ? "OPEN" : "",
        size: m.state === "open" ? 2 : 1,
      };
    });
  return { markers: out, byId };
}

const STATE_BADGE: Record<
  TradeMarker["state"],
  { label: string; className: string }
> = {
  open: { label: "Open", className: "bg-acc/15 text-acc" },
  closed: { label: "Closed", className: "bg-sec/15 text-sec" },
  exit: { label: "Exit", className: "bg-sec/15 text-sec" },
};

function TradeTooltip({
  marker,
  x,
  y,
  width,
}: {
  marker: TradeMarker;
  x: number;
  y: number;
  width: number;
}) {
  const badge = STATE_BADGE[marker.state];
  const above = y > 108;
  const left = Math.min(Math.max(x, 92), Math.max(92, width - 92));
  const netCredit = marker.net !== null ? -marker.net : null;

  return (
    <div
      className="pointer-events-none absolute z-10 w-[214px] rounded-md border border-line bg-panel/95 px-2.5 py-2 shadow-lg shadow-black/40 backdrop-blur-sm"
      style={{
        left,
        top: above ? y - 12 : y + 12,
        transform: `translate(-50%, ${above ? "-100%" : "0"})`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`rounded px-1 py-px font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] ${badge.className}`}
        >
          {badge.label}
        </span>
        <span className="font-mono text-[11px] text-txt">
          {marker.underlying}
        </span>
      </div>

      {marker.spread && (
        <div className="mt-1 font-mono text-[10.5px] text-sec">
          {marker.spread}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-dim">
        {marker.qty != null && <span>{marker.qty} spreads</span>}
        {netCredit != null && (
          <span>
            {netCredit >= 0 ? "credit" : "debit"} ${Math.abs(netCredit).toFixed(2)}
          </span>
        )}
      </div>

      {(marker.shortLeg?.price != null || marker.longLeg?.price != null) && (
        <div className="mt-1 font-mono text-[9.5px] text-dim">
          {marker.shortLeg?.price != null && (
            <span>
              {marker.shortLeg.strike}
              {marker.right ?? ""} @ {marker.shortLeg.price.toFixed(2)}
            </span>
          )}
          {marker.shortLeg?.price != null && marker.longLeg?.price != null && (
            <span> · </span>
          )}
          {marker.longLeg?.price != null && (
            <span>
              {marker.longLeg.strike}
              {marker.right ?? ""} @ {marker.longLeg.price.toFixed(2)}
            </span>
          )}
        </div>
      )}

      <div className="mt-1 font-mono text-[9px] text-faint">
        {new Date(marker.filledAt).toLocaleString()}
      </div>
    </div>
  );
}

export function EquityCurve({
  initial,
  variant = "panel",
  markers = [],
  watermarkText = "BELETH",
  marketOpen,
}: {
  initial: EquityHistory;
  variant?: Variant;
  markers?: TradeMarker[];
  watermarkText?: string;
  marketOpen?: boolean | null;
}) {
  const [history, setHistory] = useState<EquityHistory>(initial);
  const [range, setRange] = useState<EquityRange>(initial.range);
  const [loading, setLoading] = useState(false);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [showAvg, setShowAvg] = useState(variant === "panel");
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{
    marker: TradeMarker;
    x: number;
    y: number;
    width: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const lwcRef = useRef<LwcModule | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);
  const avgRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const rangeLineRef = useRef<IPriceLine | null>(null);
  const markerByIdRef = useRef<Map<string, TradeMarker>>(new Map());

  const enoughData = history.points.length >= 2;

  const selectRange = useCallback(
    async (next: EquityRange) => {
      if (next === range || loading) return;
      const previous = range;
      setRange(next);
      setLoading(true);
      setStaleError(null);
      try {
        const res = await fetch(`/api/equity?range=${next}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as EquityHistory;
        if (!isEquityRange(data.range)) throw new Error("bad payload");
        setHistory(data);
      } catch {
        setStaleError("couldn't load that range");
        setRange(previous);
      } finally {
        setLoading(false);
      }
    },
    [range, loading],
  );

  // Push data / options into an existing chart. Safe to call before the async
  // chart build has finished — the ref guards make it a no-op until then.
  const applyData = useCallback(() => {
    const LWC = lwcRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!LWC || !chart || !series) return;

    const points = history.points;
    series.setData(toLineData(points));
    series.applyOptions({
      baseValue: { type: "price", price: history.baseValue },
    });

    if (rangeLineRef.current) {
      series.removePriceLine(rangeLineRef.current);
      rangeLineRef.current = null;
    }
    if (points.length > 0) {
      rangeLineRef.current = series.createPriceLine({
        price: points[0].value,
        color: cssVar("--color-dim", "#5d666e"),
        lineWidth: 1,
        lineStyle: LWC.LineStyle.Dotted,
        axisLabelVisible: false,
        title: `${RANGE_LABEL[history.range]} open`,
      });
    }

    if (avgRef.current) {
      avgRef.current.setData(movingAverage(points));
      avgRef.current.applyOptions({ visible: showAvg });
    }

    const built = buildMarkers(
      markers,
      points,
      cssVar("--color-acc", "#d9a03c"),
      cssVar("--color-sec", "#8c959d"),
    );
    markerByIdRef.current = built.byId;
    markersRef.current?.setMarkers(built.markers);
    setTooltip(null);

    chart.timeScale().fitContent();
  }, [history, showAvg, markers]);

  // Build the chart once (after we know there is data to show).
  useEffect(() => {
    if (!containerRef.current || !enoughData) return;

    let disposed = false;
    let onMove: ((p: MouseEventParams<Time>) => void) | null = null;

    (async () => {
      const LWC = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;
      lwcRef.current = LWC;

      const up = cssVar("--color-up", "#35a67c");
      const down = cssVar("--color-down", "#e0584c");
      const accent = cssVar("--color-acc", "#d9a03c");
      const sec = cssVar("--color-sec", "#8c959d");
      const gridline = cssVar("--color-line", "#1f262c");
      const hoverline = cssVar("--color-hoverline", "#3a444c");
      const bg = cssVar("--color-bg", "#0b0e11");
      const fontFamily = cssVar(
        "--font-sans",
        "system-ui, -apple-system, sans-serif",
      );

      const chart = LWC.createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { type: LWC.ColorType.Solid, color: "transparent" },
          textColor: sec,
          fontFamily,
          fontSize: 11,
          attributionLogo: false,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: gridline, style: LWC.LineStyle.Solid },
        },
        rightPriceScale: {
          borderVisible: false,
          entireTextOnly: true,
          scaleMargins: {
            top: variant === "hero" ? 0.16 : 0.2,
            bottom: 0.08,
          },
        },
        leftPriceScale: { visible: false },
        timeScale: {
          borderVisible: false,
          timeVisible: history.intraday,
          secondsVisible: false,
          rightOffset: 5,
          barSpacing: variant === "hero" ? 9 : 7,
        },
        crosshair: {
          mode: LWC.CrosshairMode.Magnet,
          vertLine: {
            color: hoverline,
            width: 1,
            style: LWC.LineStyle.Dashed,
            labelBackgroundColor: accent,
          },
          horzLine: {
            color: hoverline,
            width: 1,
            style: LWC.LineStyle.Dashed,
            labelBackgroundColor: accent,
          },
        },
        handleScroll: {
          mouseWheel: false,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          mouseWheel: false,
          pinch: true,
          axisPressedMouseMove: true,
          axisDoubleClickReset: true,
        },
        localization: {
          priceFormatter: (p: number) => `$${usd0.format(p)}`,
        },
      });

      const series = chart.addSeries(LWC.BaselineSeries, {
        baseValue: { type: "price", price: history.baseValue },
        topLineColor: up,
        topFillColor1: "rgba(53, 166, 124, 0.30)",
        topFillColor2: "rgba(53, 166, 124, 0.02)",
        bottomLineColor: down,
        bottomFillColor1: "rgba(224, 88, 76, 0.02)",
        bottomFillColor2: "rgba(224, 88, 76, 0.30)",
        lineWidth: variant === "hero" ? 3 : 2,
        priceLineVisible: true,
        priceLineStyle: LWC.LineStyle.Dotted,
        priceLineColor: sec,
        lastValueVisible: true,
        crosshairMarkerRadius: 5,
        crosshairMarkerBorderColor: bg,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });

      const avg = chart.addSeries(LWC.LineSeries, {
        color: accent,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        visible: showAvg,
      });

      LWC.createTextWatermark(chart.panes()[0], {
        horzAlign: "center",
        vertAlign: "center",
        lines: [
          {
            text: watermarkText,
            color: "rgba(217, 160, 60, 0.035)",
            fontSize: variant === "hero" ? 58 : 34,
            fontStyle: "bold",
            fontFamily,
          },
        ],
      });

      const markersApi = LWC.createSeriesMarkers(series, []);

      onMove = (param: MouseEventParams<Time>) => {
        const point = param.seriesData.get(series) as
          | BaselineData<Time>
          | undefined;
        setHoverValue(
          point && typeof point.value === "number" ? point.value : null,
        );

        const hovId = param.hoveredObjectId;
        const hit =
          typeof hovId === "string" ? markerByIdRef.current.get(hovId) : undefined;
        if (hit && param.point) {
          setTooltip({
            marker: hit,
            x: param.point.x,
            y: param.point.y,
            width: containerRef.current?.clientWidth ?? 640,
          });
        } else {
          setTooltip(null);
        }
      };
      chart.subscribeCrosshairMove(onMove);

      chartRef.current = chart;
      seriesRef.current = series;
      avgRef.current = avg;
      markersRef.current = markersApi;

      applyData();
    })();

    return () => {
      disposed = true;
      if (chartRef.current && onMove) {
        chartRef.current.unsubscribeCrosshairMove(onMove);
      }
      chartRef.current?.remove();
      lwcRef.current = null;
      chartRef.current = null;
      seriesRef.current = null;
      avgRef.current = null;
      markersRef.current = null;
      rangeLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enoughData]);

  // Re-push whenever the data, the average toggle, or the markers change.
  useEffect(() => {
    applyData();
  }, [applyData]);

  if (!enoughData) {
    return (
      <div
        className="flex items-center justify-center text-[12px] text-dim"
        style={{ height: HEIGHT[variant] }}
      >
        Not enough history yet to draw the curve.
      </div>
    );
  }

  const displayValue = hoverValue ?? history.lastEquity;
  const changeUp = history.changeAbs >= 0;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {EQUITY_RANGES.map((r) => {
            const active = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => selectRange(r)}
                disabled={loading}
                aria-pressed={active}
                className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors disabled:opacity-50 ${
                  active
                    ? "bg-chipbg text-txt"
                    : "text-dim hover:bg-hoverbg hover:text-sec"
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2.5">
          <MarketChip open={marketOpen} />
          {staleError && (
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-down">
              {staleError}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowAvg((v) => !v)}
            aria-pressed={showAvg}
            className={`rounded border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${
              showAvg
                ? "border-emphline bg-chipbg text-acc"
                : "border-line text-dim hover:text-sec"
            }`}
          >
            Avg
          </button>
        </div>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          style={{ height: HEIGHT[variant] }}
          className={
            loading ? "opacity-60 transition-opacity" : "transition-opacity"
          }
        />
        <div className="pointer-events-none absolute left-2 top-2 z-20 flex flex-col gap-0.5 rounded-md border border-line bg-panel px-2 py-1 shadow-md shadow-black/30">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-dim">
            {hoverValue !== null ? "Equity" : "Equity · latest"}
          </span>
          <span
            className={`font-mono leading-none text-txt ${
              variant === "hero" ? "text-[20px]" : "text-[16px]"
            }`}
          >
            {formatUsd(displayValue)}
          </span>
          <span
            className={`font-mono text-[10px] ${changeUp ? "text-up" : "text-down"}`}
          >
            {RANGE_LABEL[history.range]} {formatSigned(history.changeAbs)}{" "}
            <span className="text-dim">({formatPct(history.changePct)})</span>
          </span>
        </div>

        {tooltip && (
          <TradeTooltip
            marker={tooltip.marker}
            x={tooltip.x}
            y={tooltip.y}
            width={tooltip.width}
          />
        )}
      </div>

      {markers.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[0.09em] text-dim">
          <span className="flex items-center gap-1">
            <span className="text-acc">▲</span> open position
          </span>
          <span className="flex items-center gap-1">
            <span>▲</span> closed entry
          </span>
          <span className="flex items-center gap-1">
            <span>▼</span> exit
          </span>
        </div>
      )}
    </div>
  );
}
