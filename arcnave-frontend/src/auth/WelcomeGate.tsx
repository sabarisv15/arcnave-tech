import { useEffect, useState } from "react";
import { useSession } from "../session";
import { useWorkspace } from "../workspace";
import { Welcome } from "./Welcome";
import { hasSeenWelcome, markWelcomeSeen } from "./welcomeSeen";

/**
 * Mounted inside the signed-in workspace. Opens the welcome when this tab just created the
 * account and this browser has not shown it to that user before; marks it seen the moment it opens,
 * so closing the tab without pressing a button does not bring it back.
 */
export function WelcomeGate() {
  const { user, freshAccountId, dismissWelcome } = useSession();
  const { setSettings } = useWorkspace();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || freshAccountId !== userId || hasSeenWelcome(userId)) return;
    markWelcomeSeen(userId);
    setOpenFor(userId);
  }, [userId, freshAccountId]);

  if (!user || openFor !== user.id) return null;
  const close = () => {
    setOpenFor(null);
    dismissWelcome();
  };
  return (
    <Welcome
      name={user.name}
      onStart={close}
      onOpenSettings={() => {
        close();
        setSettings(true);
      }}
    />
  );
}
