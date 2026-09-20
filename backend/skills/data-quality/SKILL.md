---
name: data-quality
version: 1.0.0
description: Automated tabular data quality auditing, missing value profiling, outlier detection, and data hygiene recommendations.
category: analysis
requires:
  tools:
    - render_ui
autoload: false
metadata:
  source: arcnave
---

# Data Quality Auditing & Hygiene

Use this skill when evaluating datasets for completeness, anomalies, invalid entries, or statistical outliers.

## Quality Dimensions

1. **Completeness**:
   - Track missing values per column (`nullPct`).
   - Categorize severity: `<10%` (low), `10-50%` (moderate), `>50%` (high/critical).
   - Recommend imputation strategies (median for numeric skewed, mode for categorical) or dropping uninformative columns.

2. **Uniqueness**:
   - Detect duplicate rows and near-duplicate entity records.
   - Verify primary key / natural key uniqueness.

3. **Validity & Outlier Detection**:
   - Apply Tukey's fences ($Q_1 - 1.5 \times \text{IQR}$, $Q_3 + 1.5 \times \text{IQR}$).
   - Distinguish valid tail events from data entry errors (e.g. negative ages, dates in the future).

4. **Consistency**:
   - Check format consistency across string dates, casing, and units of measurement.

## Output Structure

When presenting quality findings, utilize `render_ui` with:
- **Metric cards**: Total rows, columns, quality score (0-100), duplicate count.
- **Table block**: Per-column null percentages and distinct value counts.
- **Text block**: Bulleted actionable recommendations.
