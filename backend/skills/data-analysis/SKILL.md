---
name: data-analysis
version: 1.1.0
description: Tabular data exploration, cleaning, descriptive statistics, chart selection, and structured generative UI dashboards.
category: analysis
requires:
  tools:
    - run_python
autoload: false
metadata:
  source: arcnave
---

# Data Analysis & Generative Visualization

Use this skill when exploring datasets, calculating statistics, cleaning tabular data, and presenting interactive dashboards.

## Analysis Process

1. **Inspection & Validation**:
   - Work with dataset handles (`datasetHandle`) provided in the context (e.g. `ds_...`). Never ask for or expose internal storage keys.
   - Inspect shape, columns, missing values, and data types before computing aggregates.
   - Detect outliers or anomalies and note them explicitly.

2. **Descriptive Statistics**:
   - Compute distribution summaries (mean, median, standard deviation, interquartile range).
   - Use median over mean for heavily skewed data (e.g. income, latency).

3. **Visualization Selection**:
   - **Trend over time**: Line chart with clear temporal x-axis.
   - **Comparison across categories**: Horizontal or vertical bar chart with sorted bars.
   - **Part-to-whole**: Stacked bar chart or donut chart (only for <= 5 categories).
   - **Correlation / Distribution**: Scatter plot or histogram.

4. **Structured Presentation with `render_ui`**:
   - When presenting data findings, call `render_ui` to provide rich inline blocks:
     - `metric`: Key quantitative indicators with units and provenance.
     - `chart`: Visual data trends.
     - `table`: Structured numerical rows with sorting.
     - `dashboard`: Cohesive layout combining metrics and charts.
   - Always accompany visual UI blocks with concise narrative takeaways.
