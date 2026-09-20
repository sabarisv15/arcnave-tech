---
name: data-analysis
version: 1.0.0
description: Tabular data exploration, cleaning, descriptive statistics, chart selection, and visualization best practices.
category: analysis
requires:
  tools:
    - run_python
autoload: false
metadata:
  source: arcnave
---

# Data Analysis & Visualization Best Practices

Use this skill when exploring datasets, calculating statistics, cleaning tabular data, and creating analytical charts.

## Analysis Process

1. **Inspection & Validation**:
   - Inspect shape, columns, missing values, and data types before computing aggregates.
   - Detect outliers or anomalies and note them explicitly.
2. **Descriptive Statistics**:
   - Compute distribution summaries (mean, median, standard deviation, interquartile range).
   - Use median over mean for heavily skewed data (e.g. income, latency).
3. **Visualization Selection**:
   - **Trend over time**: Line chart with clear temporal x-axis.
   - **Comparison across categories**: Horizontal or vertical bar chart with sorted bars.
   - **Part-to-whole**: Stacked bar chart or donut chart (only for <= 5 categories).
   - **Correlation / Distribution**: Scatter plot or histogram / box plot.
4. **Interpretation & Actionable Insights**:
   - Never just output numbers or plots without explaining what the data indicates and why it matters to the user's objective.

## Capability & Output Guidance

- **When `run_python` tool is available**: Execute Python scripts in the sandbox to process data and compute exact aggregations.
- **When in `guidance_only` mode**: Provide the structured analysis plan, statistical formulas, and expected data transformation logic.
