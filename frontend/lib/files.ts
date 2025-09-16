export function allowFileByExt(filename: string, allowedExts: string[]): boolean {
  if (!Array.isArray(allowedExts) || allowedExts.length === 0) return true;
  const name = String(filename || "");
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = name.slice(dot).toLowerCase();
  const allowed = allowedExts.map((e) => {
    const s = String(e || "").trim().toLowerCase();
    return s.startsWith(".") ? s : `.${s}`;
  });
  return allowed.includes(ext);
}

