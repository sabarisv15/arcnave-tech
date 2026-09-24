# Deterministic counting, summing and reconciliation over extracted table rows (G24).
#
# Nothing is truncated: every matching row, unparsed cell and mismatch is returned, because an
# exact answer cannot rest on a list that was cut short.
#
# Generic: the model maps columns to meaning (which column is a debit, a balance, a party
# name) and this script only computes. Every count and total comes from the row array, never
# from a model's reading of the page.
#
# input_data: {"rows": [{"page", "rowIndex", "cells": [str], ...}],
#              "operations": [op, ...]}
# op:  {"op": "count", "name", "where"?: [filter], "expected"?: number}
#      {"op": "sum", "name", "column": int, "where"?: [filter], "expected"?: number}
#      {"op": "classify", "name", "where"?: [filter], "rules": [{"label", "reason", "where": [filter], "capture"?}],
#       "default"?: "UNKNOWN", "capture"?: {"column": int, "pattern": regex with one group}}
#      {"op": "running_balance", "name", "balanceColumn": int,
#       "increaseColumn"?: int, "decreaseColumn"?: int, "tolerance"?: number, "where"?: [filter]}
# filter: {"column": int, "test": "nonEmpty"|"empty"|"numeric"|"matches"|"notMatches"|"equals",
#          "value"?: str}   (a where-list is AND; "matches" is a case-insensitive regex)
#         or {"pageFrom"?: int, "pageTo"?: int} to select rows by page

import re
from decimal import Decimal, InvalidOperation

_NUM_CLEAN = re.compile(r"[^0-9.\-]")


def parse_number(text):
    """Returns a Decimal or None. Handles 1,234.50  (1,234.50)  1,234.50 Dr  -1234  ₹1,234."""
    if text is None:
        return None
    s = str(text).strip()
    if not s:
        return None
    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative, s = True, s[1:-1]
    low = s.lower()
    if low.endswith("dr"):
        negative, s = True, s[:-2]
    elif low.endswith("cr"):
        s = s[:-2]
    s = _NUM_CLEAN.sub("", s)
    if s.count("-") > 1 or (s.count("-") == 1 and not s.startswith("-")):
        return None
    if s in ("", "-", ".", "-."):
        return None
    try:
        value = Decimal(s)
    except InvalidOperation:
        return None
    return -value if negative else value


def cell(row, column):
    cells = row.get("cells", [])
    return cells[column] if 0 <= column < len(cells) else ""


def passes(row, flt):
    if "column" not in flt:
        # A page-range filter, for documents that hold more than one table (two statements).
        page = row.get("page") or 0
        return int(flt.get("pageFrom", page)) <= page <= int(flt.get("pageTo", page))
    value = cell(row, int(flt["column"]))
    test = flt.get("test", "nonEmpty")
    if test == "nonEmpty":
        return value.strip() != ""
    if test == "empty":
        return value.strip() == ""
    if test == "numeric":
        return parse_number(value) is not None
    if test == "equals":
        return value.strip().lower() == str(flt.get("value", "")).strip().lower()
    if test in ("matches", "notMatches"):
        hit = re.search(str(flt.get("value", "")), value, re.IGNORECASE) is not None
        return hit if test == "matches" else not hit
    raise ValueError("unknown filter test: %s" % test)


def select(rows, where):
    return [r for r in rows if all(passes(r, f) for f in (where or []))]


def ref(row):
    return {"page": row.get("page"), "rowIndex": row.get("rowIndex")}


def with_expectation(res, actual, op):
    if "expected" in op and op["expected"] is not None:
        expected = Decimal(str(op["expected"]))
        diff = Decimal(str(actual)) - expected
        res["expected"] = str(expected) if not isinstance(actual, int) else int(expected)
        res["difference"] = str(diff) if not isinstance(actual, int) else int(diff)
        res["status"] = "pass" if diff == 0 else "fail"
    else:
        res["status"] = "computed"
    return res


rows = input_data.get("rows", [])
results = []
suspicious_pages = set()

for op in input_data.get("operations", []):
    kind = op.get("op")
    name = op.get("name", kind)
    try:
        if kind == "count":
            hit = select(rows, op.get("where"))
            res = {"name": name, "op": kind, "value": len(hit), "rows": [ref(r) for r in hit]}
            results.append(with_expectation(res, len(hit), op))
        elif kind == "sum":
            col = int(op["column"])
            total = Decimal("0")
            unparsed = []
            for r in select(rows, op.get("where")):
                raw = cell(r, col)
                n = parse_number(raw)
                if n is None:
                    if raw.strip():
                        unparsed.append({**ref(r), "cell": raw})
                    continue
                total += n
            res = {"name": name, "op": kind, "value": str(total), "unparsedCells": unparsed}
            if unparsed:
                suspicious_pages.update(u["page"] for u in unparsed)
            results.append(with_expectation(res, total, op))
        elif kind == "classify":
            # Every selected row gets exactly one label: the first rule whose filters all hold,
            # else the default. Counts are computed here and must add up to the total.
            selected = select(rows, op.get("where"))
            rules = op.get("rules", [])
            default = op.get("default", "UNKNOWN")
            capture = op.get("capture")
            counts = {r["label"]: 0 for r in rules}
            counts.setdefault(default, 0)
            labelled = []
            for r in selected:
                label, reason = default, op.get("defaultReason", "no rule matched")
                rule_capture = None
                for rule in rules:
                    if all(passes(r, f) for f in rule.get("where", [])):
                        label, reason = rule["label"], rule.get("reason", rule["label"])
                        rule_capture = rule.get("capture")
                        break
                counts[label] = counts.get(label, 0) + 1
                entry = {**ref(r), "label": label, "reason": reason, "cells": r.get("cells", [])}
                # A rule's own capture wins: different narration formats name the party differently.
                cap = rule_capture or (capture if label != default else None)
                if cap:
                    m = re.search(str(cap["pattern"]), cell(r, int(cap["column"])), re.IGNORECASE)
                    entry["value"] = (m.group(1) if m and m.groups() else (m.group(0) if m else None))
                labelled.append(entry)
            total = len(selected)
            results.append(
                {
                    "name": name,
                    "op": kind,
                    "total": total,
                    "counts": counts,
                    "countsAddUp": sum(counts.values()) == total,
                    "rows": labelled,
                    "status": "computed" if sum(counts.values()) == total else "error",
                }
            )
        elif kind == "running_balance":
            bal_col = int(op["balanceColumn"])
            inc_col = op.get("increaseColumn")
            dec_col = op.get("decreaseColumn")
            tol = Decimal(str(op.get("tolerance", "0")))
            mismatches = []
            checked = 0
            prev = None
            for r in select(rows, op.get("where")):
                bal = parse_number(cell(r, bal_col))
                if bal is None:
                    continue
                if prev is not None:
                    inc = parse_number(cell(r, int(inc_col))) if inc_col is not None else None
                    dec = parse_number(cell(r, int(dec_col))) if dec_col is not None else None
                    expected_bal = prev[1] + (inc or 0) - (abs(dec) if dec is not None else 0)
                    checked += 1
                    if abs(expected_bal - bal) > tol:
                        mismatches.append(
                            {
                                **ref(r),
                                "previousRowIndex": prev[0].get("rowIndex"),
                                "expectedBalance": str(expected_bal),
                                "actualBalance": str(bal),
                                "difference": str(bal - expected_bal),
                            }
                        )
                        # A misread balance breaks its own transition and the next one, a
                        # misread amount only its own, so the rows at mismatches always include
                        # the misread one.
                        suspicious_pages.add(r.get("page"))
                prev = (r, bal)
            results.append(
                {
                    "name": name,
                    "op": kind,
                    "checkedTransitions": checked,
                    "mismatches": mismatches,
                    "mismatchCount": len(mismatches),
                    "status": "pass" if not mismatches and checked > 0 else ("fail" if mismatches else "not_checked"),
                }
            )
        else:
            results.append({"name": name, "op": kind, "status": "error", "error": "unknown op"})
    except (KeyError, ValueError, re.error) as err:
        results.append({"name": name, "op": kind, "status": "error", "error": str(err)})

failed = [r for r in results if r.get("status") in ("fail", "error")]
result = {
    "rowCount": len(rows),
    "results": results,
    "allPassed": not failed and any(r.get("status") == "pass" for r in results),
    "failed": [r["name"] for r in failed],
    "suspiciousPages": sorted(p for p in suspicious_pages if p is not None),
}

with open(OUTPUT_PATH, "w") as _out:
    json.dump(result, _out)
