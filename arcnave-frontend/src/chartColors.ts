/**
 * Chart colours for the charts ArcNave draws itself (recharts display cards and chart blocks).
 *
 * Source: BS-Base.dc.html ".t-light/.t-dark" (--c1..--c6, --grid, --axis) and BS-PartsB
 * "Chart colours · fixed order": 1 Kulam green, 2 Marigold, 3 Sky, 4 Terracotta, 5 Jamun, 6 Neem.
 * The hex values live in brand/tokens.css as --chart-1..6 for both themes; this file only names
 * them, so a chart follows the theme without a re-render and no hex is written twice.
 *
 * Order is part of the design: series 1 is always green, series 2 marigold, and so on. The board
 * has six colours and no seventh. A chart with more series than that repeats the six in order
 * (the legend, not the colour, tells those series apart); it is better to group such data.
 *
 * Colour is identity only. Good / warning / error keep their own tokens (--color-ok, --color-warn,
 * --color-err) and are never drawn from this list.
 */
export const CHART_SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const;

/** The colour of the n-th series (0-based), in the board's fixed order. */
export const seriesColor = (index: number): string => CHART_SERIES[index % CHART_SERIES.length]!;

/** Thin grid and axis lines (BS-Base --grid / --axis). */
export const CHART_GRID = "var(--chart-grid)";
export const CHART_AXIS = "var(--chart-axis)";
/** Tick labels and axis titles. */
export const CHART_TEXT = "var(--color-muted)";

/** Bars have leaf tops: 6 px on one corner, 1.5 px on the other (BS-PartsB "Marks"). */
export const BAR_RADIUS: [number, number, number, number] = [6, 1.5, 0, 0];
/** 2 px between the bars of a group (BS-PartsB "Marks"). */
export const BAR_GAP = 2;

/** Hover card: raised surface, hairline border, 12 px corners (V2 tooltip/menu surface). */
export const CHART_TOOLTIP_STYLE = {
  background: "var(--color-raised)",
  border: "1px solid var(--color-line-strong)",
  borderRadius: 12,
  boxShadow: "var(--shadow-2)",
  color: "var(--color-text)",
  fontSize: 12,
} as const;
