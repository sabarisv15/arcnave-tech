---
name: data-analysis
version: 2.0.0
description: Explores, cleans and summarises tabular data with statistics and charts. Use when the user asks to analyse a dataset, CSV or table, find trends, compare groups, or present findings as metrics, charts or a dashboard.
category: analysis
requires:
  tools:
    - run_python
autoload: false
metadata:
  source: arcnave
---

# Data Analysis & Visualization

Use this skill when exploring datasets, calculating statistics, cleaning tabular data, and
presenting findings.

## Analysis Process

1. **Load and inspect** in `run_python`: the file is in `input/` (its `run_python path` is on
   its attachment line). Check shape, columns, types and missing values before computing
   anything. For an Excel or CSV file, also load the `xlsx` skill.
2. **Clean deliberately**: say what you dropped, filled or converted, and how many rows it
   touched. Save the cleaned table to a file and reuse it in later calls.
3. **Describe**: mean, median, standard deviation, interquartile range. Prefer the median for
   skewed data (income, latency). Name outliers and anomalies explicitly.
4. **Compute every figure in code**, never by reading numbers off a table in context.
5. **Choose the chart**:
   - Trend over time: line chart with a time x-axis.
   - Comparison across categories: bar chart, sorted.
   - Part-to-whole: stacked bar, or donut for 5 categories or fewer.
   - Relationship or distribution: scatter plot or histogram.
6. **Present**:
   - In the chat: `render_ui` with `metric`, `chart`, `table` or `dashboard` blocks, built from
     the numbers the code printed. See the `dashboard-design` skill for layout.
   - As a file: a chart image or workbook saved to `output/` (see the `dataviz` and `xlsx` skills).
   - Always add a short narrative of what the numbers mean.
