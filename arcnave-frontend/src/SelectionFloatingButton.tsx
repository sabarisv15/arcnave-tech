import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUp, MessageCircle, Pencil } from "lucide-react";
import { useWorkspace } from "./workspace";
import {
  buildArtifactChangePrompt,
  formatQuote,
  getSelectionCoordinates,
  getSurroundingContextFromSelection,
  isSelectionInsideArtifactPreview,
  isSelectionInsideAssistant,
} from "./selection";

interface SelectionState {
  kind: "ask" | "change";
  text: string;
  coords: { top: number; left: number };
}

export default function SelectionFloatingButton() {
  const { insertQuote, panel, artifacts, toast, activeRun } = useWorkspace();
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);
  const [isEditingChange, setIsEditingChange] = useState(false);
  const [changeInstruction, setChangeInstruction] = useState("");
  const [surroundingContext, setSurroundingContext] = useState<{ before: string; after: string }>({
    before: "",
    after: "",
  });

  const location = useLocation();
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeChatId = location.pathname.startsWith("/chat/")
    ? location.pathname.split("/")[2]
    : undefined;

  const handleClose = () => {
    setSelectionState(null);
    setIsEditingChange(false);
    setChangeInstruction("");
  };

  useEffect(() => {
    if (activeRun) {
      handleClose();
    }
  }, [activeRun]);

  useEffect(() => {
    if (isEditingChange && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditingChange]);

  useEffect(() => {
    const handleSelectionChange = () => {
      // Do not interrupt while user is actively typing in the change input
      if (isEditingChange) return;

      // Do not show button while message is actively streaming
      if (activeRun) {
        setSelectionState(null);
        return;
      }

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setSelectionState(null);
        return;
      }

      const text = sel.toString().trim();
      if (isSelectionInsideAssistant(sel)) {
        const coords = getSelectionCoordinates(sel);
        if (coords) {
          setSelectionState({ kind: "ask", text, coords });
        } else {
          setSelectionState(null);
        }
      } else if (isSelectionInsideArtifactPreview(sel)) {
        const coords = getSelectionCoordinates(sel);
        if (coords) {
          setSelectionState({ kind: "change", text, coords });
        } else {
          setSelectionState(null);
        }
      } else {
        setSelectionState(null);
      }
    };

    const handleScroll = () => {
      handleClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
        window.getSelection()?.removeAllRanges();
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("scroll", handleScroll, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeRun, isEditingChange]);

  if (!selectionState || typeof document === "undefined" || activeRun) {
    return null;
  }

  const handleAskClick = () => {
    const formatted = formatQuote(selectionState.text);
    insertQuote(formatted, activeChatId);
    window.getSelection()?.removeAllRanges();
    handleClose();
  };

  const handleChangeClick = () => {
    // Capture surrounding context from the live selection before it loses focus
    const sel = window.getSelection();
    if (sel) {
      const context = getSurroundingContextFromSelection(sel);
      setSurroundingContext(context);
    }
    setIsEditingChange(true);
  };

  const handleSubmitChange = () => {
    if (!changeInstruction.trim()) return;

    if (panel.kind === "artifact") {
      const artifact = artifacts.find((a) => a.id === panel.id);
      if (artifact) {
        const prompt = buildArtifactChangePrompt({
          artifactId: artifact.id,
          artifactTitle: artifact.title,
          currentVersion: artifact.version,
          selectedText: selectionState.text,
          instruction: changeInstruction.trim(),
          contextBefore: surroundingContext.before,
          contextAfter: surroundingContext.after,
        });

        // As Claude does with edit requests, the request joins the next message instead of
        // sending at once: several passages can be marked before one send, and the user sees
        // exactly what goes to the model.
        const targetChatId = artifact.chatId || activeChatId;
        if (targetChatId && !location.pathname.startsWith(`/chat/${targetChatId}`)) {
          navigate(`/chat/${targetChatId}`);
        }
        insertQuote(prompt, targetChatId);
        toast("Edit request added to your message");
      }
    }

    window.getSelection()?.removeAllRanges();
    handleClose();
  };

  if (isEditingChange) {
    return createPortal(
      <form
        className="selection-change-form"
        style={{
          top: `${selectionState.coords.top}px`,
          left: `${selectionState.coords.left}px`,
        }}
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmitChange();
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          aria-label="What should change?"
          placeholder="What should change?"
          value={changeInstruction}
          onChange={(e) => setChangeInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              handleClose();
              window.getSelection()?.removeAllRanges();
            }
          }}
        />
        <button
          type="submit"
          disabled={!changeInstruction.trim()}
          aria-label="Send change"
        >
          <ArrowUp size={13} />
        </button>
      </form>,
      document.body,
    );
  }

  const isAsk = selectionState.kind === "ask";
  const label = isAsk ? "Ask about this" : "Change this";

  return createPortal(
    <button
      ref={buttonRef}
      type="button"
      className="selection-floating-button"
      style={{
        top: `${selectionState.coords.top}px`,
        left: `${selectionState.coords.left}px`,
      }}
      aria-label={label}
      onMouseDown={(e) => {
        // Prevent default so that clicking the floating button does not collapse/clear the selection
        e.preventDefault();
      }}
      onClick={isAsk ? handleAskClick : handleChangeClick}
    >
      {isAsk ? <MessageCircle size={14} /> : <Pencil size={14} />}
      <span>{label}</span>
    </button>,
    document.body,
  );
}
