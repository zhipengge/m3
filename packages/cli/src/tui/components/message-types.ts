export type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system" | "thinking" | "error" | "activity" | "tool_output";
  text: string;
  streaming?: boolean;
  /** Optional structured fields for the tool_output role. */
  toolName?: string;
  toolDetail?: string;
  toolIsError?: boolean;
};
