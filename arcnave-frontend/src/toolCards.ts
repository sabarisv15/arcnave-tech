/** The download and image cards a turn's tool results produce. */
import type { ToolCall } from "./types";

export interface DeliverableData {
  attachmentId: string;
  filename: string;
  format: string;
  mimeType: string;
  downloadUrl: string;
  sizeBytes: number;
  title?: string;
  artifactId?: string;
}

export interface ImageData {
  attachmentId: string;
  filename: string;
  mimeType: string;
  downloadUrl: string;
  prompt?: string;
  aspectRatio?: string;
}

/** An image image_search found on the web: shown from its own site, linked to its page. */
export interface WebImageData {
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
}

const httpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

export function extractToolCardData(calls: ToolCall[]): {
  deliverables: DeliverableData[];
  images: ImageData[];
  webImages: WebImageData[];
} {
  const deliverables: DeliverableData[] = [];
  const images: ImageData[] = [];
  const webImages: WebImageData[] = [];

  for (const c of calls) {
    if (c.ok && c.content) {
      for (const block of c.content) {
        if (block.type === "json" && block.data) {
          const data = block.data as Record<string, any>;
          // generate_deliverable and generate_image were removed (ADR-0046); their calls stay in
          // messages saved before, and those files must still download.
          if (c.name === "image_search" && Array.isArray(data.images)) {
            for (const img of data.images as Record<string, unknown>[]) {
              // Only web addresses reach an <img> or a link: a result is data from outside.
              if (!httpUrl(img.imageUrl) || !httpUrl(img.thumbnailUrl)) continue;
              webImages.push({
                title: typeof img.title === "string" ? img.title : "",
                imageUrl: img.imageUrl,
                thumbnailUrl: img.thumbnailUrl,
                sourceUrl: httpUrl(img.sourceUrl) ? img.sourceUrl : img.imageUrl,
              });
            }
          } else if (c.name === "generate_deliverable" && data.downloadUrl && data.filename) {
            deliverables.push(data as DeliverableData);
          } else if (c.name === "generate_image" && data.downloadUrl) {
            images.push(data as ImageData);
          } else {
            // Files a tool gave the user (present_files, or the older run_python's output/, a merged PDF, an edited
            // workbook) get the same card, so the answer text need not repeat their links.
            const files: unknown[] = [
              ...(Array.isArray(data.persistedFiles) ? data.persistedFiles : []),
              ...(Array.isArray(data.files) ? data.files : []),
              ...(data.file ? [data.file] : []),
            ];
            for (const f of files) {
              const file = f as Record<string, any>;
              if (typeof file?.downloadUrl !== "string" || typeof file?.filename !== "string") continue;
              const ext = file.filename.includes(".") ? file.filename.split(".").pop()! : "file";
              deliverables.push({
                attachmentId: String(file.attachmentId ?? file.id ?? file.downloadUrl),
                filename: file.filename,
                format: ext,
                mimeType: String(file.mimeType ?? ""),
                downloadUrl: file.downloadUrl,
                sizeBytes: Number(file.sizeBytes ?? 0),
              });
            }
          }
        }
      }
    }
  }

  // A file saved again later in the turn (a rerun that rewrote output/Masters.xml) replaces its
  // earlier card: the user wants the final file once, not every version the turn went through.
  const latest = new Map<string, DeliverableData>();
  for (const d of deliverables) {
    latest.delete(d.filename);
    latest.set(d.filename, d);
  }
  return { deliverables: [...latest.values()], images, webImages };
}
