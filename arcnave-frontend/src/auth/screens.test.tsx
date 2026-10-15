// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initials, maskEmail } from "./account";
import {
  CODE_ENTRY_STATES,
  CodeEntry,
  CodeEntryCard,
  codeEntryState,
} from "./CodeEntry";
import type { CodeEntryCardProps, CodeEntryStatus } from "./CodeEntry";
import { Invite, InviteCard } from "./Invite";
import type { InviteProps, InviteState } from "./Invite";
import { LinkConfirm, LinkConfirmCard } from "./LinkConfirm";
import {
  REACHABLE_SESSION_ENDED_REASONS,
  SessionEndedNotice,
  sessionEndedCopy,
} from "./SessionEnded";
import type { SessionEndedReason } from "./SessionEnded";
import { SPLASH_MS, Splash } from "./Splash";
import { TwoStepSetupCard, TwoStepSignInCard } from "./TwoStep";
import type { TwoStepSetupProps, TwoStepSignInProps } from "./TwoStep";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (node: React.ReactNode) => act(() => root.render(node));
const text = () => host.textContent ?? "";
const noop = () => {};

describe("helpers", () => {
  it("masks an e-mail after its first letter, as the boards do", () => {
    expect(maskEmail("priya@psgtech.ac.in")).toBe("p••••@psgtech.ac.in");
    expect(maskEmail("")).toBe("");
  });
  it("makes avatar initials from the name, else the e-mail", () => {
    expect(initials("Priya S", "p@x.in")).toBe("PS");
    expect(initials("", "ravi@x.in")).toBe("R");
  });
});

/* ---------------------------------------------------------------------------- code entry */
describe("code entry (S3-Code-States, 9 states)", () => {
  const base: CodeEntryCardProps = {
    status: "idle",
    value: "",
    onChange: noop,
    onSubmit: noop,
    onResend: noop,
  };
  const cases: {
    name: (typeof CODE_ENTRY_STATES)[number];
    props: Partial<CodeEntryCardProps>;
    message: string;
    button: string;
    disabled: boolean;
  }[] = [
    {
      name: "ready",
      props: { resendInSeconds: 42 },
      message: "",
      button: "Continue",
      disabled: true,
    },
    {
      name: "typing",
      props: { value: "482", resendInSeconds: 42 },
      message: "",
      button: "Continue",
      disabled: true,
    },
    {
      name: "checking",
      props: { status: "checking", value: "482913", resendInSeconds: 42 },
      message: "",
      button: "Checking…",
      disabled: true,
    },
    {
      name: "wrong",
      props: {
        status: "wrong",
        value: "482931",
        triesLeft: 4,
        resendInSeconds: 42,
      },
      message: "That code didn’t match. 4 tries left.",
      button: "Continue",
      disabled: false,
    },
    {
      name: "stopped",
      props: { status: "stopped" },
      message: "This code has stopped working.",
      button: "Send a new code",
      disabled: false,
    },
    {
      name: "resent",
      props: { status: "resent", resendInSeconds: 42 },
      message: "New code sent. Check your inbox.",
      button: "Continue",
      disabled: true,
    },
    {
      name: "too-many-codes",
      props: { status: "too-many-codes", value: "482913", waitMinutes: 38 },
      message: "Too many codes asked. Try again in 38 min.",
      button: "Continue",
      disabled: true,
    },
    {
      name: "paused",
      props: { status: "paused", pausedMinutes: 15 },
      message: "Sign-in paused for 15 min to keep you safe.",
      button: "Continue",
      disabled: true,
    },
    {
      name: "accepted",
      props: { status: "accepted", value: "482913" },
      message: "Code accepted. Opening arcnave…",
      button: "Signing in…",
      disabled: true,
    },
  ];

  it("covers exactly the board's nine states", () => {
    expect(cases.map((c) => c.name)).toEqual([...CODE_ENTRY_STATES]);
    expect(CODE_ENTRY_STATES).toHaveLength(9);
  });

  it.each(cases)(
    "renders $name",
    ({ name, props, message, button, disabled }) => {
      const merged = { ...base, ...props };
      render(<CodeEntryCard {...merged} />);
      expect(
        codeEntryState(merged.status as CodeEntryStatus, merged.value),
      ).toBe(name);
      expect(host.querySelector(".sx-code")?.getAttribute("data-state")).toBe(
        name,
      );
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(message);
      const primary = host.querySelector<HTMLButtonElement>(".sx-primary")!;
      expect(primary.textContent).toBe(button);
      expect(primary.disabled).toBe(disabled);
      expect(host.querySelectorAll(".sx-cbx")).toHaveLength(6);
    },
  );

  it("is one real input under six aria-hidden boxes, grouped 3 + 3", () => {
    render(<CodeEntryCard {...base} value="482" />);
    const input = host.querySelector("input")!;
    expect(host.querySelectorAll("input")).toHaveLength(1);
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.getAttribute("aria-label")).toBe("6-digit code");
    expect(input.getAttribute("aria-describedby")).toBe(
      host.querySelector('[role="alert"]')!.id,
    );
    const boxes = [...host.querySelectorAll(".sx-cbx")];
    expect(boxes.every((b) => b.getAttribute("aria-hidden") === "true")).toBe(
      true,
    );
    expect(boxes.map((b) => b.textContent)).toEqual([
      "4",
      "8",
      "2",
      "",
      "",
      "",
    ]);
    expect(boxes[3]!.className).toContain("sx-cbx--gap");
    expect(boxes[3]!.className).toContain("sx-cbx--on");
  });

  it("keeps digits only, at most six", () => {
    const onChange = vi.fn();
    render(<CodeEntryCard {...base} onChange={onChange} />);
    const input = host.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(input, "48a2-91 3x7");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("482913");
  });

  it("counts the resend down as m:ss and offers the link once it reaches zero", () => {
    render(<CodeEntryCard {...base} resendInSeconds={42} />);
    expect(text()).toContain("Resend code in 0:42");
    render(<CodeEntryCard {...base} resendInSeconds={0} />);
    expect(
      [...host.querySelectorAll("button")].map((b) => b.textContent),
    ).toContain("Resend code");
  });

  it("'Send a new code' waits out the 60 s", () => {
    const onResend = vi.fn();
    render(
      <CodeEntryCard
        {...base}
        status="stopped"
        resendInSeconds={30}
        onResend={onResend}
      />,
    );
    expect(host.querySelector<HTMLButtonElement>(".sx-primary")!.disabled).toBe(
      true,
    );
    render(
      <CodeEntryCard
        {...base}
        status="stopped"
        resendInSeconds={0}
        onResend={onResend}
      />,
    );
    act(() => host.querySelector<HTMLButtonElement>(".sx-primary")!.click());
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it("says '1 try left' in the singular", () => {
    render(
      <CodeEntryCard {...base} status="wrong" value="111111" triesLeft={1} />,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "That code didn’t match. 1 try left.",
    );
  });

  it("the page names the address and lets the person go back", () => {
    const back = vi.fn();
    render(
      <CodeEntry
        {...base}
        email="priya@psgtech.ac.in"
        onUseDifferentEmail={back}
      />,
    );
    expect(host.querySelector("h1")?.textContent).toBe("Check your e-mail");
    expect(text()).toContain("priya@psgtech.ac.in");
    expect(text()).toContain("We check it as soon as all 6 digits are in.");
    act(() =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "Use a different e-mail")!
        .click(),
    );
    expect(back).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------- link-confirm */
describe("link-confirm (S3-Link-States, 4 states)", () => {
  it.each([
    ["ready", "Sign in to arcnave"],
    ["signing-in", "Signing in…"],
    ["signed-in", "You’re signed in"],
    ["invalid", "This link no longer works"],
  ] as const)("renders %s", (state, expected) => {
    render(
      <LinkConfirmCard state={state} onConfirm={noop} onBackToSignIn={noop} />,
    );
    expect(text()).toContain(expected);
    expect(host.querySelector(".sx-card")?.getAttribute("aria-live")).toBe(
      "polite",
    );
  });

  it("the tap, not opening the page, is what confirms", () => {
    const onConfirm = vi.fn();
    render(
      <LinkConfirm state="ready" onConfirm={onConfirm} onBackToSignIn={noop} />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    expect(host.querySelector("h1")?.textContent).toBe("One tap to sign in");
    act(() => host.querySelector<HTMLButtonElement>(".sx-primary")!.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("an invalid link says the same thing whatever went wrong and offers the way back", () => {
    const back = vi.fn();
    render(
      <LinkConfirmCard
        state="invalid"
        onConfirm={noop}
        onBackToSignIn={back}
      />,
    );
    act(() =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "Back to sign-in")!
        .click(),
    );
    expect(back).toHaveBeenCalledTimes(1);
  });
});

/* ----------------------------------------------------------------------------- 2-step */
describe("2-step (S3-2Step-States)", () => {
  const setup: TwoStepSetupProps = {
    step: "scan",
    accountLabel: "arcnave (priya@psgtech.ac.in)",
    qr: (
      <svg
        data-testid="qr"
        role="img"
        aria-label="QR code for your authenticator app"
      />
    ),
    secretKey: "K7QM 2XRT V5PL AW4N",
    onCopyKey: noop,
    onNext: noop,
    onBack: noop,
    code: "",
    onCodeChange: noop,
    onConfirm: noop,
    recoveryCodes: [
      "4KQ7-M2XD",
      "P9WA-3HTV",
      "Z6RE-8NCJ",
      "B2LY-5QFM",
      "T7VK-9DPS",
      "H3XN-6WAR",
      "M8CJ-2EZT",
      "Q5FB-7LKH",
      "W4GU-3RNP",
      "E9SD-6YMC",
    ],
    saved: false,
    onSavedChange: noop,
    onDownload: noop,
    onCopyCodes: noop,
    onPrint: noop,
    onFinish: noop,
    onDone: noop,
  };

  it("step 1 shows the QR slot and the same key as text", () => {
    render(<TwoStepSetupCard {...setup} />);
    expect(host.querySelector('[data-testid="qr"]')).not.toBeNull();
    expect(text()).toContain("K7QM 2XRT V5PL AW4N");
    expect(text()).toContain("arcnave (priya@psgtech.ac.in)");
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain(
      "Scan",
    );
  });

  it("step 2 holds Confirm until six digits, and explains a wrong code", () => {
    render(<TwoStepSetupCard {...setup} step="confirm" code="70241" />);
    expect(
      host.querySelector<HTMLButtonElement>(".sx-row .sx-primary")!.disabled,
    ).toBe(true);
    render(
      <TwoStepSetupCard {...setup} step="confirm" code="702418" codeWrong />,
    );
    expect(
      host.querySelector<HTMLButtonElement>(".sx-row .sx-primary")!.disabled,
    ).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Is your phone’s time set to automatic?",
    );
  });

  it("step 3 lists ten codes and keeps Finish off until the box is ticked", () => {
    const onFinish = vi.fn();
    render(
      <TwoStepSetupCard {...setup} step="save-codes" onFinish={onFinish} />,
    );
    expect(host.querySelectorAll(".sx-rc li")).toHaveLength(10);
    const finish = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Finish",
    )!;
    expect(finish.disabled).toBe(true);
    render(
      <TwoStepSetupCard
        {...setup}
        step="save-codes"
        saved
        onFinish={onFinish}
      />,
    );
    const ready = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Finish",
    )!;
    expect(ready.disabled).toBe(false);
    act(() => ready.click());
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("step 4 says it is on", () => {
    render(<TwoStepSetupCard {...setup} step="on" />);
    expect(text()).toContain("2-step sign-in is on");
  });

  const signIn: TwoStepSignInProps = {
    view: "app-code",
    code: "",
    onCodeChange: noop,
    onSubmit: noop,
    recoveryCode: "",
    onRecoveryCodeChange: noop,
    onUseRecovery: noop,
    onUseAppCode: noop,
    onContactSupport: noop,
  };
  it("sign-in A, B and C", () => {
    render(<TwoStepSignInCard {...signIn} />);
    expect(text()).toContain("Enter the code from your app");
    expect(text()).toContain("Lost your phone? Use a recovery code");
    render(<TwoStepSignInCard {...signIn} view="recovery-code" />);
    expect(text()).toContain("Use a recovery code");
    expect(text()).toContain("Use the app code");
    render(
      <TwoStepSignInCard
        {...signIn}
        view="locked"
        opensAt="10:42 am tomorrow"
      />,
    );
    expect(text()).toContain("2-step sign-in is locked");
    expect(text()).toContain("10:42 am tomorrow");
  });
});

/* ------------------------------------------------------------------------------ invite */
describe("invite (S4-Invite-States, 5 states)", () => {
  const invite: InviteProps = {
    state: "ready",
    college: "GPT Coimbatore",
    invitedBy: "Ramesh K",
    role: "Staff",
    maskedEmail: "p••••@psgtech.ac.in",
    lastDay: "19 Oct 2026",
    google: <div data-testid="google-slot">Continue with Google</div>,
    onSendCode: noop,
    onGoToSignIn: noop,
  };
  it.each([
    ["ready", "GPT Coimbatore"],
    ["code-first", "Use the code this first time"],
    ["different-email", "Different e-mail"],
    ["expired", "This invite has expired"],
    ["already-joined", "You’ve already joined"],
  ] as [InviteState, string][])("renders %s", (state, expected) => {
    render(<InviteCard {...invite} state={state} />);
    expect(text()).toContain(expected);
  });

  it("ready shows who, the role, the masked e-mail, the last day, and Google above the code", () => {
    render(<Invite {...invite} />);
    expect(text()).toContain("invited by Ramesh K");
    expect(text()).toContain("Staff");
    expect(text()).toContain("works until 19 Oct 2026");
    expect(host.querySelector(".sx-org-av")?.textContent).toBe("GC");
    expect(host.querySelector('[data-testid="google-slot"]')).not.toBeNull();
    expect(host.querySelector(".sx-primary")?.textContent).toBe(
      "Send a code to p••••@psgtech.ac.in",
    );
  });

  it("an expired invite has no way in: only the college can send a new one", () => {
    render(<InviteCard {...invite} state="expired" />);
    expect(host.querySelector("button")).toBeNull();
    expect(text()).toContain("Ask Ramesh K or your college admin");
  });
});

/* -------------------------------------------------------------------- session ended (S7) */
describe("why you were signed out (S7-States)", () => {
  it("only 'unknown' is reachable, because the server answers a dead session with a bare 401", () => {
    expect([...REACHABLE_SESSION_ENDED_REASONS]).toEqual(["unknown"]);
  });

  it("the unknown reason claims no cause", () => {
    const copy = sessionEndedCopy("unknown");
    expect(copy.title).toBe("Please sign in again");
    expect(copy.why).toBe("Your session has ended. Sign in again.");
    render(<SessionEndedNotice />);
    expect(
      host.querySelector('[role="status"]')?.getAttribute("data-reason"),
    ).toBe("unknown");
  });

  it("the other six reasons have the board's words, ready for when the server can say why", () => {
    const titles: Record<Exclude<SessionEndedReason, "unknown">, string> = {
      idle: "Please sign in again",
      limit: "Time to sign in again",
      elsewhere: "You were logged out",
      "admin-daily": "Admins sign in every day",
      "access-ended": "Your access to GPT Coimbatore has ended",
      "different-account": "That’s a different account",
    };
    for (const [reason, title] of Object.entries(titles))
      expect(
        sessionEndedCopy(reason as SessionEndedReason, {
          college: "GPT Coimbatore",
        }).title,
      ).toBe(title);
    expect(sessionEndedCopy("access-ended").canSignInAgain).toBe(false);
    expect(sessionEndedCopy("idle").canSignInAgain).toBe(true);
  });
});

/* ----------------------------------------------------------------------------- splash */
describe("Splash v3 (not mounted on web)", () => {
  it("has the board's durations", () => {
    expect(SPLASH_MS).toEqual({ first: 3000, quick: 1000 });
  });

  function stillMotion() {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        addEventListener: noop,
        removeEventListener: noop,
      })),
    );
  }

  it("under reduced motion it shows the still logo and wordmark for the same time, then reports done", () => {
    vi.useFakeTimers();
    stillMotion();
    const onDone = vi.fn();
    render(<Splash variant="quick" onDone={onDone} />);
    expect(host.querySelector('[aria-label="Opening arcnave"]')).not.toBeNull();
    expect(host.querySelector("svg[aria-label='arcnave']")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(999));
    expect(onDone).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("never adds waiting: ready skips to the end in 200 ms", () => {
    vi.useFakeTimers();
    stillMotion();
    const onDone = vi.fn();
    render(<Splash variant="first" onDone={onDone} />);
    act(() => void vi.advanceTimersByTime(500));
    expect(onDone).not.toHaveBeenCalled();
    render(<Splash variant="first" ready onDone={onDone} />);
    act(() => void vi.advanceTimersByTime(201));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("is not mounted by the web app", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.dirname(new URL(import.meta.url).pathname);
    for (const file of ["../App.tsx", "../main.tsx", "../Auth.tsx"])
      expect(readFileSync(path.join(dir, file), "utf8")).not.toMatch(/Splash/);
  });
});
