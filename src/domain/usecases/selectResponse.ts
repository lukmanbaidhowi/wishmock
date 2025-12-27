import { getValue as get } from "../../utils/objectUtils.js";
import type { MetadataMap, ResponseOption, RuleDoc } from "../types.js";
import { renderTemplate, createTemplateContext } from "./templateEngine.js";

// Pure use case: select a response given rule, request and metadata
export function selectResponse(ruleDoc: RuleDoc | undefined, req: unknown, metadata: MetadataMap, streamIndex?: number, streamTotal?: number): ResponseOption {
  if (!ruleDoc) return defaultOk();

  const match = ruleDoc.match || {};
  // AND matching for top-level match.metadata
  if (match.metadata) {
    for (const [k, v] of Object.entries(match.metadata)) {
      const actual = (metadata as any)[k];
      if (!compare(actual, v)) return fallbackOrDefault(ruleDoc);
    }
  }
  // AND matching for top-level match.request
  if (match.request) {
    for (const [k, v] of Object.entries(match.request)) {
      const actual = get(req as any, k);
      if (!compare(actual, v)) return fallbackOrDefault(ruleDoc);
    }
  }

  const list = ruleDoc.responses || [];

  // Collect candidates whose 'when' matches
  const candidates: ResponseOption[] = [];
  for (const r of list) {
    if (!r.when) continue; // fallback entries are considered if no candidates
    let ok = true;
    for (const [k, v] of Object.entries(r.when)) {
      const val = k.startsWith("request.")
        ? get(req as any, k.slice(8))
        : get({ request: req, metadata }, k);
      if (!compare(val, v)) { ok = false; break; }
    }
    if (ok) candidates.push(r);
  }

  if (candidates.length > 0) {
    return applyTemplating(pickHighestPriority(candidates, list), req, metadata, streamIndex, streamTotal);
  }
  // No conditional match -> fallback
  return applyTemplating(fallbackOrDefault(ruleDoc), req, metadata, streamIndex, streamTotal);
}

function fallbackOrDefault(ruleDoc: RuleDoc): ResponseOption {
  const list = ruleDoc.responses || [];
  const fallbacks = list.filter(x => !x.when);
  if (fallbacks.length > 0) return pickHighestPriority(fallbacks, list);
  return defaultOk();
}

function applyTemplating(response: ResponseOption, req: unknown, metadata: MetadataMap, streamIndex?: number, streamTotal?: number): ResponseOption {
  const context = createTemplateContext(
    req,
    metadata,
    streamIndex !== undefined && streamTotal !== undefined
      ? { index: streamIndex, total: streamTotal }
      : undefined
  );

  const templatedResponse = { ...response };

  if (templatedResponse.body !== undefined) {
    templatedResponse.body = renderTemplate(templatedResponse.body, context);
  }

  if (templatedResponse.stream_items) {
    templatedResponse.stream_items = templatedResponse.stream_items.map((item, index) => {
      const itemContext = createTemplateContext(
        req,
        metadata,
        { index, total: templatedResponse.stream_items!.length }
      );
      return renderTemplate(item, itemContext);
    });
  }

  return templatedResponse;
}

function pickHighestPriority(options: ResponseOption[], originalOrder: ResponseOption[]): ResponseOption {
  let best: ResponseOption | undefined;
  let bestPrio = -Infinity;
  let bestIndex = Infinity;
  for (const opt of options) {
    const prio = toNumber(opt.priority);
    const p = prio === undefined ? 0 : prio; // default to 0 when unspecified or NaN
    const idx = originalOrder.indexOf(opt);
    if (p > bestPrio || (p === bestPrio && idx < bestIndex)) {
      best = opt;
      bestPrio = p;
      bestIndex = idx;
    }
  }
  return best ?? options[0];
}

function defaultOk(): ResponseOption {
  return { body: {}, trailers: { "grpc-status": "0" } };
}

// Compare actual value against expected which may be a literal or an operator object
function compare(actual: unknown, expected: unknown): boolean {
  // Primitive or nullish: fallback to string equality
  if (!isPlainObject(expected)) {
    return String(actual ?? "") === String(expected ?? "");
  }

  const obj = expected as Record<string, unknown>;

  // NOT operator wraps any other expected
  if (Object.prototype.hasOwnProperty.call(obj, "not")) {
    return !compare(actual, (obj as any).not);
  }

  // exists: boolean
  if (Object.prototype.hasOwnProperty.call(obj, "exists")) {
    const should = Boolean((obj as any).exists);
    const exists = actual !== undefined && actual !== null;
    return exists === should;
  }

  // regex: string pattern (+ optional flags)
  if (Object.prototype.hasOwnProperty.call(obj, "regex")) {
    const pattern = String((obj as any).regex ?? "");
    const flags = String((obj as any).flags ?? "");
    try {
      const re = new RegExp(pattern, flags);
      return re.test(String(actual ?? ""));
    } catch {
      return false;
    }
  }

  // contains: substring for string, or element membership for arrays
  if (Object.prototype.hasOwnProperty.call(obj, "contains")) {
    const needle = (obj as any).contains;
    if (Array.isArray(actual)) {
      return actual.some((x) => String(x) === String(needle));
    }
    return String(actual ?? "").includes(String(needle ?? ""));
  }

  // in: list of allowed values
  if (Object.prototype.hasOwnProperty.call(obj, "in")) {
    const list = Array.isArray((obj as any).in) ? ((obj as any).in as unknown[]) : [];
    const s = String(actual ?? "");
    return list.some((x) => String(x) === s);
  }

  // Numeric comparisons
  const num = toNumber(actual);
  if (Object.prototype.hasOwnProperty.call(obj, "gt")) {
    const rhs = toNumber((obj as any).gt);
    if (num === undefined || rhs === undefined) return false;
    if (!(num > rhs)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(obj, "gte")) {
    const rhs = toNumber((obj as any).gte);
    if (num === undefined || rhs === undefined) return false;
    if (!(num >= rhs)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(obj, "lt")) {
    const rhs = toNumber((obj as any).lt);
    if (num === undefined || rhs === undefined) return false;
    if (!(num < rhs)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(obj, "lte")) {
    const rhs = toNumber((obj as any).lte);
    if (num === undefined || rhs === undefined) return false;
    if (!(num <= rhs)) return false;
  }

  // eq / ne explicit
  if (Object.prototype.hasOwnProperty.call(obj, "eq")) {
    if (String(actual ?? "") !== String((obj as any).eq)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(obj, "ne")) {
    if (String(actual ?? "") === String((obj as any).ne)) return false;
  }

  // If we reached here and at least one operator was present, treat as matched; otherwise fall back to equality
  const keys = Object.keys(obj);
  const known = ["not", "exists", "regex", "flags", "contains", "in", "gt", "gte", "lt", "lte", "eq", "ne"];
  const hasKnown = keys.some((k) => known.includes(k));
  if (hasKnown) return true;
  // Unknown shape -> default equality against the object string
  return String(actual ?? "") === String(expected ?? "");
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function toNumber(x: unknown): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}
