export type Role = "user" | "assistant";

export type ChatHistoryTurn = {
  role: Role;
  content: string;
};

export type MessageStatus = "streaming" | "done" | "stopped" | "error";

export type Stage = "retrieving" | "done";

export type Citation = {
  id: number;
  doc: string;
  page?: number;
  section?: string;
  excerpt: string;
  score: number;
};

export type Message = {
  id: string;
  role: Role;
  content: string;
  status: MessageStatus;
  stage?: Stage;
  citations?: Citation[];
  tokens?: number;
  createdAt: number;
};

export type ChatResponse = {
  answer: string;
  citations: Citation[];
  tokens: number;
  usage?: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
  };
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  archivedAt?: number;
};

