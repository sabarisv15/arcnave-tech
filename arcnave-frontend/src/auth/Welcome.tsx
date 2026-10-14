/**
 * First sign-in welcome (board `S4-Welcome`): a dialog over the new person's first screen, shown
 * once per user, after an account was created (sign-up, or a first Google sign-in).
 *
 * The board's second line, "You've joined GPT Coimbatore as Staff.", needs a college and a role.
 * ArcNave has neither yet (organisations arrive with invitations, N-72, Phase 5), so the line is an
 * optional prop and is not drawn when absent. Nothing here guesses a college.
 *
 * Copy for the three tips is the board's, word for word.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Folder, MessageSquare } from "lucide-react";
import { Icon, LivingDots } from "../brand";
import { firstName } from "./account";

export interface WelcomeProps {
  /** The person's name; the greeting drops the name when it is empty. */
  name: string;
  /** When known (not before invitations exist): shows "You’ve joined {college} as {role}." */
  joinedAs?: { college: string; role: string };
  onStart: () => void;
  onOpenSettings: () => void;
}

const TIPS = [
  {
    icon: MessageSquare,
    title: "Ask the way you talk",
    text: "English, தமிழ் or Tanglish. Type or use the mic.",
  },
  {
    icon: Folder,
    title: "Keep work together",
    text: "Put a class or a cell into a Project so its chats stay in one place.",
  },
  {
    icon: Check,
    title: "Check what matters",
    text: "arcnave can make mistakes. Check marks, dates and names before you send.",
  },
] as const;

export function Welcome({
  name,
  joinedAs,
  onStart,
  onOpenSettings,
}: WelcomeProps) {
  const first = firstName(name);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onStart()}>
      <Dialog.Portal>
        <Dialog.Overlay className="sx-welcome-scrim" />
        <Dialog.Content className="sx-welcome" aria-describedby={undefined}>
          <div className="sx-welcome-head">
            <span className="sx-welcome-mark" aria-hidden="true">
              <LivingDots size={48} pad={1.5} />
            </span>
            <div>
              <Dialog.Title className="sx-welcome-title">
                {first ? `Vanakkam, ${first}!` : "Vanakkam!"}
              </Dialog.Title>
              {joinedAs && (
                <p className="sx-welcome-sub">
                  You’ve joined {joinedAs.college} as {joinedAs.role}.
                </p>
              )}
            </div>
          </div>
          <ul className="sx-welcome-tips">
            {TIPS.map(({ icon, title, text }) => (
              <li key={title} className="sx-tip">
                <span className="sx-tip-icon">
                  <Icon icon={icon} size={19} />
                </span>
                <div>
                  <b>{title}</b>
                  <span>{text}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="sx-welcome-actions">
            <button
              type="button"
              className="sx-welcome-secondary"
              onClick={onOpenSettings}
            >
              Settings
            </button>
            <button
              type="button"
              className="sx-welcome-primary"
              onClick={onStart}
            >
              Start chatting
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
