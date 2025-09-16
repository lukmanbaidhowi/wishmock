const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function refreshStatus() {
  try {
    const s = await fetchJSON("/admin/status");
    // Ports
    const ports = s.grpc_ports || {};
    const plaintext = ports.plaintext ?? s.grpc_port;
    const tlsEnabled = !!ports.tls_enabled;
    const tlsPort = ports.tls ?? (tlsEnabled ? "(not bound)" : "-");
    const tlsErr = ports.tls_error || null;

    const elPlain = document.querySelector('#grpcPlaintextPort');
    const elTlsEnabled = document.querySelector('#grpcTlsEnabled');
    const elTlsPort = document.querySelector('#grpcTlsPort');
    const elTlsErrWrap = document.querySelector('#grpcTlsErrorWrap');
    const elTlsErr = document.querySelector('#grpcTlsError');
    if (elPlain) elPlain.textContent = String(plaintext ?? "-");
    if (elTlsEnabled) elTlsEnabled.textContent = tlsEnabled ? 'yes' : 'no';
    if (elTlsPort) elTlsPort.textContent = tlsEnabled ? String(tlsPort) : '-';
    if (elTlsErrWrap) elTlsErrWrap.style.display = tlsErr ? 'block' : 'none';
    if (elTlsErr && tlsErr) elTlsErr.textContent = tlsErr;
    const services = $("#services");
    services.innerHTML = "";
    // Group loaded methods by service for readability
    const byService = new Map();
    (s.loaded_services || []).forEach((full) => {
      const str = String(full || "");
      const [svc, method] = str.includes("/") ? str.split("/", 2) : [str, ""];
      if (!byService.has(svc)) byService.set(svc, []);
      if (method) byService.get(svc).push(method);
    });
    [...byService.entries()]
      .sort((x, y) => String(x[0]).localeCompare(String(y[0])))
      .forEach(([svc, methods]) => {
      const li = document.createElement("li");
      const details = document.createElement("details");
      // Default collapsed; user can expand individual services
      details.open = false;
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
      services.appendChild(li);
    });
  const rules = $("#rules");
    rules.innerHTML = "";
    (s.rules || []).forEach((k) => {
      const li = document.createElement("li");
      li.textContent = k;
      rules.appendChild(li);
    });

    // Render protos status if present
    const pl = $("#protosLoaded");
    const ps = $("#protosSkipped");
    if (pl) pl.innerHTML = "";
    if (ps) ps.innerHTML = "";
    const protos = s.protos || { loaded: [], skipped: [] };
    (protos.loaded || []).forEach((f) => {
      const li = document.createElement("li");
      li.textContent = f;
      pl && pl.appendChild(li);
    });
    (protos.skipped || []).forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = `${entry.file}${entry.error ? ` — ${entry.error}` : ""}`;
      ps && ps.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    showSnackbar(`Failed to load status: ${e.message}`, 'error');
  }
}

async function uploadFile(endpoint, file) {
  const content = await file.text();
  const body = JSON.stringify({ filename: file.name, content });
  return fetchJSON(endpoint, { method: "POST", body });
}

async function uploadFileToPath(endpoint, file, relPath) {
  const content = await file.text();
  const body = JSON.stringify({ path: relPath, content });
  return fetchJSON(endpoint, { method: "POST", body });
}

function bindDropzone(zoneEl, inputEl, options) {
  if (!zoneEl || !inputEl) return;
  const acceptExts = (options && options.acceptExts) || [];
  const onFileChosen = (file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    if (options && typeof options.onPicked === 'function') options.onPicked(file);
  };

  const allow = (file) => {
    if (!acceptExts.length) return true;
    const name = (file && file.name) ? file.name.toLowerCase() : '';
    return acceptExts.some((ext) => name.endsWith(ext));
  };

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  let dragCount = 0;
  const enter = (e) => { stop(e); dragCount++; zoneEl.classList.add('drag-over'); };
  const over = (e) => { stop(e); zoneEl.classList.add('drag-over'); };
  const leave = (e) => { stop(e); dragCount = Math.max(0, dragCount - 1); if (dragCount === 0) zoneEl.classList.remove('drag-over'); };
  const drop = (e) => {
    stop(e);
    dragCount = 0; zoneEl.classList.remove('drag-over');
    const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (!files.length) return;
    if (files.length > 1) { showSnackbar('Please drop only one file', 'warn'); return; }
    const f = files[0];
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
  $("#uploadProto").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("#protoFile").files[0];
    if (!file) return showSnackbar("Choose a .proto file first", 'warn');
    try {
      await uploadFile("/admin/upload/proto", file);
      showSnackbar("Proto uploaded. The server will rebuild on next change detected.", 'success');
    } catch (err) {
      showSnackbar(`Upload failed: ${err.message}`, 'error');
    }
  });

  const uploadProtoAtPath = $("#uploadProtoAtPath");
  if (uploadProtoAtPath) {
    uploadProtoAtPath.addEventListener("submit", async (e) => {
      e.preventDefault();
      const file = $("#protoFileAtPath").files[0];
      const relPath = String($("#protoRelPath").value || "").trim();
      if (!file) return showSnackbar("Choose a .proto file first", 'warn');
      if (!relPath) return showSnackbar("Enter a relative path (e.g., common/types.proto)", 'warn');
      try {
        await uploadFileToPath("/admin/upload/proto/path", file, relPath);
        showSnackbar(`Proto uploaded to protos/${relPath}. The server will rebuild on next change detected.`, 'success');
      } catch (err) {
        showSnackbar(`Upload failed: ${err.message}`, 'error');
      }
    });
  }

  // Bind drag-and-drop for the two .proto forms
  const dz1 = $("#uploadProto");
  const in1 = $("#protoFile");
  const name1 = $("#protoFileName");
  bindDropzone(dz1, in1, {
    acceptExts: ['.proto'],
    onPicked: (file) => { if (name1) name1.textContent = `Selected: ${file.name}`; }
  });

  const dz2 = $("#uploadProtoAtPath");
  const in2 = $("#protoFileAtPath");
  const name2 = $("#protoFileAtPathName");
  bindDropzone(dz2, in2, {
    acceptExts: ['.proto'],
    onPicked: (file) => { if (name2) name2.textContent = `Selected: ${file.name}`; }
  });

  // Bind drag-and-drop for rule form (YAML/JSON)
  const dz3 = $("#uploadRule");
  const in3 = $("#ruleFile");
  const name3 = $("#ruleFileName");
  bindDropzone(dz3, in3, {
    acceptExts: ['.yaml', '.yml', '.json'],
    onPicked: (file) => { if (name3) name3.textContent = `Selected: ${file.name}`; }
  });

  $("#uploadRule").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("#ruleFile").files[0];
    if (!file) return showSnackbar("Choose a rule file first", 'warn');
    try {
      await uploadFile("/admin/upload/rule", file);
      await refreshStatus();
      showSnackbar("Rule uploaded and reloaded.", 'success');
    } catch (err) {
      showSnackbar(`Upload failed: ${err.message}`, 'error');
    }
  });
}


// Basic router for anchor links
function bindNav() {
  $$('header nav a').forEach((a) => {
    a.addEventListener('click', (e) => {
      // allow default hash behavior; we could expand later for SPA routing
    });
  });
}

// Placeholder for future OIDC integration
const auth = {
  // Wire up a real OIDC client later (e.g., Keycloak JS adapter)
  getToken: () => null,
  attachAuth(headers = {}) {
    const t = auth.getToken();
    return t ? { ...headers, Authorization: `Bearer ${t}` } : headers;
  },
};

// Init
document.addEventListener("DOMContentLoaded", () => {
  $("#refreshStatus").addEventListener("click", refreshStatus);
  const rs = $("#refreshServices");
  if (rs) rs.addEventListener("click", refreshServices);
  const exp = $("#expandAllServices");
  const col = $("#collapseAllServices");
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
    const data = await fetchJSON("/admin/services");
    renderServices(data?.services || []);
  } catch (e) {
    console.error(e);
    showSnackbar(`Failed to load services: ${e.message}`, 'error');
  }
}

function renderServices(services) {
  const container = $("#servicesList");
  if (!container) return;
  container.innerHTML = "";
  services
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .forEach((svc) => {
      const wrap = document.createElement("details");
      wrap.className = "svc-block";
      wrap.open = false; // collapsed by default
      const summary = document.createElement("summary");
      summary.textContent = svc.name || `${svc.package}.${svc.service}`;
      wrap.appendChild(summary);

      (svc.methods || []).forEach((m) => {
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

function setServicesExpanded(expand) {
  const list = $$("#servicesList details");
  list.forEach((d) => { d.open = !!expand; });
}

function makeTypeLink(typeName) {
  const span = document.createElement("span");
  span.className = "type-link";
  span.textContent = ` ${typeName} `;
  span.title = "Inspect schema";
  span.addEventListener("click", () => inspectType(typeName));
  return span;
}

async function inspectType(typeName) {
  const panel = $("#schemaPanel");
  const empty = $("#schemaEmpty");
  const content = $("#schemaContent");
  if (!panel || !content) return;
  try {
    const info = await fetchJSON(`/admin/schema/${encodeURIComponent(typeName)}`);
    if (empty) empty.style.display = "none";
    content.style.display = "block";
    content.innerHTML = renderSchema(typeName, info);
  } catch (e) {
    console.error(e);
    if (empty) empty.style.display = "none";
    content.style.display = "block";
    content.innerHTML = `<div class="muted">Failed to load schema for ${typeName}: ${e.message}</div>`;
  }
}

function renderSchema(typeName, info) {
  if (!info || !info.kind) return `<div>No schema for ${typeName}</div>`;
  if (info.kind === "enum") {
    const values = Object.entries(info.values || {})
      .map(([k, v]) => `<div><code>${k}</code> = ${v}</div>`) 
      .join("");
    return `
      <div><strong>Enum</strong> <code>${typeName}</code></div>
      <div class="panel">${values || "<div class=\"muted\">(no values)</div>"}</div>
    `;
  }
  if (info.kind === "message") {
    const fields = (info.fields || [])
      .map((f) => {
        const repr = [
          `#${f.id}`,
          f.repeated ? "repeated" : (f.optional ? "optional" : "required"),
          f.map ? `map<${f.keyType}, ${f.type}>` : f.type,
        ].filter(Boolean).join(" ");
        return `<div><code>${f.name}</code> — ${repr}</div>`;
      })
      .join("");
    const oneofs = (info.oneofs || [])
      .map((o) => `<div>oneof <code>${o.name}</code>: ${(o.fields || []).map((x) => `<code>${x}</code>`).join(", ")}</div>`) 
      .join("");
    return `
      <div><strong>Message</strong> <code>${typeName}</code></div>
      <div class="panel">
        <div><strong>Fields</strong></div>
        ${fields || '<div class="muted">(no fields)</div>'}
      </div>
      ${oneofs ? `<div class="panel"><div><strong>Oneofs</strong></div>${oneofs}</div>` : ""}
    `;
  }
  return `<div class="muted">Unknown schema kind for ${typeName}</div>`;
}

// Snackbar helpers
let __snackbarTimer = null;
function showSnackbar(message, kind = 'info', opts = {}) {
  const el = document.getElementById('snackbar');
  const text = document.getElementById('snackbarText');
  const close = document.getElementById('snackbarClose');
  if (!el || !text || !close) { console.warn('Snackbar elements missing'); return; }
  text.textContent = String(message || '');
  el.classList.remove('info', 'success', 'warn', 'error');
  el.classList.add(kind || 'info');
  el.style.display = 'flex';
  requestAnimationFrame(() => el.classList.add('visible'));
  if (__snackbarTimer) clearTimeout(__snackbarTimer);
  const duration = opts.duration || (kind === 'error' ? 5000 : 3000);
  __snackbarTimer = setTimeout(hideSnackbar, duration);
  close.onclick = hideSnackbar;
}
function hideSnackbar() {
  const el = document.getElementById('snackbar');
  if (!el) return;
  el.classList.remove('visible');
  if (__snackbarTimer) { clearTimeout(__snackbarTimer); __snackbarTimer = null; }
  setTimeout(() => { if (el && !el.classList.contains('visible')) el.style.display = 'none'; }, 150);
}
