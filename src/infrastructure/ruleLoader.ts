import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { RuleDoc } from "../domain/types.js";

export function loadRules(ruleDir: string): Map<string, RuleDoc> {
  const index = new Map<string, RuleDoc>();
  if (!fs.existsSync(ruleDir)) fs.mkdirSync(ruleDir, { recursive: true });
  const files = fs.readdirSync(ruleDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"));
  for (const f of files) {
    const p = path.join(ruleDir, f);
    const raw = fs.readFileSync(p, "utf8");
    const doc = f.endsWith(".json") ? JSON.parse(raw) : (yaml.load(raw) as RuleDoc);
    const base = path.basename(f).replace(/\.(yaml|yml|json)$/i, "");
    index.set(base.toLowerCase(), doc);
  }
  return index;
}

