export function groupLoadedServices(keys: string[]): Map<string, string[]> {
  const byService = new Map<string, string[]>();
  for (const k of keys || []) {
    const s = String(k || "");
    const slash = s.indexOf("/");
    const svc = slash >= 0 ? s.slice(0, slash) : "(unknown)";
    const method = slash >= 0 ? s.slice(slash + 1) : s;
    if (!byService.has(svc)) byService.set(svc, []);
    byService.get(svc)!.push(method);
  }
  return byService;
}

