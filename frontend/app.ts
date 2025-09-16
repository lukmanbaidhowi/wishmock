import { groupLoadedServices } from './lib/services.ts';
import { renderSchema as renderSchemaHelper } from './lib/schema.ts';
import { allowFileByExt } from './lib/files.ts';

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];

async function fetchJSON(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, {
    headers: { "content-type": "application/json", ...((opts as any).headers || {}) },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function refreshStatus() {
  try {
    const s: any = await fetchJSON("/admin/status");
    // Ports
    const ports = s.grpc_ports || {};
    const plaintext = ports.plaintext ?? s.grpc_port;
    const tlsEnabled = !!ports.tls_enabled;
    const tlsPort = ports.tls ?? (tlsEnabled ? "(not bound)" : "-");
    const tlsErr = ports.tls_error || null;

    const elPlain = document.querySelector('#grpcPlaintextPort');
    const elTlsEnabled = document.querySelector('#grpcTlsEnabled');
    const elTlsPort = document.querySelector('#grpcTlsPort');
    const elTlsErrWrap = document.querySelector('#grpcTlsErrorWrap') as HTMLElement | null;
    const elTlsErr = document.querySelector('#grpcTlsError');
    if (elPlain) elPlain.textContent = String(plaintext ?? "-");
    if (elTlsEnabled) (elTlsEnabled as HTMLElement).textContent = tlsEnabled ? 'yes' : 'no';
    if (elTlsPort) (elTlsPort as HTMLElement).textContent = tlsEnabled ? String(tlsPort) : '-';
    if (elTlsErrWrap) elTlsErrWrap.style.display = tlsErr ? 'block' : 'none';
    if (elTlsErr && tlsErr) (elTlsErr as HTMLElement).textContent = tlsErr;
    const services = $("#services") as HTMLElement;
    if (services) services.innerHTML = "";
    // Group loaded methods by service for readability
    const byService = groupLoadedServices(s.loaded_services || []);
    [...byService.entries()]
      .sort((x, y) => String(x[0]).localeCompare(String(y[0])))
      .forEach(([svc, methods]) => {
      const li = document.createElement("li");
      const details = document.createElement("details");
      // Default collapsed; user can expand individual services
      (details as any).open = false;
      const summary = document.createElement("summary");
      summary.textContent = `${svc} (${methods.length})`;
      details.appendChild(summary);
      const ul = document.createElement("ul");
      methods.sort().forEach((m) => {
        const mi = document.createElement("li");
        mi.textContent = m;
        ul.appendChild(mi);
      });
      details.appendChild(ul);
      li.appendChild(details);
      services && services.appendChild(li);
    });
  const rules = $("#rules") as HTMLElement | null;
    if (rules) rules.innerHTML = "";
    (s.rules || []).forEach((k: string) => {
      const li = document.createElement("li");
      li.textContent = k;
      rules && rules.appendChild(li);
    });

    // Render protos status if present
    const pl = $("#protosLoaded");
    const ps = $("#protosSkipped");
    if (pl) pl.innerHTML = "";
    if (ps) ps.innerHTML = "";
    const protos = s.protos || { loaded: [], skipped: [] };
    (protos.loaded || []).forEach((f: string) => {
      const li = document.createElement("li");
      li.textContent = f;
      pl && pl.appendChild(li);
    });
    (protos.skipped || []).forEach((entry: any) => {
      const li = document.createElement("li");
      li.textContent = `${entry.file}${entry.error ? ` — ${entry.error}` : ""}`;
      ps && ps.appendChild(li);
    });
  } catch (e: any) {
    console.error(e);
    showSnackbar(`Failed to load status: ${e.message}`, 'error');
  }
}

async function uploadFile(endpoint: string, file: File) {
  const content = await file.text();
  const body = JSON.stringify({ filename: file.name, content });
  return fetchJSON(endpoint, { method: "POST", body });
}

async function uploadFileToPath(endpoint: string, file: File, relPath: string) {
  const content = await file.text();
  const body = JSON.stringify({ path: relPath, content });
  return fetchJSON(endpoint, { method: "POST", body });
}

function bindDropzone(zoneEl: HTMLElement | null, inputEl: HTMLInputElement | null, options?: { acceptExts?: string[]; onPicked?: (file: File) => void; }) {
  if (!zoneEl || !inputEl) return;
  const acceptExts = (options && options.acceptExts) || [];
  const onFileChosen = (file: File) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    if (options && typeof options.onPicked === 'function') options.onPicked(file);
  };

  const allow = (file: File) => allowFileByExt(file?.name || '', acceptExts);

  const stop = (e: { preventDefault(): void; stopPropagation(): void }) => { e.preventDefault(); e.stopPropagation(); };
  let dragCount = 0;
  const enter = (e: DragEvent) => { stop(e); dragCount++; zoneEl.classList.add('drag-over'); };
  const over = (e: DragEvent) => { stop(e); zoneEl.classList.add('drag-over'); };
  const leave = (e: DragEvent) => { stop(e); dragCount = Math.max(0, dragCount - 1); if (dragCount === 0) zoneEl.classList.remove('drag-over'); };
  const drop = (e: DragEvent) => {
    stop(e);
    dragCount = 0; zoneEl.classList.remove('drag-over');
    const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (!files.length) return;
    if (files.length > 1) { showSnackbar('Please drop only one file', 'warn'); return; }
    const f = files[0] as File;
    if (!allow(f)) { showSnackbar(`Unsupported file type. Allowed: ${acceptExts.join(', ')}`, 'warn'); return; }
    onFileChosen(f);
  };

  zoneEl.addEventListener('dragenter', enter);
  zoneEl.addEventListener('dragover', over);
  zoneEl.addEventListener('dragleave', leave);
  zoneEl.addEventListener('drop', drop);

  // Keep file name display in sync when chosen via picker
  inputEl.addEventListener('change', () => {
    if (inputEl.files && inputEl.files[0] && options && typeof options.onPicked === 'function') {
      options.onPicked(inputEl.files[0]);
    }
  });
}


function bindUploads() {
  (document.getElementById("uploadProto") as HTMLFormElement).addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = (document.getElementById("protoFile") as HTMLInputElement).files?.[0];
    if (!file) return showSnackbar("Choose a .proto file first", 'warn');
    try {
      await uploadFile("/admin/upload/proto", file);
      showSnackbar("Proto uploaded. The server will rebuild on next change detected.", 'success');
    } catch (err: any) {
      showSnackbar(`Upload failed: ${err.message}`, 'error');
    }
  });

  const uploadProtoAtPath = document.getElementById("uploadProtoAtPath");
  if (uploadProtoAtPath) {
    uploadProtoAtPath.addEventListener("submit", async (e) => {
      e.preventDefault();
      const file = (document.getElementById("protoFileAtPath") as HTMLInputElement).files?.[0];
      const relPath = String((document.getElementById("protoRelPath") as HTMLInputElement).value || "").trim();
      if (!file) return showSnackbar("Choose a .proto file first", 'warn');
      if (!relPath) return showSnackbar("Enter a relative path (e.g., common/types.proto)", 'warn');
      try {
        await uploadFileToPath("/admin/upload/proto/path", file, relPath);
        showSnackbar(`Proto uploaded to protos/${relPath}. The server will rebuild on next change detected.`, 'success');
      } catch (err: any) {
        showSnackbar(`Upload failed: ${err.message}`, 'error');
      }
    });
  }

  // Bind drag-and-drop for the two .proto forms
  const dz1 = $("#uploadProto");
  const in1 = document.getElementById("protoFile") as HTMLInputElement | null;
  const name1 = document.getElementById("protoFileName") as HTMLElement | null;
  bindDropzone(dz1, in1, {
    acceptExts: ['.proto'],
    onPicked: (file) => { if (name1) name1.textContent = `Selected: ${file.name}`; }
  });

  const dz2 = $("#uploadProtoAtPath");
  const in2 = document.getElementById("protoFileAtPath") as HTMLInputElement | null;
  const name2 = document.getElementById("protoFileAtPathName") as HTMLElement | null;
  bindDropzone(dz2, in2, {
    acceptExts: ['.proto'],
    onPicked: (file) => { if (name2) name2.textContent = `Selected: ${file.name}`; }
  });

  // Bind drag-and-drop for rule form (YAML/JSON)
  const dz3 = $("#uploadRule");
  const in3 = document.getElementById("ruleFile") as HTMLInputElement | null;
  const name3 = document.getElementById("ruleFileName") as HTMLElement | null;
  bindDropzone(dz3, in3, {
    acceptExts: ['.yaml', '.yml', '.json'],
    onPicked: (file) => { if (name3) name3.textContent = `Selected: ${file.name}`; }
  });

  (document.getElementById("uploadRule") as HTMLFormElement).addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = (document.getElementById("ruleFile") as HTMLInputElement).files?.[0];
    if (!file) return showSnackbar("Choose a rule file first", 'warn');
    try {
      await uploadFile("/admin/upload/rule", file);
      await refreshStatus();
      showSnackbar("Rule uploaded and reloaded.", 'success');
    } catch (err: any) {
      showSnackbar(`Upload failed: ${err.message}`, 'error');
    }
  });
}


// Basic router for anchor links
function bindNav() {
  $$(
    'header nav a'
  ).forEach((a) => {
    a.addEventListener('click', (_e) => {
      // allow default hash behavior; we could expand later for SPA routing
    });
  });
}

// Placeholder for future OIDC integration
const auth = {
  // Wire up a real OIDC client later (e.g., Keycloak JS adapter)
  getToken: () => null as string | null,
  attachAuth(headers: Record<string, string> = {}) {
    const t = auth.getToken();
    return t ? { ...headers, Authorization: `Bearer ${t}` } : headers;
  },
};

// Init
document.addEventListener("DOMContentLoaded", () => {
  (document.getElementById("refreshStatus") as HTMLButtonElement).addEventListener("click", refreshStatus);
  const rs = document.getElementById("refreshServices") as HTMLButtonElement | null;
  if (rs) rs.addEventListener("click", refreshServices);
  const exp = document.getElementById("expandAllServices") as HTMLButtonElement | null;
  const col = document.getElementById("collapseAllServices") as HTMLButtonElement | null;
  if (exp) exp.addEventListener("click", () => setServicesExpanded(true));
  if (col) col.addEventListener("click", () => setServicesExpanded(false));
  bindUploads();
  bindNav();
  refreshStatus();
  if (rs) refreshServices();
});

// Services list and schema inspector
async function refreshServices() {
  try {
    const data: any = await fetchJSON("/admin/services");
    renderServices(data?.services || []);
  } catch (e: any) {
    console.error(e);
    showSnackbar(`Failed to load services: ${e.message}`, 'error');
  }
}

function renderServices(services: any[]) {
  const container = $("#servicesList");
  if (!container) return;
  container.innerHTML = "";
  services
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .forEach((svc) => {
      const wrap = document.createElement("details");
      (wrap as any).className = "svc-block";
      (wrap as any).open = false; // collapsed by default
      const summary = document.createElement("summary");
      summary.textContent = svc.name || `${svc.package}.${svc.service}`;
      wrap.appendChild(summary);

      (svc.methods || []).forEach((m: any) => {
        const row = document.createElement("div");
        row.className = "method";

        const top = document.createElement("div");
        top.innerHTML = `<strong>${m.name}</strong> <span class="muted">(${m.full_method})</span>`;
        row.appendChild(top);

        const types = document.createElement("div");
        const req = makeTypeLink(m.request_type);
        const res = makeTypeLink(m.response_type);
        types.append("Request:", req, " Response:", res);
        row.appendChild(types);

        const rk = document.createElement("div");
        rk.className = "muted";
        rk.textContent = `rule: ${m.rule_key}`;
        row.appendChild(rk);

        wrap.appendChild(row);
      });

      container.appendChild(wrap);
    });
}

function setServicesExpanded(expand: boolean) {
  const list = $$("#servicesList details");
  list.forEach((d: any) => { d.open = !!expand; });
}

function makeTypeLink(typeName: string) {
  const span = document.createElement("span");
  span.className = "type-link";
  span.textContent = ` ${typeName} `;
  span.title = "Inspect schema";
  span.addEventListener("click", () => inspectType(typeName));
  return span;
}

async function inspectType(typeName: string) {
  const panel = $("#schemaPanel");
  const empty = $("#schemaEmpty");
  const content = $("#schemaContent");
  if (!panel || !content) return;
  try {
    const info = await fetchJSON(`/admin/schema/${encodeURIComponent(typeName)}`);
    if (empty) (empty as HTMLElement).style.display = "none";
    (content as HTMLElement).style.display = "block";
    (content as HTMLElement).innerHTML = renderSchemaHelper(typeName, info);
  } catch (e: any) {
    console.error(e);
    if (empty) (empty as HTMLElement).style.display = "none";
    (content as HTMLElement).style.display = "block";
    (content as HTMLElement).innerHTML = `<div class="muted">Failed to load schema for ${typeName}: ${e.message}</div>`;
  }
}

// Snackbar helpers
let __snackbarTimer: ReturnType<typeof setTimeout> | null = null;
function showSnackbar(message: string, kind: 'info' | 'success' | 'warn' | 'error' = 'info', opts: { duration?: number } = {}) {
  const el = document.getElementById('snackbar');
  const text = document.getElementById('snackbarText');
  const close = document.getElementById('snackbarClose');
  if (!el || !text || !close) { console.warn('Snackbar elements missing'); return; }
  (text as HTMLElement).textContent = String(message || '');
  el.classList.remove('info', 'success', 'warn', 'error');
  el.classList.add(kind || 'info');
  (el as HTMLElement).style.display = 'flex';
  requestAnimationFrame(() => el.classList.add('visible'));
  if (__snackbarTimer) clearTimeout(__snackbarTimer);
  const duration = opts.duration || (kind === 'error' ? 5000 : 3000);
  __snackbarTimer = setTimeout(hideSnackbar, duration);
  (close as HTMLButtonElement).onclick = hideSnackbar;
}
function hideSnackbar() {
  const el = document.getElementById('snackbar');
  if (!el) return;
  el.classList.remove('visible');
  if (__snackbarTimer) { clearTimeout(__snackbarTimer); __snackbarTimer = null; }
  setTimeout(() => { if (el && !el.classList.contains('visible')) (el as HTMLElement).style.display = 'none'; }, 150);
}
