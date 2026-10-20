export type Agent = {
  id: string;
  name: string;
  category: string;
  description: string;
  longDescription: string;
  capabilities: string[];
  tools: { name: string; status: string }[];
  starters: string[];
  /** Open WebUI tool ids attached to this worker (forms, MCP servers) */
  toolIds?: string[];
  /** Pinned prompt cards for the Home page (from the model's suggestion prompts) */
  pinned?: { title: string; description: string; prompt: string }[];
  owner: string;
  version: string;
  updated: string;
  rating: number | null;
  access: string;
  limits: string;
};

export type Source = { kind: "data" | "doc"; label: string };
export type TableData = { head: string[]; rows: (string | { text: string; flag?: boolean })[][] };

/** A write Digi prepared in chat. It does nothing until the person presses Confirm (the click is the authority, not the words in the chat). */
export type ActionCard = {
  id: string; tool: string; summary: string; status: "pending" | "confirmed" | "cancelled" | "expired" | "failed";
  result?: Record<string, unknown> | null; error?: string | null; messageId?: string | null; expiresAt?: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** assistant only */
  status?: "working" | "streaming" | "done" | "stopped";
  toolLabel?: string;
  /** Rich HTML from worker tools (forms). Shown in a sandboxed frame. */
  embeds?: string[];
  /** Prepared writes awaiting the person's confirmation (or their outcome). */
  actions?: ActionCard[];
  table?: TableData;
  sources?: Source[];
  feedback?: "up" | "down";
};

export type Chat = {
  id: string;
  agentId: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  /** prompt to send automatically when the chat first opens */
  pendingPrompt?: string;
};
