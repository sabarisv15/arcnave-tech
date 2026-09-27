/**
 * Office previews for the file panel (WP-11): Word and PowerPoint drawn in a frame with scripts
 * off, Excel as sheet tabs over a grid of the server's typed cells.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError, describeError, type SheetPreviewCellDto, type SheetPreviewDto } from "./api";
import { OFFICE_FRAME_CSS, renderDocx, renderPptx, type OfficeKind } from "./officePreview";

/**
 * `allow-same-origin` without `allow-scripts`: this page can draw into the frame's document,
 * and nothing in the file (a `javascript:` link, an inline handler) can run there.
 */
export function OfficeFrame({ kind, bytes, name }: { kind: OfficeKind; bytes: ArrayBuffer; name: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"drawing" | "ready" | "failed">("drawing");

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let live = true;
    setState("drawing");
    const draw = () => {
      const doc = el.contentDocument;
      if (!doc) return;
      doc.open();
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${OFFICE_FRAME_CSS}</style></head><body></body></html>`);
      doc.close();
      const render = kind === "docx" ? renderDocx : renderPptx;
      render(bytes.slice(0), doc.body)
        .then(() => live && setState("ready"))
        .catch(() => live && setState("failed"));
    };
    if (el.contentDocument?.readyState === "complete") draw();
    else el.addEventListener("load", draw, { once: true });
    return () => {
      live = false;
      el.removeEventListener("load", draw);
    };
  }, [kind, bytes]);

  return (
    <div className="office-preview">
      {state === "drawing" && (
        <div className="loading-line office-preview-status">
          <Loader2 className="spin" size={16} /> Drawing preview…
        </div>
      )}
      {state === "failed" && (
        <p className="office-preview-status field-help">
          This file could not be drawn here. Download it to open it in its own application.
        </p>
      )}
      <iframe
        ref={frame}
        title={`Preview ${name}`}
        sandbox="allow-same-origin"
        className={state === "failed" ? "is-hidden" : ""}
      />
    </div>
  );
}

const columnName = (index: number): string => {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

/** A cell as a spreadsheet would show it, for the formats that cover most workbooks. */
export function formatCell(cell: SheetPreviewCellDto): string {
  if (cell.value === null) return "";
  if (cell.type === "boolean") return cell.value ? "TRUE" : "FALSE";
  if (cell.type === "date" && typeof cell.value === "string") {
    const d = new Date(cell.value);
    if (Number.isNaN(d.getTime())) return cell.value;
    const hasTime = d.getUTCHours() || d.getUTCMinutes();
    return hasTime ? d.toISOString().slice(0, 16).replace("T", " ") : d.toISOString().slice(0, 10);
  }
  if (cell.type === "number" && typeof cell.value === "number") {
    const fmt = cell.numFmt ?? "";
    const decimals = /0\.(0+)/.exec(fmt)?.[1]?.length;
    if (fmt.includes("%")) return `${(cell.value * 100).toFixed(decimals ?? 0)}%`;
    const grouped = fmt.includes("#,##0") || fmt.includes(",");
    return cell.value.toLocaleString("en-IN", {
      useGrouping: grouped,
      minimumFractionDigits: decimals ?? 0,
      maximumFractionDigits: decimals ?? 10,
    });
  }
  return String(cell.value);
}

export function SheetPreview({ fileId }: { fileId: string }) {
  const [data, setData] = useState<SheetPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    api.files
      .preview(fileId, controller.signal)
      .then((d) => {
        setData(d);
        setActive(0);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        // The server's detail says why (too large, unreadable); the code alone would not.
        setError(e instanceof ApiError ? e.detail || describeError(e.code).detail : describeError(null).detail);
      });
    return () => controller.abort();
  }, [fileId]);

  if (error) return <p className="field-help office-preview-status">{error}</p>;
  if (!data)
    return (
      <div className="loading-line office-preview-status">
        <Loader2 className="spin" size={16} /> Reading workbook…
      </div>
    );
  const sheet = data.sheets[active];
  if (!sheet) return <p className="field-help office-preview-status">This workbook has no sheets.</p>;
  const width = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);

  return (
    <div className="sheet-preview">
      <div className="sheet-grid" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th className="sheet-corner" />
              {Array.from({ length: width }, (_, c) => (
                <th key={c}>{columnName(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                <th>{r + 1}</th>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cell.type === "number" ? "num" : cell.type === "error" ? "err" : undefined}
                    title={cell.formula ? `=${cell.formula}` : undefined}
                  >
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(sheet.truncatedRows || sheet.truncatedColumns) && (
        <p className="field-help sheet-note">
          Showing {sheet.rows.length} of {sheet.rowCount} rows and {width} of {sheet.columnCount} columns.
          Download the file for all of it.
        </p>
      )}
      {data.sheets.length > 1 && (
        <div className="sheet-tabs" role="tablist" aria-label="Sheets">
          {data.sheets.map((s, i) => (
            <button
              key={s.name}
              role="tab"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onClick={() => setActive(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
