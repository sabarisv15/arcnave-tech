import { useEffect, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { api, ApiError, type ShareLinkDto } from "./api";
import { useWorkspace } from "./workspace";
import { Icon } from "./brand";

/**
 * The public link of a chat or an artifact (ADR-0039): create it, copy it, move its snapshot to
 * now, or turn it off.
 *
 * Drawn as the share dialog of BS-PartsA "Artifact actions": two radio options, then the link and
 * Copy link. The board's third option, "People in <college>", needs company-only links, which the
 * backend does not have, so it is not drawn.
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
  const stop = (current: ShareLinkDto) =>
    run(async () => {
      await api.share.revoke(current.id);
      setLink(null);
      toast("Link turned off");
    });

  if (link === undefined)
    return (
      <p className="loading-line">
        <Loader2 size={14} className="spin" /> Checking sharing…
      </p>
    );
  const noun = target.type === "chat" ? "conversation" : "artifact";
  return (
    <div className="sf-share">
      <div className="sf-opts" role="radiogroup" aria-label="Who can see this">
        <button
          type="button"
          role="radio"
          aria-checked={Boolean(link)}
          className={`sf-opt ${link ? "on" : ""}`}
          disabled={busy}
          onClick={() => {
            if (!link) void share();
          }}
        >
          <span className="sf-radio" aria-hidden="true" />
          <span className="sf-opt-text">
            <b>Anyone with the link</b>
            <small>
              {link
                ? `Can view it, as of ${link.snapshotAt ? new Date(link.snapshotAt).toLocaleString() : "now"}`
                : `Creates a link to a snapshot of this ${noun}`}
            </small>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!link}
          className={`sf-opt ${link ? "" : "on"}`}
          disabled={busy}
          onClick={() => {
            if (link) void stop(link);
          }}
        >
          <span className="sf-radio" aria-hidden="true" />
          <span className="sf-opt-text">
            <b>Only me</b>
            <small>{link ? "Turns the link off" : `Only you can see this ${noun}`}</small>
          </span>
        </button>
      </div>
      {link && (
        <>
          <div className="sf-linkrow">
            <label className="sf-field sf-field-mono">
              <Icon icon={Link2} size={16} />
              <input readOnly value={url} aria-label="Public link" onFocus={(e) => e.currentTarget.select()} />
            </label>
            <button
              type="button"
              className="sf-pbtn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  toast("Link copied");
                } catch {
                  toast("Clipboard unavailable. Select the link and copy it.");
                }
              }}
            >
              Copy link
            </button>
          </div>
          <div className="sf-share-foot">
            <span>The link shows the {noun} as of the time above. Later changes stay private until you update it.</span>
            <button type="button" className="sf-gbtn sf-gbtn-sm" disabled={busy} onClick={() => void share()}>
              Update to now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
