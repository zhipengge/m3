export type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system" | "thinking";
  text: string;
  streaming?: boolean;
};
