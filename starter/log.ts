// A run log: one folder per run under runs/, a JSONL of events and numbered
// screenshots. Send us the runs you want us to look at with your submission.

import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class RunLog {
  readonly dir: string;
  private shots = 0;

  constructor(name: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.dir = join("runs", `${stamp}-${name}`);
    mkdirSync(this.dir, { recursive: true });
  }

  event(type: string, data: Record<string, unknown> = {}): void {
    appendFileSync(join(this.dir, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), type, ...data }) + "\n");
  }

  screenshot(png: Buffer, label = ""): string {
    const file = `${String(++this.shots).padStart(3, "0")}${label ? `-${label}` : ""}.png`;
    writeFileSync(join(this.dir, file), png);
    this.event("screenshot", { file });
    return file;
  }
}
