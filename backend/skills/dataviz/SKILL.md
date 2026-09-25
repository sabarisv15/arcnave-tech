---
name: dataviz
description: Chooses and draws clear charts with matplotlib in run_python. Use when the user asks for a chart, graph or plot, or when numbers are easier to understand as a picture.
version: 1.1.0
category: analysis
scope: project
autoload: false
requires:
  tools:
    - run_python
  capabilities:
    - python.execute
---

# Data Visualization Standards

Apply these guidelines when transforming datasets into charts, summaries, or visual deliverables.

## 1. Choosing the Right Chart

- **Trends over Time**: Line charts (`plt.plot`).
- **Category Comparisons**: Bar charts (`plt.bar` or `plt.barh`).
- **Distributions**: Histograms (`plt.hist`) or box plots (`plt.boxplot`).
- **Correlations**: Scatter plots with regression trendlines (`plt.scatter`).
- **Composition / Proportions**: Stacked bar or donut charts (avoid 3D pie charts).

## 2. Python Matplotlib / Seaborn Patterns

When generating plots via `run_python`:
- Use clean modern styles (`plt.style.use('seaborn-v0_8-whitegrid')` or minimal formatting).
- Always include clear axis labels, descriptive titles, and legends.
- Set appropriate figure dpi (e.g. `plt.figure(figsize=(10, 6), dpi=150)`).
- Save the chart as PNG (`plt.savefig(..., bbox_inches="tight")`):
  - to `output/` to give it to the user as a file;
  - to `view/` to look at it yourself and check labels, scale and overlaps before sending it.
- For a chart inside the chat instead of a file, use `render_ui` (see `dashboard-design`).
- Do not print base64 image data: it fills the output and is not shown as an image.
