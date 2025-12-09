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
    let doc: any = f.endsWith(".json") ? JSON.parse(raw) : yaml.load(raw);
    
    // Normalize: if doc is an array, wrap it as { responses: doc }
    // This supports both formats:
    // 1. Array format: [{ when: ..., body: ... }, ...]
    // 2. Object format: { match: ..., responses: [...] }
    if (Array.isArray(doc)) {
      doc = { responses: doc };
    }
    
    const base = path.basename(f).replace(/\.(yaml|yml|json)$/i, "");
    index.set(base.toLowerCase(), doc as RuleDoc);
  }
  return index;
}

