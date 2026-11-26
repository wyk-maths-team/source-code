// assets/js/pages/my-skills.js —— 学生版技能图
//
// 和 /skills-graph（管理员那版）的区别：
//   · 嵌在内容区里，保留 topbar 与 sidebar
//   · 节点按「我的掌握情况」着色：做过并做对了 / 练过没做对 / 没碰过
//   · 不显示全库热度，只看自己

(function () {
  'use strict';

  if (!isLoggedIn()) { window.location.href = '/index.html'; return; }

  var canvas = document.getElementById('msCanvas');
  var empty = document.getElementById('msEmpty');
  var statsEl = document.getElementById('msStats');
  var subEl = document.getElementById('msSub');

  var COLORS = { known: '#2e9e6b', gap: '#d9534f', fresh: '#b8c2cc' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function label(n) {
    if (!n) return '';
    if (typeof n === 'string') return n;
    return n.zh || n.en || '';
  }

  async function load() {
    var graph, profile;
    try {
      var both = await Promise.all([
        apiCall('/api/skills?action=graph'),
        apiCall('/api/skills?action=profile'),
      ]);
      graph = both[0];
      profile = both[1];
    } catch (e) {
      empty.textContent = 'Could not load your skill map.';
      return;
    }
    if (!graph || !graph.nodes || !graph.nodes.length) {
      empty.textContent = 'No skill data yet.';
      return;
    }

    var status = {};                 // id -> 'known' | 'gap' | 'fresh'
    var skills = (profile && profile.skills) || {};
    var names = (profile && profile.names) || {};

    graph.nodes.forEach(function (n) {
      var st = skills[n.id];
      if (!st) status[n.id] = 'fresh';
      else if (st.solved > 0) status[n.id] = 'known';
      else status[n.id] = 'gap';
    });

    var known = 0, gap = 0, fresh = 0;
    Object.keys(status).forEach(function (k) {
      if (status[k] === 'known') known++;
      else if (status[k] === 'gap') gap++;
      else fresh++;
    });

    statsEl.innerHTML =
      '<div class="ms-stat"><b>' + (profile && profile.solvedCount || 0) + '</b><span>problems solved</span></div>' +
      '<div class="ms-stat"><b>' + known + '</b><span>skills you have used</span></div>' +
      '<div class="ms-stat"><b>' + gap + '</b><span>tried but never solved</span></div>' +
      '<div class="ms-stat"><b>' + fresh + '</b><span>not touched yet</span></div>';

    subEl.textContent = known
      ? 'Green nodes are skills you have already solved a problem with. Red ones you tried and never got right.'
      : 'You have not solved anything yet — the whole map is still grey.';

    draw(graph, status, names);
  }

  function draw(graph, status, names) {
    empty.style.display = 'none';

    var W = canvas.clientWidth || 900;
    var H = canvas.clientHeight || 560;

    var nodes = graph.nodes.map(function (n) {
      return {
        id: n.id,
        name: label(n.name) || names[n.id] || n.id,
        level: Number(n.level) || String(n.id).split('.').length,
        parent: n.parent || null,
        state: status[n.id] || 'fresh',
      };
    });
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });

    var links = [];
    nodes.forEach(function (n) {
      if (n.parent && byId[n.parent]) links.push({ source: n.parent, target: n.id });
    });
    (graph.edges || []).forEach(function (e) {
      if (byId[e.from] && byId[e.to]) links.push({ source: e.from, target: e.to });
    });

    var svg = d3.select(canvas).append('svg')
      .attr('viewBox', '0 0 ' + W + ' ' + H)
      .attr('width', '100%').attr('height', '100%');

    var root = svg.append('g');

    var zoom = d3.zoom().scaleExtent([0.4, 3]).on('zoom', function (ev) {
      root.attr('transform', ev.transform);
    });
    svg.call(zoom);

    var linkSel = root.append('g').selectAll('line').data(links).join('line').attr('class', 'ms-link');

    var nodeSel = root.append('g').selectAll('circle').data(nodes).join('circle')
      .attr('class', function (d) { return 'ms-node ' + d.state; })
      .attr('r', function (d) { return d.level === 1 ? 11 : (d.level === 2 ? 7.5 : 5); })
      .on('mouseenter', function (ev, d) {
        var mates = new Set([d.id]);
        links.forEach(function (l) {
          var s = l.source.id || l.source;
          var t = l.target.id || l.target;
          if (s === d.id) mates.add(t);
          if (t === d.id) mates.add(s);
        });
        nodeSel.classed('dim', function (n) { return !mates.has(n.id); });
        showTip(ev, d);
      })
      .on('mouseleave', function () {
        nodeSel.classed('dim', false);
        hideTip();
      });

    var tips = {};
    nodes.forEach(function (n) { tips[n.id] = n; });

    var labelSel = root.append('g').selectAll('text').data(nodes.filter(function (n) { return n.level <= 2; })).join('text')
      .attr('class', 'ms-label')
      .text(function (d) { return d.name; });

    var sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(function (d) { return d.id; }).distance(function (d) {
        return d.source.level === 1 ? 90 : 48;
      }).strength(0.7))
      .force('charge', d3.forceManyBody().strength(function (d) { return d.level === 1 ? -420 : -110; }))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide().radius(function (d) { return (d.level === 1 ? 16 : 9); }));

    sim.on('tick', function () {
      linkSel
        .attr('x1', function (d) { return d.source.x; })
        .attr('y1', function (d) { return d.source.y; })
        .attr('x2', function (d) { return d.target.x; })
        .attr('y2', function (d) { return d.target.y; });
      nodeSel.attr('cx', function (d) { return d.x; }).attr('cy', function (d) { return d.y; });
      labelSel.attr('x', function (d) { return d.x + (d.level === 1 ? 15 : 10); }).attr('y', function (d) { return d.y + 3; });
    });

    // 让整张图在第一次稳定后落进视口
    var fitted = false;
    function fit() {
      if (fitted) return;
      fitted = true;
      try {
        var b = root.node().getBBox();
        if (!b.width || !b.height) return;
        var k = Math.min(1.2, Math.max(0.45, Math.min(W / (b.width + 120), H / (b.height + 120))));
        var tx = W / 2 - k * (b.x + b.width / 2);
        var ty = H / 2 - k * (b.y + b.height / 2);
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
      } catch (e) {}
    }
    setTimeout(fit, 1800);
    sim.on('end', fit);

    var tip = document.createElement('div');
    tip.className = 'ms-tip';
    canvas.appendChild(tip);

    function showTip(ev, d) {
      var st = d.state === 'known' ? 'solved before' : (d.state === 'gap' ? 'tried, not solved' : 'not touched');
      tip.textContent = d.name + ' · ' + st;
      tip.style.display = 'block';
      var rect = canvas.getBoundingClientRect();
      tip.style.left = Math.min(ev.clientX - rect.left + 12, rect.width - 200) + 'px';
      tip.style.top = (ev.clientY - rect.top + 12) + 'px';
    }
    function hideTip() { tip.style.display = 'none'; }
  }

  load();
})();
