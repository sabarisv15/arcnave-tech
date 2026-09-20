---
name: dataviz
description: Best practices for data visualization, statistical plots, and charts using Python sandbox and vector visuals.
version: 1.0.0
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
- When encoding charts for direct viewing, render to PNG and output base64 data URIs or summary statistics.
