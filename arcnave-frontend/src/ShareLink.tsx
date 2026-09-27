import { useEffect, useState } from "react";
import { Copy, Globe, Link2, Loader2, Lock } from "lucide-react";
import { api, ApiError, type ShareLinkDto } from "./api";
import { useWorkspace } from "./workspace";

/**
 * The public link of a chat or an artifact (ADR-0039): create it, copy it, move its snapshot to
 * now, or turn it off.
 */
export function PublicLink({ target }: { target: { type: "chat" | "artifact"; id: string } }) {
  const { toast } = useWorkspace();
  const [link, setLink] = useState<ShareLinkDto | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.share
      .list({ targetType: target.type, targetId: target.id })
      .then((r) => live && setLink(r.items[0] ?? null))
      .catch(() => live && setLink(null));
    return () => {
      live = false;
    };
  }, [target.type, target.id]);

  const url = link ? `${window.location.origin}${link.path}` : "";
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      toast(error instanceof ApiError ? error.detail : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const share = () =>
    run(async () => {
      const made = target.type === "chat" ? await api.share.chat(target.id) : await api.share.artifact(target.id);
      const fresh = !link;
      setLink(made);
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${made.path}`);
        toast(fresh ? "Public link created and copied" : "Link updated and copied");
      } catch {
        toast(fresh ? "Public link created" : "Link updated");
      }
    });

  if (link === undefined)
    return (
      <p className="loading-line">
        <Loader2 size={14} className="spin" /> Checking sharing…
      </p>
    );
  if (!link)
    return (
      <div className="public-link">
        <p className="public-link-state">
          <Lock size={15} /> Only you can see this {target.type === "chat" ? "conversation" : "artifact"}.
        </p>
        <button className="button primary" disabled={busy} onClick={() => void share()}>
          <Link2 size={16} /> Create public link
        </button>
      </div>
    );
  return (
    <div className="public-link">
      <p className="public-link-state">
        <Globe size={15} /> Anyone with the link can view it, as of{" "}
        {link.snapshotAt ? new Date(link.snapshotAt).toLocaleString() : "now"}.
      </p>
      <div className="public-link-row">
        <input className="input" readOnly value={url} aria-label="Public link" onFocus={(e) => e.currentTarget.select()} />
        <button
          className="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast("Link copied");
            } catch {
              toast("Clipboard unavailable. Select the link and copy it.");
            }
          }}
        >
          <Copy size={15} /> Copy
        </button>
      </div>
      <div className="public-link-row">
        <button className="button" disabled={busy} onClick={() => void share()}>
          Update to now
        </button>
        <button
          className="button danger"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.share.revoke(link.id);
              setLink(null);
              toast("Link turned off");
            })
          }
        >
          Stop sharing
        </button>
      </div>
    </div>
  );
}
