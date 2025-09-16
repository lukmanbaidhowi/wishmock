function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] as string));
}

export function renderSchema(typeName: string, info: any): string {
  if (!info || typeof info !== "object") {
    return `<div class=\"muted\">No schema info for ${escapeHtml(typeName)}</div>`;
  }

  if (info.kind === "message") {
    const fields = (info.fields || []).map((f: any) => {
      const flags = [
        f.repeated ? "repeated" : "",
        f.optional ? "optional" : "",
        f.map ? `map<${escapeHtml(f.keyType || "key")}, ${escapeHtml(f.type)}>` : "",
      ].filter(Boolean).join(", ");
      return `<tr><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.type)}</td><td>${escapeHtml(String(f.id))}</td><td>${escapeHtml(flags)}</td></tr>`;
    }).join("\n");

    const oneofs = info.oneofs ? Object.entries(info.oneofs as Record<string, string[]>).map(([k, v]) => {
      return `<div class=\"muted\">oneof ${escapeHtml(String(k))}: ${v.map(escapeHtml).join(", ")}</div>`;
    }).join("") : "";

    return `
      <div><strong>Message:</strong> ${escapeHtml(info.name || typeName)}</div>
      <table style=\"width:100%; border-collapse:collapse; margin-top:8px; font-size:12px;\">
        <thead><tr><th align=\"left\">Field</th><th align=\"left\">Type</th><th align=\"left\">ID</th><th align=\"left\">Flags</th></tr></thead>
        <tbody>${fields || `<tr><td colspan=\"4\" class=\"muted\">No fields</td></tr>`}</tbody>
      </table>
      ${oneofs}
    `;
  }

  if (info.kind === "enum") {
    const rows = Object.entries(info.values || {}).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`).join("\n");
    return `
      <div><strong>Enum:</strong> ${escapeHtml(info.name || typeName)}</div>
      <table style=\"width:100%; border-collapse:collapse; margin-top:8px; font-size:12px;\">
        <thead><tr><th align=\"left\">Name</th><th align=\"left\">Value</th></tr></thead>
        <tbody>${rows || `<tr><td colspan=\"2\" class=\"muted\">No values</td></tr>`}</tbody>
      </table>
    `;
  }

  // Fallback rendering
  return `<pre>${escapeHtml(JSON.stringify(info, null, 2))}</pre>`;
}

