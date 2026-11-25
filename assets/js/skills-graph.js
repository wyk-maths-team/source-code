// assets/js/skills-graph.js —— 技能星图（力导向）
//
// 数据：GET /api/skills?action=graph（skills 集合 + skill_edges）
// 布局：D3 force。parent 边拉得近、prereq 中等、related 松，
//       所以同一大类会自然聚成一团，前置关系跨类时才会拉出长线。
//
// 交互：滚轮缩放 / 拖背景平移 / 拖节点微调 / 点击看详情 / 搜索定位 / 图例过滤大类。

(function () {
  'use strict';

  var token = '';
  try { token = localStorage.getItem('auth_token') || ''; } catch (e) {}
  if (!token) { location.replace('/index.html'); return; }

  var PALETTE = {
    algebra: '#4a90d9',
    geometry: '#2dd4bf',
    'number-theory': '#f59e0b',
    combinatorics: '#a78bfa',
    discrete: '#fb7185',
    misc: '#94a3b8',
  };
  var FALLBACK = '#64748b';

  var svg = null, gRoot = null, zoom = null;
  var nodes = [], links = [], nodeSel = null, linkSel = null;
  var hiddenRoots = {};
  var activeId = null;

  function colorOf(d) {
    var root = String(d.id).split('.')[0];
    return PALETTE[root] || FALLBACK;
  }

  function radiusOf(d) {
    var base = d.level === 1 ? 15 : (d.level === 2 ? 9 : 6);
    return base + Math.min(6, Math.sqrt(Number(d.problems) || 0) * 0.35);
  }

  function labelOf(d) {
    var n = d.name || {};
    return n.zh || n.en || d.id;
  }

  function fail(msg) {
    var el = document.getElementById('sg-hint');
    if (el) { el.textContent = msg; el.style.color = '#f87171'; }
  }

  fetch('/api/skills?action=graph', { headers: { Authorization: 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.success) throw new Error((data && data.message) || 'load failed');
      boot(data);
    })
    .catch(function (e) { fail('Cannot load skill graph: ' + e.message); });

  function boot(data) {
    nodes = data.nodes.map(function (n) { return Object.assign({}, n); });

    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });

    links = [];
    nodes.forEach(function (n) {
      if (n.parent && byId[n.parent]) links.push({ source: n.parent, target: n.id, type: 'parent' });
    });
    (data.edges || []).forEach(function (e) {
      if (byId[e.from] && byId[e.to]) links.push({ source: e.from, target: e.to, type: e.type || 'related' });
    });

    // 去重：同一对 (from,to,type) 只留一条，否则力导向会被重复弹簧拉歪
    var seen = {};
    links = links.filter(function (l) {
      var key = l.source + '|' + l.target + '|' + l.type;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    var stats = data.stats || {};
    var statsEl = document.getElementById('sg-stats');
    if (statsEl) {
      statsEl.innerHTML = 'nodes <b>' + (stats.nodes || nodes.length) + '</b> · edges <b>'
        + (links.length) + '</b> · suggested <b>' + (stats.suggested || 0) + '</b>';
    }

    buildLegend(nodes);
    draw();
    wireSearch(nodes);
  }

  function buildLegend(list) {
    var box = document.getElementById('sg-legend');
    if (!box) return;
    var roots = list.filter(function (n) { return n.level === 1; });
    box.innerHTML = '';
    roots.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'sg-legend-row';
      row.innerHTML = '<span class="sg-dot" style="background:' + colorOf(r) + '"></span>'
        + '<span>' + (labelOf(r)) + '</span>';
      row.addEventListener('click', function () {
        hiddenRoots[r.id] = !hiddenRoots[r.id];
        row.classList.toggle('off', !!hiddenRoots[r.id]);
        applyFilter();
      });
      box.appendChild(row);
    });
  }

  function applyFilter() {
    if (!nodeSel) return;
    var q = (document.getElementById('sg-search').value || '').trim().toLowerCase();

    function visible(d) {
      var root = String(d.id).split('.')[0];
      if (hiddenRoots[root]) return false;
      if (!q) return true;
      var name = labelOf(d).toLowerCase();
      return d.id.toLowerCase().indexOf(q) >= 0 || name.indexOf(q) >= 0;
    }

    nodeSel.classed('dimmed', function (d) { return q ? !visible(d) : !!hiddenRoots[String(d.id).split('.')[0]]; });
    if (linkSel) {
      linkSel.classed('dimmed', function (l) {
        return !nodeSel.filter(function (n) { return n.id === (l.source.id || l.source); }).datum()
          .length || false;
      });
    }
  }

  function draw() {
    var W = window.innerWidth;
    var H = window.innerHeight;

    svg = d3.select('#sg-canvas').append('svg')
      .attr('viewBox', [0, 0, W, H].join(' '));

    var defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'sg-arrow')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 9)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', '#38bdf8')
      .attr('opacity', 0.55);

    gRoot = svg.append('g');

    zoom = d3.zoom()
      .scaleExtent([0.45, 3.2])
      .on('zoom', function (ev) {
        gRoot.attr('transform', ev.transform);
        // 缩得太小时二级标签会糊成一团，只留一级大类
        gRoot.classed('zoomed-out', ev.transform.k < 0.68);
      });
    svg.call(zoom).on('dblclick.zoom', null);

    var sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(function (d) { return d.id; })
        .distance(function (l) { return l.type === 'parent' ? 52 : (l.type === 'prereq' ? 105 : 150); })
        .strength(function (l) { return l.type === 'parent' ? 1 : 0.18; }))
      .force('charge', d3.forceManyBody().strength(function (d) { return d.level === 1 ? -900 : -170; }))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide().radius(function (d) { return radiusOf(d) + 5; }))
      .force('x', d3.forceX(W / 2).strength(0.02))
      .force('y', d3.forceY(H / 2).strength(0.02));

    linkSel = gRoot.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('class', function (l) { return 'sg-edge ' + l.type; })
      .attr('marker-end', function (l) { return l.type === 'prereq' ? 'url(#sg-arrow)' : null; });

    var nodeG = gRoot.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', function (d) {
        return 'sg-node l' + d.level + (d.status === 'suggested' ? ' suggested' : '');
      })
      .call(d3.drag()
        .on('start', function (ev, d) { if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', function (ev, d) { d.fx = ev.x; d.fy = ev.y; })
        .on('end', function (ev, d) { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    nodeSel = nodeG;

    nodeG.append('circle')
      .attr('r', function (d) { return radiusOf(d); })
      .attr('fill', function (d) { return colorOf(d); })
      .attr('fill-opacity', function (d) { return d.status === 'suggested' ? 0.45 : 0.88; });

    nodeG.append('title').text(function (d) { return labelOf(d) + '  (' + d.id + ')'; });

    nodeG.filter(function (d) { return d.level <= 2; })
      .append('text')
      .attr('class', 'sg-label')
      .attr('dx', function (d) { return radiusOf(d) + 6; })
      .attr('dy', 3.5)
      .text(labelOf);

    nodeG.on('click', function (ev, d) { ev.stopPropagation(); selectNode(d, sim); });
    svg.on('click', function () { clearSelection(); });

    // 力导向跑完自动把整张图放进视口 —— 否则最先出现的几个节点会占满屏幕
    var fitted = false;
    function fitToView() {
      if (fitted) return;
      fitted = true;
      try {
        var b = gRoot.node().getBBox();
        if (!b.width || !b.height) return;
        var k = Math.min(1.3, Math.max(0.5, Math.min(W / (b.width + 160), H / (b.height + 160))));
        var tx = W / 2 - k * (b.x + b.width / 2);
        var ty = H / 2 - k * (b.y + b.height / 2);
        svg.transition().duration(600)
          .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
      } catch (e) { /* 布局还没产生坐标时跳过 */ }
    }
    setTimeout(fitToView, 2600);
    sim.on('end', fitToView);

    sim.on('tick', function () {
      if (!fitted && sim.alpha() < 0.04) fitToView();
      linkSel
        .attr('x1', function (l) { return l.source.x; })
        .attr('y1', function (l) { return l.source.y; })
        .attr('x2', function (l) { return l.target.x; })
        .attr('y2', function (l) { return l.target.y; });
      nodeG.attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; });
    });

    window.__sg = { svg: svg, sim: sim, zoom: zoom, nodes: nodes, links: links };
  }

  function neighborsOf(id) {
    var set = {};
    set[id] = true;
    links.forEach(function (l) {
      var s = l.source.id || l.source;
      var t = l.target.id || l.target;
      if (s === id) set[t] = true;
      if (t === id) set[s] = true;
    });
    return set;
  }

  function selectNode(d, sim) {
    activeId = d.id;
    var keep = neighborsOf(d.id);
    nodeSel.classed('active', function (n) { return n.id === d.id; })
      .classed('dimmed', function (n) { return !keep[n.id]; });
    linkSel.classed('hl', function (l) {
      var s = l.source.id || l.source;
      var t = l.target.id || l.target;
      return s === d.id || t === d.id;
    }).classed('dimmed', function (l) {
      var s = l.source.id || l.source;
      var t = l.target.id || l.target;
      return !(s === d.id || t === d.id);
    });
    showDetail(d);
  }

  function clearSelection() {
    activeId = null;
    if (nodeSel) nodeSel.classed('active', false).classed('dimmed', false);
    if (linkSel) linkSel.classed('hl', false).classed('dimmed', false);
    var el = document.getElementById('sg-detail');
    if (el) el.classList.remove('open');
  }

  function showDetail(d) {
    var el = document.getElementById('sg-detail');
    if (!el) return;
    var parent = d.parent ? (labelOf((window.__sg.nodes || []).find(function (n) { return n.id === d.parent; }) || { name: {} }) || d.parent) : '—';
    var out = [];
    var inb = [];
    links.forEach(function (l) {
      var s = l.source.id || l.source;
      var t = l.target.id || l.target;
      if (s === d.id && l.type !== 'parent') out.push(t);
      if (t === d.id && l.type !== 'parent') inb.push(s);
    });

    el.innerHTML = ''
      + '<div class="sg-d-title">' + esc(labelOf(d)) + '</div>'
      + '<div class="sg-d-path">' + esc(d.id) + '</div>'
      + '<div class="sg-d-desc">' + esc(d.description || '（没有说明）') + '</div>'
      + '<div class="sg-d-row"><span>题目数</span><b>' + (d.problems || 0) + '</b></div>'
      + '<div class="sg-d-row"><span>父节点</span><b>' + esc(parent) + '</b></div>'
      + '<div class="sg-d-row"><span>前置</span><b>' + (inb.length ? inb.map(function (x) { return esc(x.split('.').pop()); }).join('、') : '—') + '</b></div>'
      + '<div class="sg-d-row"><span>后续</span><b>' + (out.length ? out.map(function (x) { return esc(x.split('.').pop()); }).join('、') : '—') + '</b></div>'
      + (d.status === 'suggested' ? '<span class="sg-d-badge suggested">suggested · 待复核</span>' : '');

    el.classList.add('open');
  }

  function wireSearch(list) {
    var input = document.getElementById('sg-search');
    if (!input) return;
    input.addEventListener('input', function () {
      applyFilter();
      var q = input.value.trim().toLowerCase();
      if (!q) return;
      var hit = list.find(function (n) {
        return n.id.toLowerCase().indexOf(q) >= 0 || (labelOf(n) || '').toLowerCase().indexOf(q) >= 0;
      });
      if (hit && svg) {
        var W = window.innerWidth, H = window.innerHeight;
        svg.transition().duration(420).call(
          zoom.transform,
          d3.zoomIdentity.translate(W / 2 - hit.x * 1.4, H / 2 - hit.y * 1.4).scale(1.4)
        );
      }
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
