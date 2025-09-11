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
    alert(`Failed to load status: ${e.message}`);
  }
}

async function uploadFile(endpoint, file) {
  const content = await file.text();
  const body = JSON.stringify({ filename: file.name, content });
  return fetchJSON(endpoint, { method: "POST", body });
}


function bindUploads() {
  $("#uploadProto").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("#protoFile").files[0];
    if (!file) return alert("Choose a .proto file first");
    try {
      await uploadFile("/admin/upload/proto", file);
      alert("Proto uploaded. The server will rebuild on next change detected.");
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    }
  });

  $("#uploadRule").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("#ruleFile").files[0];
    if (!file) return alert("Choose a rule file first");
    try {
      await uploadFile("/admin/upload/rule", file);
      await refreshStatus();
      alert("Rule uploaded and reloaded.");
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
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
    alert(`Failed to load services: ${e.message}`);
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
