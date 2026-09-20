---
name: dashboard-design
version: 1.0.0
description: Principles for composing clean, responsive, high-signal generative UI dashboards and interactive multi-card layouts.
category: presentation
requires:
  tools:
    - render_ui
autoload: false
metadata:
  source: arcnave
---

# Generative Dashboard Design

Use this skill when composing multi-metric, multi-chart dashboards using the `render_ui` tool.

## Visual Hierarchy & Layout Rules

1. **Top-Level KPI Strip**:
   - Place 2 to 4 high-level `metric` cards at the top of the dashboard.
   - Include direction, unit, and provenance reference (`analysisResultId`).

2. **Core Visualization**:
   - Pair KPI cards with 1 or 2 high-impact charts (`bar`, `line`, or `area`).
   - Use `layout: "2col"` or `"grid"` for balanced presentation.
   - Ensure charts have explicit axes, clean titles, and accessible fallback tables (`showTableToggle: true`).

3. **Detailed Breakdown**:
   - Follow with a structured `table` block containing sortable, paginated data.
   - Format numbers cleanly (`currency`, `percentage`, `number`).

4. **Client-Side Filters vs Transformations**:
   - Use `filters` on `dashboard` blocks for non-destructive, client-side exploration (e.g. category drop-downs, date filters).
   - If the user explicitly asks to permanently transform, filter, or recompute the underlying dataset, execute the transformation to create dataset Version $V(N+1)$.

5. **Size & Block Limits**:
   - Maximum 12 blocks per response.
   - Maximum 500 rows per table, 200 data points per chart series.
   - Strictly flat child blocks inside a dashboard (no nested dashboards).
