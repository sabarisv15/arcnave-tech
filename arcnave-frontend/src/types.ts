export type Mode = "chat" | "search" | "research";
export const modelOptions = [
  { name: "Auto", description: "Routes each request to the right model" },
  { name: "Gemini 3.8 Flash", description: "Fastest for quick answers" },
  { name: "Sonnet 5", description: "Efficient for everyday tasks" },
  { name: "Opus 5", description: "Strongest for complex work" },
  { name: "GPT 5 Terra", description: "Balanced reasoning and coding" },
] as const;
export type Model = (typeof modelOptions)[number]["name"];
export type RunStatus =
  "idle" | "submitting" | "generating" | "stopped" | "complete" | "error";
export type ResearchStage =
  | "idle"
  | "planning"
  | "searching"
  | "reading"
  | "synthesizing"
  | "complete"
  | "partial"
  | "error";
export type ErrorCode =
  "network" | "generation" | "research" | "session" | "model" | "rate-limit";
export type SourceType =
  "Government" | "Academic" | "Web" | "Primary source" | "News" | "Community";
export interface Source {
  id: number;
  title: string;
  domain: string;
  url: string;
  type: SourceType;
  snippet: string;
  date?: string;
  passage?: string;
  unavailable?: boolean;
}
export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  status: "processing" | "ready" | "failed" | "unsupported";
  error?: string;
}
export interface ResearchEvent {
  stage: ResearchStage;
  label: string;
  detail: string;
  at: number;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  mode: Mode;
  status: RunStatus;
  sources?: Source[];
  events?: ResearchEvent[];
  researchStage?: ResearchStage;
  questions?: string[];
  artifactId?: string;
  attachments?: Attachment[];
  feedback?: "up" | "down";
  error?: ErrorCode;
  demo?: boolean;
}
export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  projectId?: string;
  pinned?: boolean;
  demo?: boolean;
}
export interface Project {
  id: string;
  title: string;
  description: string;
  instructions: string;
  files: Attachment[];
  savedSources: Source[];
  updatedAt: number;
  demo?: boolean;
}
export interface Artifact {
  draft?: string;
  id: string;
  title: string;
  kind: "document" | "code" | "webpage";
  versions: string[];
  version: number;
  updatedAt: number;
  projectId?: string;
  chatId?: string;
  demo?: boolean;
}
export interface Preferences {
  name: string;
  theme: "light" | "dark" | "system";
  font: "sans" | "serif";
  model: Model;
  instructions: string;
  enterToSend: boolean;
  reducedMotion: boolean;
  defaultMode: Mode;
  sourceScope: "All sources" | "Government" | "Academic";
  saveHistory: boolean;
}
export interface Workspace {
  chats: Chat[];
  projects: Project[];
  artifacts: Artifact[];
  preferences: Preferences;
}
export type Panel =
  | { kind: "closed" }
  | { kind: "sources"; chatId: string; messageId: string; selected?: number }
  | { kind: "research"; chatId: string; messageId: string }
  | { kind: "artifact"; id: string }
  | { kind: "file"; file: Attachment };
export const uid = () => crypto.randomUUID();
