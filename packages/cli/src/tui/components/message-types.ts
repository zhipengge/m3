export type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system" | "thinking" | "error" | "activity";
  text: string;
  streaming?: boolean;
};
