/* ── Recon Dashboard ─────────────────────────────── */
'use strict';

/* ── Node type colors ────────────────────────────── */
const TYPE_COLORS = {
  Package:   { bg: '#3b82f6', border: '#2563eb' },
  Module:    { bg: '#06b6d4', border: '#0891b2' },
  Function:  { bg: '#22c55e', border: '#16a34a' },
  Method:    { bg: '#14b8a6', border: '#0d9488' },
  Struct:    { bg: '#f59e0b', border: '#d97706' },
  Class:     { bg: '#f97316', border: '#ea580c' },
  Interface: { bg: '#a855f7', border: '#9333ea' },
  Trait:     { bg: '#c084fc', border: '#a855f7' },
  Component: { bg: '#ec4899', border: '#db2777' },
  Type:      { bg: '#eab308', border: '#ca8a04' },
  Enum:      { bg: '#ef4444', border: '#dc2626' },
  File:      { bg: '#64748b', border: '#475569' },
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
  CALLS:          'rgba(99,102,241,0.5)',
  IMPORTS:        'rgba(59,130,246,0.4)',
  HAS_METHOD:     'rgba(20,184,166,0.5)',
  IMPLEMENTS:     'rgba(168,85,247,0.5)',
  EXTENDS:        'rgba(192,132,252,0.5)',
  USES_COMPONENT: 'rgba(236,72,153,0.5)',
  CALLS_API:      'rgba(245,158,11,0.6)',
  CONTAINS:       'rgba(71,85,105,0.3)',
  DEFINES:        'rgba(71,85,105,0.3)',
};

/* ── State ───────────────────────────────────────── */
let network = null;
let graphData = { nodes: [], edges: [], stats: {} };
let physicsEnabled = true;
let selectedPkg = '';

/* ── DOM refs ────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const searchInput     = $('searchInput');
const headerStats     = $('headerStats');
const packageList     = $('packageList');
const pkgCount        = $('pkgCount');
const graphContainer  = $('graphContainer');
const loadingOverlay  = $('loadingOverlay');
const detailsTitle    = $('detailsTitle');
const detailsContent  = $('detailsContent');
const statusText      = $('statusText');
const typeFilter      = $('typeFilter');
const limitSelect     = $('limitSelect');
const fitBtn          = $('fitBtn');
const physicsBtn      = $('physicsBtn');
const refreshBtn      = $('refreshBtn');

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
      color: { background: colors.bg, border: colors.border,
               highlight: { background: colors.bg, border: '#fff' } },
      shape: TYPE_SHAPES[type] || 'dot',
      font: { color: '#e2e8f0' },
    };
  }

  const nodes = new vis.DataSet(data.nodes.map(n => ({
    id: n.id,
    label: n.label,
    group: n.group,
    title: tooltip(n),
    value: Math.max(n.value, 1),
    _meta: n,
  })));

  const edges = new vis.DataSet(data.edges.map(e => ({
    from: e.from,
    to: e.to,
    label: e.arrows ? undefined : e.label,
    color: { color: EDGE_COLORS[e.label] || 'rgba(100,116,139,0.3)',
             highlight: '#6366f1' },
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

/* ── Package sidebar ─────────────────────────────── */
function buildPackageSidebar() {
  const pkgs = new Map();
  for (const n of graphData.nodes) {
    const pkg = n.package || '(root)';
    pkgs.set(pkg, (pkgs.get(pkg) || 0) + 1);
  }

  const sorted = [...pkgs.entries()].sort((a, b) => b[1] - a[1]);
  pkgCount.textContent = sorted.length;

  // "All" item
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

  // Find relationships
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

  // Make relationship items clickable
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

  // Client-side: find matches in loaded graph
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

  // Show results in details panel
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

  // '/' keyboard shortcut to focus search
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
  setupControls();
  await loadHealth();
  await loadGraph();
}

document.addEventListener('DOMContentLoaded', init);
