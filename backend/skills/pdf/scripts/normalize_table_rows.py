# Deterministic post-processing for extract_scanned_table_rows (G24).
#
# Runs in the execution sandbox with no network. Receives the per-page table rows a vision
# model returned and produces one ordered, indexed row array. Nothing here guesses: a row is
# never dropped for looking odd, only an exact repeat of the header row on a later page is
# removed, and every removal is reported.
#
# input_data: {"pages": [{"page": int, "status": "ok"|"failed", "warnings": [str],
#               "tables": [{"rows": [{"cells": [str], "confidence": float, "isHeader": bool,
#                                     "sourceRegion": {...}|null}]}]}],
#              "lowConfidenceThreshold": float}
# writes OUTPUT_PATH: see the dict built at the end.

import re

_WS = re.compile(r"\s+")


def _norm_cell(value):
    if value is None:
        return ""
    return _WS.sub(" ", str(value)).strip()


def _key(cells):
    return tuple(c.lower() for c in cells)


threshold = float(input_data.get("lowConfidenceThreshold", 0.8))
pages_in = sorted(input_data.get("pages", []), key=lambda p: int(p["page"]))

header = None
header_key = None
rows = []
headers_seen = []
dropped_header_repeats = []
page_summaries = []
low_confidence = []
max_cols = 0

for page in pages_in:
    page_no = int(page["page"])
    warnings = [str(w) for w in page.get("warnings", [])]
    tables = page.get("tables", [])
    page_rows = 0
    for t_index, table in enumerate(tables):
        for raw in table.get("rows", []):
            cells = [_norm_cell(c) for c in raw.get("cells", [])]
            if not any(cells):
                continue
            confidence = float(raw.get("confidence", 0.0))
            region = raw.get("sourceRegion")
            if raw.get("isHeader"):
                k = _key(cells)
                if header is None:
                    header, header_key = cells, k
                    headers_seen.append({"page": page_no, "cells": cells})
                elif k == header_key:
                    dropped_header_repeats.append({"page": page_no, "cells": cells})
                else:
                    headers_seen.append({"page": page_no, "cells": cells})
                continue
            page_rows += 1
            row = {
                "page": page_no,
                "rowIndex": len(rows) + 1,
                "pageRowIndex": page_rows,
                "tableIndex": t_index,
                "cells": cells,
                "confidence": confidence,
            }
            if region:
                row["sourceRegion"] = region
            if raw.get("rechecked"):
                row["rechecked"] = True
            max_cols = max(max_cols, len(cells))
            rows.append(row)
            if confidence < threshold:
                low_confidence.append(row)
    page_summaries.append(
        {
            "page": page_no,
            "status": page.get("status", "ok"),
            "tableCount": len(tables),
            "rowCount": page_rows,
            "warnings": warnings,
        }
    )

# A data row identical to the last row of the previous page is flagged, never removed: it may
# be a genuine repeat (two equal transactions) or a carry-over. The model decides.
possible_duplicates = []
for i in range(1, len(rows)):
    a, b = rows[i - 1], rows[i]
    if a["page"] != b["page"] and _key(a["cells"]) == _key(b["cells"]):
        possible_duplicates.append({"page": b["page"], "rowIndex": b["rowIndex"], "sameAs": a["rowIndex"]})

ragged = [
    {"page": r["page"], "rowIndex": r["rowIndex"], "cellCount": len(r["cells"])}
    for r in rows
    if len(r["cells"]) != max_cols
]

result = {
    "header": header,
    "headersSeen": headers_seen,
    "droppedHeaderRepeats": dropped_header_repeats,
    "rows": rows,
    "totalRows": len(rows),
    "columnCount": max_cols,
    "pages": page_summaries,
    "failedPages": [p["page"] for p in page_summaries if p["status"] != "ok"],
    "lowConfidenceRows": [
        {"page": r["page"], "rowIndex": r["rowIndex"], "confidence": r["confidence"], "cells": r["cells"]}
        for r in low_confidence
    ],
    "possibleDuplicates": possible_duplicates,
    "raggedRows": ragged,
}

with open(OUTPUT_PATH, "w") as _out:
    json.dump(result, _out)
