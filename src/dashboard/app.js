/* ── Recon Dashboard ─────────────────────────────── */
'use strict';

/* ── Node type colors ────────────────────────────── */
const TYPE_COLORS = {
  Package: { bg: '#3b82f6', border: '#2563eb' },
  Module: { bg: '#06b6d4', border: '#0891b2' },
  Function: { bg: '#22c55e', border: '#16a34a' },
  Method: { bg: '#14b8a6', border: '#0d9488' },
  Struct: { bg: '#f59e0b', border: '#d97706' },
  Class: { bg: '#f97316', border: '#ea580c' },
  Interface: { bg: '#a855f7', border: '#9333ea' },
  Trait: { bg: '#c084fc', border: '#a855f7' },
  Component: { bg: '#ec4899', border: '#db2777' },
  Type: { bg: '#eab308', border: '#ca8a04' },
  Enum: { bg: '#ef4444', border: '#dc2626' },
  File: { bg: '#64748b', border: '#475569' },
};

const TYPE_SHAPES = {
  Package: 'diamond', Module: 'diamond',
  Function: 'dot', Method: 'dot',
  Struct: 'box', Class: 'box',
  Interface: 'triangleDown', Trait: 'triangleDown',
  Component: 'star', Type: 'ellipse',
  Enum: 'hexagon', File: 'square',
};

const EDGE_COLORS = {
  CALLS: 'rgba(99,102,241,0.5)',
  IMPORTS: 'rgba(59,130,246,0.4)',
  HAS_METHOD: 'rgba(20,184,166,0.5)',
  IMPLEMENTS: 'rgba(168,85,247,0.5)',
  EXTENDS: 'rgba(192,132,252,0.5)',
  USES_COMPONENT: 'rgba(236,72,153,0.5)',
  CALLS_API: 'rgba(245,158,11,0.6)',
  CONTAINS: 'rgba(71,85,105,0.3)',
  DEFINES: 'rgba(71,85,105,0.3)',
};

/* Community palette for coloring by community */
const COMMUNITY_PALETTE = [
  '#6366f1', '#22d3ee', '#22c55e', '#f59e0b', '#ec4899',
  '#a855f7', '#f97316', '#14b8a6', '#ef4444', '#3b82f6',
  '#8b5cf6', '#06b6d4', '#84cc16', '#e11d48', '#0ea5e9',
  '#d946ef', '#10b981', '#f43f5e', '#7c3aed', '#0891b2',
];

/* ── State ───────────────────────────────────────── */
let network = null;
let graphData = { nodes: [], edges: [], stats: {} };
let physicsEnabled = true;
let selectedPkg = '';
let communityMode = false;
let currentTab = 'graph';
let processesLoaded = false;

/* ── DOM refs ────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const searchInput = $('searchInput');
const headerStats = $('headerStats');
const packageList = $('packageList');
const pkgCount = $('pkgCount');
const graphContainer = $('graphContainer');
const loadingOverlay = $('loadingOverlay');
const detailsTitle = $('detailsTitle');
const detailsContent = $('detailsContent');
const statusText = $('statusText');
const typeFilter = $('typeFilter');
const limitSelect = $('limitSelect');
const fitBtn = $('fitBtn');
const physicsBtn = $('physicsBtn');
const refreshBtn = $('refreshBtn');
const communityToggle = $('communityToggle');



/* ── API helpers ─────────────────────────────────── */
async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* ── Tab Switching ───────────────────────────────── */
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      if (target === currentTab) return;

      // Update tab buttons
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update view panels
      document.querySelectorAll('.view-panel').forEach(v => v.classList.remove('active'));
      document.getElementById(`view-${target}`).classList.add('active');

      currentTab = target;

      // Lazy load
      if (target === 'processes' && !processesLoaded) loadProcesses();
    });
  });
}

/* ── Load health stats ───────────────────────────── */
async function loadHealth() {
  try {
    const data = await get('/api/health');
    headerStats.innerHTML = [
      `<span class="stat-pill"><strong>${data.nodes}</strong> nodes</span>`,
      `<span class="stat-pill"><strong>${data.relationships}</strong> edges</span>`,
      `<span class="stat-pill"><strong>${data.tools}</strong> tools</span>`,
    ].join('');
    return data;
  } catch {
    headerStats.innerHTML = '<span class="stat-pill">offline</span>';
    return null;
  }
}

/* ── Load and render graph ───────────────────────── */
async function loadGraph() {
  loadingOverlay.classList.remove('hidden');

  const params = new URLSearchParams();
  params.set('limit', limitSelect.value);
  if (typeFilter.value) params.set('type', typeFilter.value);
  if (selectedPkg) params.set('package', selectedPkg);

  try {
    graphData = await get(`/api/graph?${params}`);
    renderNetwork(graphData);
    updateStatus();
    buildPackageSidebar();
    buildLegend();
  } catch (err) {
    showEmptyState('Could not load graph. Is the index built?');
  } finally {
    loadingOverlay.classList.add('hidden');
  }
}

function renderNetwork(data) {
  if (data.nodes.length === 0) {
    showEmptyState('No nodes to display. Run <code>npx recon index</code> then reload.');
    return;
  }

  // Build vis-network groups from TYPE_COLORS
  const groups = {};
  for (const [type, colors] of Object.entries(TYPE_COLORS)) {
    groups[type] = {
      color: {
        background: colors.bg, border: colors.border,
        highlight: { background: colors.bg, border: '#fff' }
      },
      shape: TYPE_SHAPES[type] || 'dot',
      font: { color: '#e2e8f0' },
    };
  }

  // Community color mapping
  const communityMap = new Map();
  let communityIdx = 0;
  if (communityMode) {
    for (const n of data.nodes) {
      if (n.community && !communityMap.has(n.community)) {
        communityMap.set(n.community, COMMUNITY_PALETTE[communityIdx % COMMUNITY_PALETTE.length]);
        communityIdx++;
      }
    }
  }

  const nodes = new vis.DataSet(data.nodes.map(n => {
    const base = {
      id: n.id,
      label: n.label,
      group: n.group,
      title: tooltip(n),
      value: Math.max(n.value, 1),
      _meta: n,
    };

    // Override color if community mode
    if (communityMode && n.community && communityMap.has(n.community)) {
      const c = communityMap.get(n.community);
      base.color = {
        background: c,
        border: c,
        highlight: { background: c, border: '#fff' },
      };
    }

    return base;
  }));

  const edges = new vis.DataSet(data.edges.map(e => ({
    from: e.from,
    to: e.to,
    label: e.arrows ? undefined : e.label,
    color: {
      color: EDGE_COLORS[e.label] || 'rgba(100,116,139,0.3)',
      highlight: '#6366f1'
    },
    arrows: { to: { enabled: true, scaleFactor: 0.4 } },
    smooth: { type: 'continuous' },
    width: 0.8,
  })));

  const options = {
    groups,
    nodes: {
      scaling: { min: 8, max: 28, label: { enabled: true, min: 10, max: 18 } },
      font: { size: 11, color: '#cbd5e1', strokeWidth: 2, strokeColor: '#06060b' },
      borderWidth: 1.5,
      shadow: { enabled: true, color: 'rgba(0,0,0,0.4)', size: 6, x: 0, y: 2 },
    },
    edges: {
      font: { size: 9, color: '#475569', strokeWidth: 0 },
      selectionWidth: 2,
    },
    physics: {
      enabled: physicsEnabled,
      barnesHut: {
        gravitationalConstant: -2500,
        centralGravity: 0.25,
        springLength: 120,
        springConstant: 0.03,
        damping: 0.12,
      },
      stabilization: { iterations: 120, fit: true },
    },
    interaction: {
      hover: true,
      tooltipDelay: 150,
      zoomView: true,
      dragView: true,
      multiselect: false,
      navigationButtons: false,
    },
    layout: { improvedLayout: data.nodes.length < 200 },
  };

  if (network) network.destroy();
  network = new vis.Network(graphContainer, { nodes, edges }, options);

  network.on('click', (params) => {
    if (params.nodes.length > 0) {
      showNodeDetails(params.nodes[0]);
    } else {
      clearDetails();
    }
  });

  network.on('stabilizationIterationsDone', () => {
    network.setOptions({ physics: { stabilization: false } });
  });
}

function tooltip(n) {
  let t = `${n.group}: ${n.label}`;
  if (n.file) t += `\n${n.file}`;
  if (n.startLine) t += `:${n.startLine}-${n.endLine}`;
  if (n.package) t += `\nPkg: ${n.package}`;
  if (n.community) t += `\nCommunity: ${n.community}`;
  return t;
}

function showEmptyState(msg) {
  graphContainer.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
}

function updateStatus() {
  const s = graphData.stats;
  statusText.textContent = s
    ? `Showing ${s.shownNodes} of ${s.totalNodes} nodes, ${s.shownEdges} of ${s.totalEdges} edges`
    : 'Ready';
}

/* ── Legend ───────────────────────────────────────── */
function buildLegend() {
  const legendItems = $('legendItems');
  if (!legendItems) return;

  if (communityMode) {
    // Show community colors
    const communities = new Map();
    let idx = 0;
    for (const n of graphData.nodes) {
      if (n.community && !communities.has(n.community)) {
        communities.set(n.community, COMMUNITY_PALETTE[idx % COMMUNITY_PALETTE.length]);
        idx++;
      }
    }

    let html = '';
    for (const [name, color] of communities) {
      html += `<div class="legend-item">
        <span class="legend-dot" style="background:${color}"></span>
        <span>${esc(name)}</span>
      </div>`;
    }
    legendItems.innerHTML = html || '<div class="legend-item" style="color:var(--text-muted)">No communities</div>';
  } else {
    // Show type colors
    const typesInGraph = new Set(graphData.nodes.map(n => n.group));
    let html = '';
    for (const [type, colors] of Object.entries(TYPE_COLORS)) {
      if (!typesInGraph.has(type)) continue;
      html += `<div class="legend-item">
        <span class="legend-dot" style="background:${colors.bg}"></span>
        <span>${type}</span>
      </div>`;
    }
    legendItems.innerHTML = html;
  }
}

/* ── Package sidebar ─────────────────────────────── */
function buildPackageSidebar() {
  const pkgs = new Map();
  for (const n of graphData.nodes) {
    const pkg = n.package || '(root)';
    pkgs.set(pkg, (pkgs.get(pkg) || 0) + 1);
  }

  const sorted = [...pkgs.entries()].sort((a, b) => b[1] - a[1]);
  pkgCount.textContent = sorted.length;

  let html = `<div class="pkg-item ${!selectedPkg ? 'active' : ''}" data-pkg="">
    <span class="pkg-name">All packages</span>
    <span class="pkg-count">${graphData.nodes.length}</span>
  </div>`;

  for (const [name, count] of sorted) {
    const active = selectedPkg === name ? ' active' : '';
    const short = name.length > 28 ? '...' + name.slice(-25) : name;
    html += `<div class="pkg-item${active}" data-pkg="${esc(name)}" title="${esc(name)}">
      <span class="pkg-name">${esc(short)}</span>
      <span class="pkg-count">${count}</span>
    </div>`;
  }

  packageList.innerHTML = html;
  packageList.querySelectorAll('.pkg-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedPkg = el.dataset.pkg;
      loadGraph();
    });
  });
}

/* ── Node details panel ──────────────────────────── */
function showNodeDetails(nodeId) {
  const node = graphData.nodes.find(n => n.id === nodeId);
  if (!node) return;

  const colors = TYPE_COLORS[node.group] || { bg: '#64748b' };

  const incoming = graphData.edges.filter(e => e.to === nodeId);
  const outgoing = graphData.edges.filter(e => e.from === nodeId);

  let html = `<div class="detail-card">
    <div class="detail-name">${esc(node.label)}</div>
    <span class="detail-type-badge" style="background:${colors.bg}20;color:${colors.bg}">${node.group}</span>
    ${node.language ? `<span class="detail-type-badge" style="background:rgba(100,116,139,0.2);color:#94a3b8">${node.language}</span>` : ''}
    <div class="detail-meta">
      ${metaRow('File', node.file)}
      ${node.startLine ? metaRow('Lines', `${node.startLine} - ${node.endLine}`) : ''}
      ${metaRow('Package', node.package)}
      ${node.community ? metaRow('Community', node.community) : ''}
      ${node.exported !== undefined ? metaRow('Exported', node.exported ? 'yes' : 'no') : ''}
    </div>
  </div>`;

  if (incoming.length > 0) {
    html += `<div class="rel-section">
      <div class="rel-heading">Incoming (${incoming.length})</div>
      <ul class="rel-list">${incoming.map(e => relItem(e.from, e.label, true)).join('')}</ul>
    </div>`;
  }

  if (outgoing.length > 0) {
    html += `<div class="rel-section">
      <div class="rel-heading">Outgoing (${outgoing.length})</div>
      <ul class="rel-list">${outgoing.map(e => relItem(e.to, e.label, false)).join('')}</ul>
    </div>`;
  }

  if (incoming.length === 0 && outgoing.length === 0) {
    html += `<div class="rel-section"><div class="rel-heading">No visible relationships</div></div>`;
  }

  detailsTitle.textContent = node.label;
  detailsContent.innerHTML = html;

  detailsContent.querySelectorAll('.rel-item[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (network) {
        network.selectNodes([id]);
        network.focus(id, { scale: 1.2, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
      }
      showNodeDetails(id);
    });
  });
}

function metaRow(label, value) {
  if (!value) return '';
  return `<div class="meta-row">
    <span class="meta-label">${label}</span>
    <span class="meta-value" title="${esc(String(value))}">${esc(String(value))}</span>
  </div>`;
}

function relItem(nodeId, relType, isIncoming) {
  const node = graphData.nodes.find(n => n.id === nodeId);
  const name = node ? node.label : nodeId.split(':').pop();
  const arrow = isIncoming ? '\u2190' : '\u2192';
  return `<li class="rel-item" data-id="${esc(nodeId)}">
    <span class="rel-arrow">${arrow}</span>
    <span class="rel-name">${esc(name)}</span>
    <span class="rel-type">${relType}</span>
  </li>`;
}

function clearDetails() {
  detailsTitle.textContent = 'Details';
  detailsContent.innerHTML = `<div class="placeholder-msg">
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
      <path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-7.07-2.83 2.83M9.76 14.24l-2.83 2.83m0-10.14 2.83 2.83m4.48 4.48 2.83 2.83"/>
    </svg>
    <p>Click a node to inspect</p>
  </div>`;
}

/* ── Search ───────────────────────────────────────── */
async function handleSearch(query) {
  if (!query) {
    clearDetails();
    if (network) network.unselectAll();
    return;
  }

  const q = query.toLowerCase();
  const matches = graphData.nodes.filter(n =>
    n.label.toLowerCase().includes(q) ||
    (n.file && n.file.toLowerCase().includes(q)) ||
    (n.package && n.package.toLowerCase().includes(q))
  );

  if (matches.length > 0 && network) {
    const ids = matches.map(n => n.id);
    network.selectNodes(ids.slice(0, 50));
    if (ids.length === 1) {
      network.focus(ids[0], { scale: 1.2, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    }
  }

  detailsTitle.textContent = `Search: ${query}`;
  if (matches.length === 0) {
    detailsContent.innerHTML = '<div class="placeholder-text">No matches in visible graph</div>';
    return;
  }

  let html = '';
  for (const n of matches.slice(0, 50)) {
    const colors = TYPE_COLORS[n.group] || { bg: '#64748b' };
    html += `<div class="search-result" data-id="${esc(n.id)}">
      <div class="search-result-name">
        <span class="detail-type-badge" style="background:${colors.bg}20;color:${colors.bg};font-size:9px">${n.group}</span>
        ${esc(n.label)}
      </div>
      <div class="search-result-meta">${esc(n.file || n.package || '')}</div>
    </div>`;
  }
  if (matches.length > 50) {
    html += `<div class="placeholder-text">${matches.length - 50} more results...</div>`;
  }
  detailsContent.innerHTML = html;

  detailsContent.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (network) {
        network.selectNodes([id]);
        network.focus(id, { scale: 1.2, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
      }
      showNodeDetails(id);
    });
  });
}

/* ── Processes View ──────────────────────────────── */
async function loadProcesses() {
  const container = $('processesContainer');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Detecting processes...</p></div>';

  try {
    const data = await post('/api/tools/recon_processes', { limit: 30 });
    const raw = data.result || '';
    processesLoaded = true;

    // Parse the raw text output into process cards
    const processes = parseProcesses(raw);

    if (processes.length === 0) {
      container.innerHTML = '<div class="no-results">No execution flows detected. Ensure your codebase has entry points (exported functions, handlers).</div>';
      return;
    }

    let html = '';
    for (let i = 0; i < processes.length; i++) {
      const p = processes[i];
      const delay = Math.min(i * 50, 500);
      html += `<div class="process-card" style="animation-delay:${delay}ms">
        <div class="process-header">
          <div class="process-label">${esc(p.label)}</div>
          <div class="process-tags">
            ${p.isCross ? '<span class="process-tag tag-cross">🔀 Cross</span>' : '<span class="process-tag tag-intra">📦 Intra</span>'}
            <span class="process-tag tag-complexity">⚡ ${p.steps.length} steps</span>
          </div>
        </div>
        <div class="process-steps">
          ${p.steps.map((s, idx) => `<span class="step-node">${esc(s)}</span>${idx < p.steps.length - 1 ? '<span class="step-arrow">→</span>' : ''}`).join('')}
        </div>
        ${p.community ? `<div class="process-community">📦 ${esc(p.community)}</div>` : ''}
      </div>`;
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="no-results">Failed to load processes: ${esc(err.message)}</div>`;
  }
}

function parseProcesses(raw) {
  const processes = [];
  const lines = raw.split('\n');
  let current = null;

  for (const line of lines) {
    // Process header: "1. 📦 label (N steps, complexity X) [community]" or "1. 🔀 label ..."
    const headerMatch = line.match(/^\d+\.\s*(📦|🔀)\s*(.+?)\s*\((\d+)\s*steps?/);
    if (headerMatch) {
      if (current) processes.push(current);
      current = {
        isCross: headerMatch[1] === '🔀',
        label: headerMatch[2].trim(),
        steps: [],
        community: '',
      };
      // Extract community
      const commMatch = line.match(/\[(.*?)\]/);
      if (commMatch) current.community = commMatch[1];
      continue;
    }

    // Step line: "   ① name → ② name → ..."  or just indented text with arrows
    if (current && line.trim().startsWith('`')) {
      // Code block trace
      const stepNames = line.replace(/`/g, '').split('→').map(s => s.replace(/^[①②③④⑤⑥⑦⑧⑨⑩\d.)\s]+/, '').trim()).filter(Boolean);
      if (stepNames.length > 0) current.steps = stepNames;
    } else if (current && line.includes('→') && !line.startsWith('#')) {
      const stepNames = line.split('→').map(s => s.replace(/^[\s①②③④⑤⑥⑦⑧⑨⑩\d.)\s`]+/, '').replace(/[`\s]+$/, '').trim()).filter(Boolean);
      if (stepNames.length > 1) current.steps = stepNames;
    }
  }
  if (current) processes.push(current);

  return processes.filter(p => p.steps.length > 0);
}

/* ── Impact Analysis View ────────────────────────── */
function setupImpact() {
  const btn = $('impactBtn');
  const input = $('impactTarget');

  btn.addEventListener('click', () => runImpact());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runImpact(); }
  });
}

async function runImpact() {
  const target = $('impactTarget').value.trim();
  const direction = $('impactDirection').value;
  const container = $('impactContainer');

  if (!target) {
    container.innerHTML = '<div class="no-results">Enter a symbol name above</div>';
    return;
  }

  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Analyzing impact...</p></div>';

  try {
    const data = await post('/api/tools/recon_impact', { target, direction });
    const raw = data.result || '';

    // Display as formatted result
    container.innerHTML = `<div class="impact-result">
      ${parseImpactRisk(raw)}
      <details>
        <summary style="cursor:pointer;color:var(--text-muted);font-size:11px;margin-top:12px">Show raw output</summary>
        <div class="impact-raw">${esc(raw)}</div>
      </details>
    </div>`;
  } catch (err) {
    container.innerHTML = `<div class="no-results">Error: ${esc(err.message)}</div>`;
  }
}

function parseImpactRisk(raw) {
  // Extract risk level
  let riskClass = 'risk-low';
  let riskIcon = '🟢';
  let riskLabel = 'LOW RISK';

  if (raw.includes('🔴') && raw.includes('CRITICAL')) {
    riskClass = 'risk-critical'; riskIcon = '🔴'; riskLabel = 'CRITICAL RISK';
  } else if (raw.includes('🟠') || raw.includes('HIGH')) {
    riskClass = 'risk-high'; riskIcon = '🟠'; riskLabel = 'HIGH RISK';
  } else if (raw.includes('🟡') || raw.includes('MEDIUM')) {
    riskClass = 'risk-medium'; riskIcon = '🟡'; riskLabel = 'MEDIUM RISK';
  }

  // Build depth groups from raw output
  const depthGroups = [];
  const depthRegex = /d=(\d+)[^(]*\(([^)]+)\)/g;
  let match;
  while ((match = depthRegex.exec(raw)) !== null) {
    depthGroups.push({ depth: match[1], description: match[2] });
  }

  let html = `<div class="impact-risk-banner ${riskClass}">
    <span class="impact-risk-icon">${riskIcon}</span>
    <span>${riskLabel}</span>
  </div>`;

  // Parse confidence summary
  const confMatch = raw.match(/Confidence:.*?(🔴\s*\d+.*?🟡\s*\d+.*?🟢\s*\d+[^)]*)/);
  if (confMatch) {
    html += `<div style="margin-bottom:12px;font-size:12px;color:var(--text-dim)">${esc(confMatch[1])}</div>`;
  }

  // Extract symbols per depth
  const sections = raw.split(/(?=d=\d)/);
  for (const section of sections) {
    const dMatch = section.match(/^d=(\d+)/);
    if (!dMatch) continue;
    const depth = dMatch[1];

    const labels = { '1': '🔴 WILL BREAK', '2': '🟡 LIKELY AFFECTED', '3': '🟢 MAY NEED TESTING' };
    const label = labels[depth] || `d=${depth}`;

    // Extract symbol names from the section
    const symbolLines = section.split('\n').filter(l => l.includes('│') || l.includes('|') || l.match(/^\s+\S/));

    html += `<div class="impact-depth-group">
      <div class="depth-header">
        <span class="depth-label">${label}</span>
        <span class="depth-count">${symbolLines.length} symbols</span>
      </div>
    </div>`;
  }

  return html;
}

/* ── Controls ─────────────────────────────────────── */
function setupControls() {
  fitBtn.addEventListener('click', () => {
    if (network) network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
  });

  physicsBtn.addEventListener('click', () => {
    physicsEnabled = !physicsEnabled;
    physicsBtn.classList.toggle('active', physicsEnabled);
    if (network) network.setOptions({ physics: { enabled: physicsEnabled } });
  });

  refreshBtn.addEventListener('click', loadGraph);

  typeFilter.addEventListener('change', loadGraph);
  limitSelect.addEventListener('change', loadGraph);

  communityToggle.addEventListener('change', () => {
    communityMode = communityToggle.checked;
    loadGraph();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch(searchInput.value.trim());
    }
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchInput.blur();
      handleSearch('');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

/* ── Utility ──────────────────────────────────────── */
function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

/* ── Init ─────────────────────────────────────────── */
async function init() {
  setupTabs();
  setupControls();
  setupImpact();
  await loadHealth();
  await loadGraph();
}

document.addEventListener('DOMContentLoaded', init);
