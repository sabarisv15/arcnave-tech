/**
 * A shared snapshot, opened by its link without an account (ADR-0039). Read only: the page shows
 * what the server's public payload holds and offers nothing that would act for the owner.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Link2, Loader2 } from "lucide-react";
import { api, ApiError, describeError, type PublicShareDto, type SharedArtifactDto } from "./api";
import { Markdown, MarkdownErrorBoundary } from "./Content";
import { GenerativeUIRenderer } from "./generative-ui/GenerativeUIRenderer";
import { SandboxFrame } from "./SandboxFrame";
import { applyTheme } from "./session";
import type { UIBlock } from "./generative-ui/types";
import type { Source } from "./types";
import { BrandMark } from "./ui";
import { ReadOnlyWorkspace } from "./workspace";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";

function SharedArtifact({ artifact }: { artifact: SharedArtifactDto }) {
  const body =
    artifact.kind === "webpage" || artifact.kind === "svg" ? (
      <SandboxFrame html={artifact.content} title={artifact.title} layout="page" autoHeight />
    ) : artifact.kind === "code" ? (
      <Markdown text={"```\n" + artifact.content + "\n```"} />
    ) : (
      <Markdown text={artifact.content} />
    );
  return (
    <section className="shared-artifact" aria-label={artifact.title}>
      <header>{artifact.title}</header>
      <div className="shared-artifact-body">{body}</div>
    </section>
  );
}

export default function SharedPage() {
  const { token = "" } = useParams();
  const [data, setData] = useState<PublicShareDto | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [toastText, setToastText] = useState("");
  const toast = useCallback((text: string) => {
    setToastText(text);
    setTimeout(() => setToastText(""), 2500);
  }, []);

  useEffect(() => {
    applyTheme("system");
    // Also sent as a header by the API; the page itself must say it too.
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.append(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    api.share
      .read(token)
      .then((d) => {
        setData(d);
        document.title = `${d.title} · ArcNave`;
      })
      .catch((e) => setError(e instanceof ApiError ? { title: e.title, detail: e.detail } : describeError(null)));
  }, [token]);

  return (
    <ReadOnlyWorkspace toast={toast}>
      <div className="shared-page">
        <header className="shared-top">
          <Link to="/" className="shared-brand">
            <BrandMark />
            <span>ArcNave</span>
          </Link>
          <Link to="/" className="button">
            Start your own
          </Link>
        </header>
        <main className="shared-main">
          {error ? (
            <div className="shared-missing">
              <Link2 size={22} />
              <h1>{error.title}</h1>
              <p>{error.detail}</p>
            </div>
          ) : !data ? (
            <p className="loading-line">
              <Loader2 size={16} className="spin" /> Opening shared page…
            </p>
          ) : (
            <>
              <div className="shared-banner" role="note">
                {data.type === "chat"
                  ? `A shared snapshot of a conversation, as of ${when(data.sharedAt)}. Files attached to it are not included.`
                  : `A shared copy of an artifact, as of ${when(data.sharedAt)}.`}
              </div>
              <h1 className="shared-title">{data.title}</h1>
              {data.type === "artifact" ? (
                <SharedArtifact artifact={data.artifact} />
              ) : (
                <div className="messages shared-messages">
                  {data.messages.map((m, i) =>
                    m.role === "user" ? (
                      <div key={i} className="user-message">
                        <div className="user-bubble">
                          <p>{m.text}</p>
                        </div>
                      </div>
                    ) : (
                      <article key={i} className="assistant-message" aria-label="ArcNave response">
                        <MarkdownErrorBoundary fallbackText={m.text}>
                          <Suspense fallback={<p className="markdown">{m.text}</p>}>
                            <Markdown
                              text={m.text}
                              sources={m.sources.map(
                                (s): Source => ({ ...s, type: "Web", snippet: "" }),
                              )}
                            />
                          </Suspense>
                        </MarkdownErrorBoundary>
                        {m.uiBlocks.length > 0 && <GenerativeUIRenderer blocks={m.uiBlocks as UIBlock[]} />}
                        {m.artifact && <SharedArtifact artifact={m.artifact} />}
                      </article>
                    ),
                  )}
                </div>
              )}
            </>
          )}
        </main>
        {toastText && (
          <div className="toast" role="status">
            {toastText}
          </div>
        )}
      </div>
    </ReadOnlyWorkspace>
  );
}
