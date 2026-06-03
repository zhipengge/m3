import fs from "node:fs";
import path from "node:path";
import { expandHome } from "@m3/config";

export type SessionGoal = {
  condition: string;
  setAt: string;
  turns: number;
};

type GoalStoreData = {
  goals: Record<string, SessionGoal>;
};

const DEFAULT_PATH = "~/.m3/goals.json";

export class GoalStore {
  private data: GoalStoreData = { goals: {} };

  constructor(private readonly filePath: string = DEFAULT_PATH) {
    this.load();
  }

  private load(): void {
    const resolved = expandHome(this.filePath);
    if (!fs.existsSync(resolved)) return;
    try {
      this.data = JSON.parse(fs.readFileSync(resolved, "utf8")) as GoalStoreData;
    } catch {
      this.data = { goals: {} };
    }
  }

  private persist(): void {
    const resolved = expandHome(this.filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(this.data, null, 2));
  }

  get(sessionKey: string): SessionGoal | undefined {
    return this.data.goals[sessionKey];
  }

  set(sessionKey: string, condition: string): SessionGoal {
    const goal: SessionGoal = { condition, setAt: new Date().toISOString(), turns: 0 };
    this.data.goals[sessionKey] = goal;
    this.persist();
    return goal;
  }

  clear(sessionKey: string): boolean {
    if (!this.data.goals[sessionKey]) return false;
    delete this.data.goals[sessionKey];
    this.persist();
    return true;
  }

  incrementTurn(sessionKey: string): void {
    const goal = this.data.goals[sessionKey];
    if (!goal) return;
    goal.turns += 1;
    this.persist();
  }
}
