import readline from "node:readline";

export type PromptInterface = readline.Interface;

export function createPrompt(): PromptInterface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

export function ask(rl: PromptInterface, question: string, defaultValue = ""): Promise<string> {
  const hint = defaultValue ? ` [\x1b[2m${defaultValue}\x1b[0m]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${hint}: `, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed || defaultValue);
    });
  });
}

export async function askChoice<T extends string>(
  rl: PromptInterface,
  question: string,
  choices: Array<{ value: T; label: string }>,
  defaultValue: T,
): Promise<T> {
  console.log(`\n${question}`);
  choices.forEach((c, i) => {
    const mark = c.value === defaultValue ? "*" : " ";
    console.log(`  ${i + 1}) ${c.label} ${mark}`);
  });
  const raw = await ask(rl, `Choose 1-${choices.length}`, String(choices.findIndex((c) => c.value === defaultValue) + 1));
  const idx = Number(raw) - 1;
  if (idx >= 0 && idx < choices.length) return choices[idx]!.value;
  return defaultValue;
}

export async function askYesNo(
  rl: PromptInterface,
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const raw = (await ask(rl, `${question} (${hint})`, defaultYes ? "y" : "n")).toLowerCase();
  if (raw === "y" || raw === "yes") return true;
  if (raw === "n" || raw === "no") return false;
  return defaultYes;
}

export async function askNumber(
  rl: PromptInterface,
  question: string,
  defaultValue: number,
): Promise<number> {
  const raw = await ask(rl, question, String(defaultValue));
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

export function closePrompt(rl: PromptInterface): void {
  rl.close();
}
