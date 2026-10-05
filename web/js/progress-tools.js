/*
 * progress-tools.js —— 本地版增强：进度的服务端持久化 / 导出 / 导入
 *
 * 原站的"已收集"状态只存在浏览器 localStorage（关浏览器/清数据/换浏览器都会丢）。
 * 本脚本三层保险：
 *   1) 服务端持久化：进度自动存到服务端的 data/progress.json（换浏览器/清缓存/换端口都不丢）
 *      - 载入时：若服务器副本比本机新（或本机为空）→ 自动拉回本地并刷新
 *      - 变更时：每 5 秒把进度 POST 到服务器（内容没变就跳过）；关闭页面用 sendBeacon 兜底
 *      - 服务器每次覆盖前会滚动备份旧版到 data/progress-backups/（保留最近 20 份）
 *   2) 导出进度：把全部本地进度存成一个 JSON 文件（自己留档）
 *   3) 导入进度：选一个之前导出的 JSON 恢复进度；导入前自动备份当前进度，
 *      导入后按国家显示恢复了多少个标记、并校验 ID 是否有效
 * 按钮以浮动面板形式出现在右下角，不干扰原界面。
 */
(function () {
  'use strict';

  var PANEL_ID = 'smo-progress-tools';
  var SYNC_AT = 'smo_sync_at';          // 最近一次成功同步到服务器的时间（不参与同步内容）
  var RESTORE_FLAG = 'smo_restored';    // sessionStorage：本次会话是否已从服务器恢复过（防循环刷新）
  var FORCE_PULL = 'smo_force_pull';    // sessionStorage：「从备份恢复→整份替换」后，本机也整份以服务器为准

  /* ---------- 守卫：原站(ng/app.js 的 H())会把"当前地图"的已收集标记写回 localStorage ----------
   * 它写的是 Angular 模型里的 found 状态，而模型只在页面加载时从 localStorage 读一次。
   * 于是"刚补回进度/刚导入就刷新"必然踩坑（2026-09-26 实测）：
   *   ① 全量补回时模型还是空的 → H() 写入空集 → removeItem 删掉默认地图（蘑菇王国 51 条）
   *   ② 只补一个国家时删掉的正是刚补回来的那个国家 → 刷新后又没了（死循环）
   * 两道守卫：
   *   守卫① window.onbeforeunload 包一层：正在补回/导入，或本图标记还没加载完 → 跳过原站写回
   *   守卫② localStorage.removeItem：非空的 found_marker_ids:* 只有在"本图模型已加载且确实
   *          一条都没勾"时才允许删（覆盖原站切图时 H(上一张图) 的误删路径）
   */
  var UNLOAD_SKIP = 'smo_skip_unload_save';   // sessionStorage：刚从服务器补回/导入过，刷新时别让原站插手
  var GUARD_NOTE = '';                        // 最近一次守卫动作（控制台可见）

  function suppressUnloadSave() {
    try { sessionStorage.setItem(UNLOAD_SKIP, String(Date.now())); } catch (e) {}
    try { window.onbeforeunload = null; } catch (e) {}
  }
  function unloadSuppressed() {
    try {
      var t = parseInt(sessionStorage.getItem(UNLOAD_SKIP) || '0', 10) || 0;
      return (Date.now() - t) < 15000;        // 只覆盖这次刷新；页面加载 2 秒后自动撤销
    } catch (e) { return false; }
  }

  /* 当前页面的 Angular 控制器：标记模型（body.cats / body.map）都在它身上 */
  function scopeBody() {
    try {
      if (!window.angular) return null;
      var el = document.querySelector('[ng-controller="BodyCtrl as body"]');
      var sc = el && window.angular.element(el).scope();
      return (sc && sc.body) || null;
    } catch (e) { return null; }
  }
  /* 模型是否已经"装好"了这张图 —— 装好了才有资格判断"用户是不是真的清空了" */
  function modelLoadedFor(mapId) {
    var b = scopeBody();
    if (!b || !b.map || String(b.map.map_id) !== String(mapId)) return false;
    return !!(b.cats && b.cats.length);
  }
  function modelFoundCount() {
    var b = scopeBody(), n = 0;
    if (!b || !b.cats) return 0;
    b.cats.forEach(function (c) {
      (c.markers || []).forEach(function (m) { if (m.options && m.options.found) n++; });
    });
    return n;
  }
  function guardNote(msg) {
    GUARD_NOTE = msg;
    try { console.log('[SMO 守卫] ' + msg); } catch (e) {}
  }

  (function installGuards() {
    /* 守卫①：window.onbeforeunload */
    function wrapUnload(fn) {
      if (typeof fn !== 'function') return fn;
      return function (ev) {
        try {
          if (unloadSuppressed()) { guardNote('跳过 onbeforeunload 写入（正在从服务器补回/导入）'); return; }
          var b = scopeBody();
          if (!b || !b.cats || !b.cats.length) { guardNote('跳过 onbeforeunload 写入（本图标记未加载完）'); return; }
        } catch (e) {}
        return fn.apply(this, arguments);
      };
    }
    var raw = window.onbeforeunload;
    try {
      Object.defineProperty(window, 'onbeforeunload', {
        configurable: true,
        get: function () { return raw; },
        set: function (fn) { raw = wrapUnload(fn); }
      });
      if (typeof raw === 'function') { var f = raw; raw = null; window.onbeforeunload = f; }
    } catch (e) {
      if (typeof raw === 'function') window.onbeforeunload = wrapUnload(raw);
    }

    /* 守卫②：localStorage.removeItem */
    try {
      var origRemove = localStorage.removeItem.bind(localStorage);
      localStorage.removeItem = function (k) {
        try {
          var m = /^found_marker_ids:(\d+)$/.exec(String(k == null ? '' : k));
          if (m) {
            var cur = null;
            try { cur = localStorage.getItem(k); } catch (e2) {}
            if (cur && String(cur).trim() && !(modelLoadedFor(m[1]) && modelFoundCount() === 0)) {
              guardNote('拦住删除 地图' + m[1] + ' 的进度（' + cur.split(',').length + ' 条；模型未确认已清空）');
              return;
            }
          }
        } catch (e3) {}
        return origRemove.apply(localStorage, arguments);
      };
    } catch (e) {}

    /* 守卫③：localStorage.setItem —— 别把「上一张图的 ID」写进这一张图的记录里 */
    try {
      var origSet = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (k, v) {
        try {
          var m = /^found_marker_ids:(\d+)$/.exec(String(k == null ? '' : k));
          if (m) {
            var ids = idsOf(v);
            var f = foreignCount(m[1], ids);
            if (ids.length && f > 0 && f > ids.length / 2) {
              guardNote('拦住错位写入 地图' + m[1] + '：' + f + '/' + ids.length + ' 个标记不属于这张图（切图瞬间的上一张图数据）');
              try { window.__smoMapInfo = '拦下一次错位写入（地图 ' + m[1] + '）'; } catch (e4) {}
              return;
            }
          }
        } catch (e5) {}
        return origSet.apply(localStorage, arguments);
      };
    } catch (e) {}
  })();

  /* 刷新完成后（2 秒）撤掉"跳过"标记，之后的正常关闭/刷新照旧由原站保存 */
  if (unloadSuppressed()) {
    setTimeout(function () { try { sessionStorage.removeItem(UNLOAD_SKIP); } catch (e) {} }, 2000);
  }


  /* ---------- 进度收集 ---------- */

  function collectData() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k === SYNC_AT) continue;          // 同步时间戳本身不算进度
      var v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    }
    return data;
  }

  function snapshot() {
    return {
      _app: 'SMO-Map-Local',
      _version: 2,
      _exported_at: new Date().toISOString(),
      data: collectData()
    };
  }

  function signature(data) {
    try { return JSON.stringify(data, Object.keys(data).sort()); } catch (e) { return ''; }
  }

  function summarize() {
    var maps = 0, found = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('found_marker_ids:') === 0) {
        maps++;
        var v = localStorage.getItem(k) || '';
        v.split(',').forEach(function (s) { if (s.trim()) found++; });
      }
    }
    return { maps: maps, found: found };
  }
  /* 每个国家「有数据的记录数」：{ '11': 84, ... }（count>0 才出现） */
  function localProgressCounts() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      var m = k.match(/^found_marker_ids:(\d+)$/);
      if (!m) continue;
      var n = String(localStorage.getItem(k) || '').split(',')
        .filter(function (s) { return s.trim(); }).length;
      if (n > 0) out[m[1]] = n;
    }
    return out;
  }

  /* 从一份存档的 data 字段算出每个国家的记录数（推送前比对用） */
  function countsFromDoc(docData) {
    var out = {};
    if (!docData) return out;
    Object.keys(docData).forEach(function (k) {
      var m = k.match(/^found_marker_ids:(\d+)$/);
      if (!m) return;
      var n = String(docData[k] || '').split(',').filter(function (s) { return s.trim(); }).length;
      if (n > 0) out[m[1]] = n;
    });
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- 服务端持久化 ---------- */

  var lastPushed = null;     // 最近一次成功推送的数据签名
  var syncState = '';        // 面板上显示的同步状态
  var restoreChecked = false;  // 是否已完成载入时的"服务器→本地"检查
  var serverHasData = false;   // 服务器上确实存有进度（防止本机空状态把它覆盖掉）
  var baseline = null;            // 载入时（服务器 ∪ 本机）每个国家的记录数：用来发现"本次会话内的删除"
  var pendingDeletion = [];       // 待确认的删除 [{id, n}]
  var deletionConfirmed = false;  // 用户已确认删除（本次会话内不再拦）
  var MAP_NAMES = {};             // map_id → 中文国名
  var noticeBox = null;           // 面板里的提示框/备份列表容器
  var noticeMode = '';            // 提示框当前用途：'' | 'info' | 'warn' | 'list'
  var RESTORE_NOTE = 'smo_restore_note';   // sessionStorage：刚补回了哪些国家（刷新后提示一次）
  var serverProgress = null;      // 最近一次已知的"服务器存档"各国记录数：推送前比对它
  var deletionSig = '';           // 已展示的删除警告签名（避免每 5 秒重建提示框、按钮点不动）

  function pushToServer(force, cb) {
    // 载入时先让 restoreFromServer 跑完，否则空的本机状态会抢先覆盖服务器副本
    if (!force && !restoreChecked) { if (cb) cb({ ok: false, skipped: true }); return; }
    var data = collectData();
    var sig = signature(data);
    if (!force && sig === lastPushed) { if (cb) cb({ ok: true, skipped: true }); return; }
    // 本机一个进度记录都没有，而服务器上有 → 只拉不推（清缓存后不会把存档抹掉）
    if (!force && summarize().maps === 0 && serverHasData) {
      syncState = '☁ 本机无进度，保留服务器存档';
      if (cb) cb({ ok: false, skipped: true });
      return;
    }
    // 防呆（2026-09-25 加）：这次推送会把某个国家的记录整条删掉吗？
    // 载入时（服务器 ∪ 本机）有数据、现在没了 = 本次会话里被清空（例如误点"重置标记"、
    // 或切图时标记还没加载完）。直接推上去服务器存档里就永久消失了 → 先暂停同步让用户确认。
    if (!deletionConfirmed) {
      // 比对"最近一次已知的服务器存档"（拿不到就退化为载入时的本机状态）
      var known = serverProgress || baseline || localProgressCounts();
      var nowCounts = localProgressCounts();
      var gone = [];
      Object.keys(known).forEach(function (id) {
        if (!nowCounts[id]) gone.push({ id: id, n: known[id] });
      });
      if (gone.length) {
        pendingDeletion = gone;
        syncState = '⚠️ 已暂停同步（有国家将被删除）';
        var dSig = gone.map(function (g) { return g.id + ':' + g.n; }).join(',');
        if (dSig !== deletionSig) {          // 只在内容变化时重建，否则每 5 秒重建会把按钮点掉
          deletionSig = dSig;
          showDeletionWarning();
        }
        if (cb) cb({ ok: false, blocked: true });
        return;
      }
    }
    // 防呆（2026-09-26 加）：本机某国的记录是「别国的 ID」（切图瞬间错写）→ 先别推，
    // 否则会把错位数据写进服务器存档，把好存档也带坏（实测 13:48:15 那次就是这么坏的）。
    var misaligned = [];
    Object.keys(data).forEach(function (k) {
      var mk = /^found_marker_ids:(\d+)$/.exec(k);
      if (mk && isForeignKey(mk[1], data[k])) misaligned.push(mk[1]);
    });
    if (misaligned.length) {
      syncState = '⚠️ 已暂停同步（国家 ' + misaligned.join('、') + ' 的记录与地图不匹配）';
      if (cb) cb({ ok: false, blocked: true });
      return;
    }
    fetch('/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _app: 'SMO-Map-Local', _version: 2, data: data })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j && j.error === 0) {
        lastPushed = sig;
        serverProgress = localProgressCounts();   // 服务器现在 == 刚推上去的这份
        try { localStorage.setItem(SYNC_AT, j.saved_at || ''); } catch (e) {}
        syncState = '☁ ' + (j.maps || 0) + ' 图已存盘';
        if (cb) cb({ ok: true, maps: j.maps });
      } else {
        syncState = '☁ 同步被拒';
        if (cb) cb({ ok: false });
      }
    }).catch(function (e) {
      syncState = '☁ 未连服务器';
      if (cb) cb({ ok: false, error: e });
    });
  }

  /* 载入时：服务器副本比本机新（或本机为空）就拉回本地。 */
  function restoreFromServer() {
    function done() {
      // 载入时的"服务器 ∪ 本机"状态作为基线：此后任何国家整条消失都算本次会话内的删除
      if (baseline === null) baseline = localProgressCounts();
      restoreChecked = true;
    }
    if (!window.fetch) { done(); return; }
    fetch('/progress').then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      done();
      // 成功时返回的是存盘文档本身（没有 error 字段）；文件不存在时是 {error:-1,data:null}
      if (!j || j.error === -1 || !j.data || typeof j.data !== 'object') return;
      // 服务器上是否真的存有进度（有才需要保护，避免被本机空状态覆盖）
      serverHasData = Object.keys(j.data).some(function (k) {
        return k.indexOf('found_marker_ids:') === 0 && String(j.data[k] || '').trim() !== '';
      });
      var serverAt = String(j._saved_at || '');
      // 记录服务器现状（推送前比对用）
      serverProgress = countsFromDoc(j.data);
      // 补缺节流：距上次补缺不足 8 秒就跳过（防刷新循环）；单会话最多 8 次（防病态循环）
      var lastPull = 0, pullTimes = 0;
      try {
        var flag = String(sessionStorage.getItem(RESTORE_FLAG) || '');
        var parts = flag.split(':');
        lastPull = parseInt(parts[0], 10) || 0;
        pullTimes = parseInt(parts[1], 10) || 0;
      } catch (e) {}
      if (pullTimes >= 8 || (Date.now() - lastPull) < 8000) return;
      /* 恢复策略（2026-09-25 改）：按国家逐键补缺，而不是"本机全空才拉"。
       * 旧逻辑只要本机还有别的国家有进度就整份保持本机 —— 本机缺的那个国家既补不回来，
       * 还会被随后的一次整份推送从服务器上抹掉（海之国 84 条就是这么丢的）。 */
      var localEmpty = summarize().maps === 0;   // 本机完全没有进度：整体以服务器为准
      var forcePull = false;
      try { forcePull = sessionStorage.getItem(FORCE_PULL) === '1'; } catch (e) {}
      // 自愈（2026-09-26 加）：本机某国的记录若是「别国的 ID」（切图瞬间错写）就是坏的 ——
      // 只要服务器那份是好的，就用服务器的覆盖本机这条，否则地图上那些勾永远不会显示。
      // 判定要用到该图的合法 ID 表，所以先把涉及到的地图表取齐，再决定拉哪些键。
      var needTbl = [];
      Object.keys(j.data).forEach(function (k) {
        var m0 = k.match(/^found_marker_ids:(\d+)$/);
        if (!m0) return;
        var cur0 = null;
        try { cur0 = localStorage.getItem(k); } catch (e) {}
        if (cur0 && String(cur0).trim() && cur0 !== j.data[k]) needTbl.push(m0[1]);
      });
      ensureIdTables(needTbl, function () {
      var changed = 0, pulled = [], healed = [];
      Object.keys(j.data).forEach(function (k) {
        if (k === SYNC_AT) return;
        var v = j.data[k];
        if (v == null) return;
        var isProgress = k.indexOf('found_marker_ids:') === 0 || k.indexOf('hidden_cat_ids:') === 0;
        var cur = null;
        try { cur = localStorage.getItem(k); } catch (e) {}
        var srvHas = String(v).trim() !== '';
        var curEmpty = cur === null || String(cur).trim() === '';
        var take;
        if (isProgress) {
          // 本机这条国家没有记录而服务器有 → 补回来；本机已有记录 → 保持本机（不拿旧存档覆盖本机的）
          var mm = k.match(/^found_marker_ids:(\d+)$/);
          var curBad = !!(!curEmpty && mm && isForeignKey(mm[1], cur));
          var srvBad = !!(mm && isForeignKey(mm[1], v));
          take = srvHas && (localEmpty || curEmpty || forcePull || (curBad && !srvBad)) && cur !== v;
          if (take && mm) { pulled.push(mm[1]); if (curBad) healed.push(mm[1]); }
        } else {
          take = curEmpty && v !== '';             // 其他键（settings/map_id…）：只补缺
        }
        if (take) { try { localStorage.setItem(k, v); changed++; } catch (e) {} }
      });
      if (changed) {
        try {
          sessionStorage.setItem(RESTORE_FLAG, Date.now() + ':' + (pullTimes + 1));
          localStorage.setItem(SYNC_AT, serverAt);
          sessionStorage.setItem(RESTORE_NOTE, JSON.stringify({ at: serverAt, maps: pulled, healed: healed }));
          if (forcePull) sessionStorage.removeItem(FORCE_PULL);
        } catch (e) {}
        suppressUnloadSave();
        location.reload();
      }
      });
    }).catch(function () { done(); /* 旧版服务器无此端点：静默跳过 */ });
  }

  /* 关闭页面前的最后一道保险（sendBeacon 在页面卸载时也能发出去） */
  function beaconSave() {
    try {
      // 有未确认的删除时宁可不推：页面关闭前也要守住服务器存档
      if (!deletionConfirmed) {
        var bl = serverProgress || baseline || localProgressCounts();
        var nowC = localProgressCounts();
        for (var id in bl) { if (!nowC[id]) return; }
      }
      var data = collectData();
      if (signature(data) === lastPushed) return;
      if (!navigator.sendBeacon) return;
      var blob = new Blob([JSON.stringify({ _app: 'SMO-Map-Local', _version: 2, data: data })],
        { type: 'application/json' });
      navigator.sendBeacon('/progress', blob);
    } catch (e) { /* 静默 */ }
  }

  function refreshCount(el) {
    var s = summarize();
    el.textContent = '已标记 ' + s.found + ' 个 · ' + s.maps + ' 张地图有记录'
      + (syncState ? '  ' + syncState : '')
      + (window.__smoMapInfo ? '  (' + window.__smoMapInfo + ')' : '');
    el.title = '进度会自动存到服务端的 data/progress.json —— 换浏览器 / 清缓存 / 换端口都不会丢';
  }

  /*
   * 自动保存兜底：原站只在"切换地图 / 关闭页面"时才把已收集状态写入
   * localStorage（依赖 onbeforeunload），浏览器异常退出就会丢。这里每 2 秒
   * 从 Angular 控制器里读取当前地图的已收集标记，主动写入 localStorage。
   * 注意：数据未加载完（cats 为空）时静默跳过，绝不误删已有记录。
   */
  function autosave() {
    try {
      if (!window.angular) return;
      var el = document.querySelector('[ng-controller="BodyCtrl as body"]') || document.body;
      var sc = window.angular.element(el).scope();
      var b = sc && sc.body;
      if (!b || !b.cats || !b.cats.length || !b.map || b.map.map_id == null) return;
      var total = 0, ids = [], hidden = [];
      b.cats.forEach(function (c) {
        if (c.hidden) hidden.push(c.cat_id);
        (c.markers || []).forEach(function (m) {
          total++;
          if (m.options && m.options.found && m.options.marker_id != null) {
            ids.push(m.options.marker_id);
          }
        });
      });
      if (total === 0) return;                       // 没数据，别动 localStorage
      var kf = 'found_marker_ids:' + b.map.map_id;
      var kh = 'hidden_cat_ids:' + b.map.map_id;
      // 本图一条"已找到"都没报，但 localStorage 里本来有记录 → 多半是标记还没加载完
      // （切图/重载的瞬间就是这样），绝不能当成"用户清空了"去抹掉它。
      var prev = null;
      try { prev = localStorage.getItem(kf); } catch (e) {}
      if (!ids.length && prev && prev.trim()) {
        window.__smoMapInfo = '本图数据未就绪，跳过保存';
        return;
      }
      // 模型里的这些标记到底属不属于这张图？（切图瞬间 b.map 已换、b.cats 还是上一张图）
      if (ids.length) {
        var fg = foreignCount(b.map.map_id, ids);
        if (fg < 0) {
          ID_TABLE_WAITS++;
          window.__smoMapInfo = '本图标记表加载中，本次跳过保存';
          if (ID_TABLE_WAITS < 4) return;          // 拿不到表就一直不保存也不行（约 8 秒后退回旧行为）
        } else if (fg > ids.length / 2) {
          window.__smoMapInfo = '模型与地图不匹配（' + fg + '/' + ids.length + ' 个标记不属于本图），已跳过保存';
          return;
        }
      }
      ID_TABLE_WAITS = 0;
      if (ids.length) localStorage.setItem(kf, ids.join(',')); else localStorage.removeItem(kf);
      if (hidden.length) localStorage.setItem(kh, hidden.join(',')); else localStorage.removeItem(kh);
      window.__smoMapInfo = '本图 ' + total + ' 个标记';
    } catch (e) { /* 静默：不影响主界面 */ }
  }

  /* ---------- 导出 / 导入 ---------- */

  function exportProgress() {
    var data = snapshot();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var name = 'smo-progress-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
      + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* map_id → 中文国名（用 maps.json 的 i18n key 去 i18n_zh-Hans.json 查） */
  var NAME_CACHE = null;
  function mapNames() {
    if (NAME_CACHE) return Promise.resolve(NAME_CACHE);
    return Promise.all([
      fetch('data/maps.json').then(function (r) { return r.json(); }),
      fetch('data/i18n_zh-Hans.json').then(function (r) { return r.json(); }).catch(function () { return {}; })
    ]).then(function (res) {
      var maps = (res[0] && res[0].data) || [];
      var i18n = (res[1] && res[1].data) || {};
      var out = {};
      maps.forEach(function (m) {
        var key = m.name_i18n && m.name_i18n.key;
        out[String(m.map_id)] = (key && i18n[key]) || m.name || ('地图 ' + m.map_id);
      });
      NAME_CACHE = out;
      return out;
    }).catch(function () { NAME_CACHE = {}; return {}; });
  }

  /* 本地该地图的全部 marker_id（用来校验导入文件里的 ID 是否有效） */
  function localMarkerIds(mapId) {
    return fetch('/categories?map_id=' + encodeURIComponent(mapId))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var set = {};
        (((j || {}).data) || []).forEach(function (c) {
          (c.m_markers || []).forEach(function (m) {
            if (m.marker_id != null) set[String(m.marker_id)] = 1;
          });
        });
        return set;
      }).catch(function () { return null; });
  }

  /* ---------- 标记归属校验（2026-09-26 加）-----------------------------------
   * 切图的瞬间，Angular 里 b.map.map_id 已经是新地图，而 b.cats 还是上一张图的标记。
   * 这时写 localStorage 就会把「上一张图的 ID」记到新地图名下（实测 13:48：蘑菇王国的
   * 记录被写成了帽子国的 29 个 ID，地图上就一个勾都不显示）。
   * 所以凡是要写 found_marker_ids:N，都先拿这张图的合法 ID 表核对一遍：
   * 大部分 ID 都不属于本图 = 错位写入，拦住。表按地图缓存，未就绪返回 -1（未知，放行）。 */
  var MAP_ID_TABLE = null;               // map_id → { marker_id: 1 }
  var MAP_ID_BUSY = {};
  var ID_TABLE_WAITS = 0;                // 表没就绪时连续跳过的次数（超限退回旧行为，不卡死保存）

  function idTableFor(mapId, cb) {
    if (!MAP_ID_TABLE) return;                       // 脚本刚载入、缓存还没建好
    if (MAP_ID_TABLE[mapId]) { if (cb) cb(MAP_ID_TABLE[mapId]); return; }
    if (MAP_ID_BUSY[mapId]) return;
    MAP_ID_BUSY[mapId] = true;
    localMarkerIds(mapId).then(function (set) {
      delete MAP_ID_BUSY[mapId];
      if (set && Object.keys(set).length) { MAP_ID_TABLE[mapId] = set; if (cb) cb(set); }
    });
  }
  /* 这些 ID 里有多少个不属于 mapId；表未就绪返回 -1（= 未知） */
  function foreignCount(mapId, ids) {
    var set = MAP_ID_TABLE && MAP_ID_TABLE[mapId];
    if (!set || !Object.keys(set).length) { idTableFor(mapId); return -1; }   // 表空/没有 = 未知，放行
    var n = 0;
    for (var i = 0; i < ids.length; i++) { if (!set[String(ids[i])]) n++; }
    return n;
  }
  function idsOf(value) {
    return String(value == null ? '' : value).split(',')
      .filter(function (s) { return s.trim() !== ''; });
  }
  /* 这条记录是不是「错位」的（过半 ID 不属于该图） */
  function isForeignKey(mapId, value) {
    var ids = idsOf(value);
    if (!ids.length) return false;
    var f = foreignCount(mapId, ids);
    return f > 0 && f > ids.length / 2;
  }
  /* 把这批地图的 ID 表取齐后再回调（失败也回调，保证流程不卡死） */
  function ensureIdTables(mapIds, cb) {
    if (!MAP_ID_TABLE) MAP_ID_TABLE = {};
    var need = [];
    mapIds.forEach(function (id) {
      if (id && !MAP_ID_TABLE[id] && need.indexOf(id) < 0) need.push(id);
    });
    if (!need.length) { cb(); return; }
    Promise.all(need.map(function (id) {
      return localMarkerIds(id).then(function (set) { if (set && Object.keys(set).length) MAP_ID_TABLE[id] = set; });
    })).then(function () { cb(); }, function () { cb(); });
  }

  function importProgress(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try {
        obj = JSON.parse(reader.result);
      } catch (e) {
        alert('导入失败：不是有效的 JSON 文件\n' + e.message);
        return;
      }
      var data = obj && obj.data;
      if (!data || typeof data !== 'object') {
        alert('导入失败：文件里没有 data 字段（请选择本工具导出的 smo-progress-*.json）');
        return;
      }
      // 导入前先把当前进度存到服务器 = 自动备份（旧版会进 progress-backups/）
      pushToServer(true, function () { applyImport(data); });
    };
    reader.readAsText(file);
  }

  function applyImport(data) {
    var mapsInFile = [];
    Object.keys(data).forEach(function (k) {
      var m = k.match(/^found_marker_ids:(\d+)$/);
      if (m) mapsInFile.push(m[1]);
    });

    var written = 0;
    Object.keys(data).forEach(function (k) {
      if (k.indexOf('found_marker_ids:') === 0 || k.indexOf('hidden_cat_ids:') === 0
        || k === 'settings' || k === 'map_id') {
        try { localStorage.setItem(k, data[k]); written++; } catch (e) {}
      }
    });

    var jobs = [mapNames()].concat(mapsInFile.map(function (id) {
      return localMarkerIds(id).then(function (set) { return { id: id, set: set }; });
    }));

    Promise.all(jobs).then(function (res) {
      var names = res[0] || {};
      var details = res.slice(1).sort(function (a, b) { return a.id - b.id; });
      var lines = [], total = 0, bad = [];
      details.forEach(function (d) {
        var ids = String(data['found_marker_ids:' + d.id] || '')
          .split(',').filter(function (s) { return s.trim(); });
        total += ids.length;
        var name = names[d.id] || ('地图 ' + d.id);
        var ok = d.set === null ? ids.length
          : ids.filter(function (x) { return d.set[String(x)]; }).length;
        var tag = d.set === null ? ''
          : (ok === ids.length ? ' ✅ 全部有效' : ' ⚠️ ' + (ids.length - ok) + ' 个 ID 本地不存在');
        if (d.set !== null && ok !== ids.length) bad.push(name);
        lines.push('  • ' + name + '：' + ids.length + ' 个标记' + tag);
      });
      var totalMaps = Object.keys(names).length || 16;
      var msg = '导入完成：共恢复 ' + total + ' 个标记，涉及 ' + details.length + ' 个国家\n\n'
        + lines.join('\n') + '\n\n'
        + '当前进度已自动备份到服务器 progress-backups/（导入前的状态可找回）。\n'
        + '提示：地图只显示当前国家的标记，切到对应国家才能看到；文件里没有数据的国家共 '
        + Math.max(0, totalMaps - details.length) + ' 个。\n'
        + (bad.length ? '⚠️ 以下国家的部分 ID 对不上本地数据：' + bad.join('、') + '\n' : '')
        + '\n页面将刷新。';
      alert(msg);
      suppressUnloadSave();
      location.reload();
    }).catch(function () {
      alert('导入完成：已写入 ' + written + ' 项记录。\n页面将刷新。');
      suppressUnloadSave();
      location.reload();
    });
  }

  /* ---------- 面板提示框 / 备份恢复（2026-09-25 加） ---------- */

  function showNotice(html, mode) {
    if (!noticeBox) return;
    noticeMode = mode || 'info';
    noticeBox.innerHTML = html;
    noticeBox.classList.add('show');
    noticeBox.classList.toggle('ok', noticeMode === 'info');
  }

  function hideNotice() {
    if (!noticeBox) return;
    noticeMode = '';
    noticeBox.classList.remove('show');
    noticeBox.classList.remove('ok');
    noticeBox.innerHTML = '';
  }

  function renderDeletionWarning() {
    if (!noticeBox) return;
    if (!pendingDeletion.length) { hideNotice(); return; }
    var txt = pendingDeletion.map(function (g) {
      return '<b>' + esc(MAP_NAMES[g.id] || ('地图 ' + g.id)) + '</b> ' + g.n + ' 条';
    }).join('、');
    showNotice('⚠️ <b>已暂停同步</b>：这次推送会把 ' + txt
      + ' 从服务器存档里整条删除（存档文件已保留原样）。'
      + '<div class="smo-pt-nrow">'
      + '<button type="button" class="smo-pt-nbtn smo-pt-ncancel">取消（刷新并恢复）</button>'
      + '<button type="button" class="smo-pt-nbtn smo-pt-ndel">确认删除</button>'
      + '</div>', 'warn');
    noticeBox.querySelector('.smo-pt-ncancel').onclick = function () {
      try { sessionStorage.setItem(RESTORE_FLAG, '0'); } catch (e) {}   // 允许重新从服务器拉取
      deletionSig = '';
      suppressUnloadSave();
      location.reload();
    };
    noticeBox.querySelector('.smo-pt-ndel').onclick = function () {
      var lines = pendingDeletion.map(function (g) {
        return '· ' + (MAP_NAMES[g.id] || ('地图 ' + g.id)) + '：' + g.n + ' 条';
      }).join('\n');
      if (!confirm('真的要删除这些记录吗？\n\n' + lines
        + '\n\n删除前的存档会自动备份到 progress-backups/，之后可用「从备份恢复」找回。')) return;
      deletionConfirmed = true;
      deletionSig = '';
      pendingDeletion.forEach(function (g) { if (baseline) delete baseline[g.id]; });
      pendingDeletion = [];
      hideNotice();
      pushToServer(true);
    };
  }

  function showDeletionWarning() {
    renderDeletionWarning();
    mapNames().then(function (names) { MAP_NAMES = names; renderDeletionWarning(); });
  }

  function fmtTime(s) {
    var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? (m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5]) : String(s || '?');
  }

  function openBackupList() {
    if (!noticeBox) return;
    showNotice('读取备份列表…', 'list');
    fetch('/progress/backups').then(function (r) { return r.json(); }).then(function (j) {
      var items = (j && j.items) || [];
      var cur = j && j.current;
      var close = '<div class="smo-pt-nrow"><button type="button" class="smo-pt-nbtn smo-pt-nclose">关闭</button></div>';
      if (!items.length) {
        showNotice('服务器上还没有备份。' + close, 'list');
        noticeBox.querySelector('.smo-pt-nclose').onclick = hideNotice;
        return;
      }
      var head = '服务器滚动备份' + (cur ? '（当前存档：' + cur.maps + ' 国 / ' + cur.markers + ' 标记）' : '');
      var rows = items.slice(0, 10).map(function (it) {
        return '<div class="smo-pt-brow">'
          + '<span class="smo-pt-btime">' + esc(fmtTime(it.saved_at)) + '</span>'
          + '<span class="smo-pt-bmeta">' + it.maps + ' 国 / ' + it.markers + ' 标记</span>'
          + '<button type="button" class="smo-pt-nbtn smo-pt-bdo" data-name="' + esc(it.name)
          + '" data-mode="merge" title="只把当前存档里缺失的国家补回来，已有记录不动">补回缺失</button>'
          + '<button type="button" class="smo-pt-nbtn smo-pt-bdo" data-name="' + esc(it.name)
          + '" data-mode="replace" title="整份替换成这份备份（当前存档会先自动备份）">整份替换</button>'
          + '</div>';
      }).join('');
      showNotice('<div class="smo-pt-bhead">' + head + '</div>' + rows + close, 'list');
      noticeBox.querySelector('.smo-pt-nclose').onclick = hideNotice;
      var btns = noticeBox.querySelectorAll('.smo-pt-bdo');
      for (var i = 0; i < btns.length; i++) {
        btns[i].onclick = function () {
          var name = this.getAttribute('data-name');
          var mode = this.getAttribute('data-mode');
          var what = mode === 'merge'
            ? '把这份备份里「当前存档缺失的国家」补回来'
            : '把整份存档替换成这份备份（备份里没有的国家会消失）';
          if (!confirm(what + '？\n\n' + name + '\n（恢复前会自动备份当前存档）')) return;
          applyBackup(name, mode);
        };
      }
    }).catch(function (e) {
      showNotice('读取备份列表失败：' + esc(e.message || e), 'list');
    });
  }

  function applyBackup(name, mode) {
    showNotice('正在恢复…', 'list');
    fetch('/progress/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, mode: mode })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.error === 0) {
        alert('恢复完成：' + (j.message || '') + '\n\n页面将刷新。');
        try { sessionStorage.setItem(RESTORE_FLAG, '0'); } catch (e) {}   // 恢复后允许再拉取
        // 整份替换 = 服务器存档已被换掉，本机也整份跟着以服务器为准（否则本机那份残缺记录会把结果顶回去）
        try { if (mode === 'replace') sessionStorage.setItem(FORCE_PULL, '1'); } catch (e) {}
        suppressUnloadSave();
        location.reload();
      } else {
        alert('恢复失败：' + ((j && j.message) || '未知错误'));
        openBackupList();
      }
    }).catch(function (e) {
      alert('恢复失败：' + (e.message || e));
      openBackupList();
    });
  }


  function build() {
    if (!document.getElementById('map')) return;   // 只在主地图页显示

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML =
      '<div class="smo-pt-notice"></div>' +
      '<div class="smo-pt-count"></div>' +
      '<div class="smo-pt-actions">' +
      '<button type="button" class="smo-pt-btn smo-pt-export" title="把进度导出成 JSON 文件（自己留档）">导出进度</button>' +
      '<button type="button" class="smo-pt-btn smo-pt-import" title="从 JSON 文件恢复进度（导入前会自动备份当前进度）">导入进度</button>' +
      '<button type="button" class="smo-pt-btn smo-pt-restore" title="从服务器上的滚动备份恢复：补回缺失的国家 / 整份替换">从备份恢复</button>' +
      '</div>';
    document.body.appendChild(panel);

    var style = document.createElement('style');
    style.textContent =
      // 整条底部居中：容器占满宽度但不拦点击，只有按钮行/弹窗可点
      '#' + PANEL_ID + '{position:fixed;left:0;right:0;bottom:10px;z-index:3000;display:flex;flex-direction:column;' +
      'gap:6px;align-items:center;justify-content:flex-end;pointer-events:none;' +
      'font-size:12px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}' +
      '#' + PANEL_ID + ' .smo-pt-actions{display:flex;gap:8px;align-items:center;pointer-events:auto;}' +
      '#' + PANEL_ID + ' .smo-pt-count{background:rgba(0,0,0,.65);color:#fff;padding:3px 8px;border-radius:10px;}' +
      '#' + PANEL_ID + ' .smo-pt-btn{border:0;border-radius:8px;padding:6px 12px;cursor:pointer;color:#fff;' +
      'box-shadow:0 2px 6px rgba(0,0,0,.35);}' +
      '#' + PANEL_ID + ' .smo-pt-export{background:#2e7d32;}' +
      '#' + PANEL_ID + ' .smo-pt-import{background:#1565c0;}' +
      '#' + PANEL_ID + ' .smo-pt-restore{background:#6a1b9a;}' +
      '#' + PANEL_ID + ' .smo-pt-notice{display:none;width:min(560px,92vw);background:#4a1113;color:#fff;' +
      'border:1px solid #e57373;border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.6;' +
      'text-align:left;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:auto;}' +
      '#' + PANEL_ID + ' .smo-pt-notice.show{display:block;}' +
      '#' + PANEL_ID + ' .smo-pt-notice.ok{background:#123b1a;border-color:#66bb6a;}' +
      '#' + PANEL_ID + ' .smo-pt-nrow{display:flex;gap:6px;justify-content:flex-end;margin-top:6px;}' +
      '#' + PANEL_ID + ' .smo-pt-nbtn{border:0;border-radius:6px;padding:4px 8px;cursor:pointer;' +
      'background:#455a64;color:#fff;font-size:11px;}' +
      '#' + PANEL_ID + ' .smo-pt-ndel{background:#c62828;}' +
      '#' + PANEL_ID + ' .smo-pt-bhead{font-weight:600;margin-bottom:4px;}' +
      '#' + PANEL_ID + ' .smo-pt-brow{display:flex;align-items:center;gap:6px;padding:2px 0;' +
      'border-top:1px solid rgba(255,255,255,.15);}' +
      '#' + PANEL_ID + ' .smo-pt-btime{min-width:82px;}' +
      '#' + PANEL_ID + ' .smo-pt-bmeta{flex:1;white-space:nowrap;}' +
      '#' + PANEL_ID + ' .smo-pt-brow .smo-pt-nbtn{flex:none;}';
    document.head.appendChild(style);

    var counter = panel.querySelector('.smo-pt-count');
    noticeBox = panel.querySelector('.smo-pt-notice');
    mapNames().then(function (names) { MAP_NAMES = names; });   // 预热中文国名
    // 刚补回过缺失的国家 → 提示一次（12 秒后自动收起）
    try {
      var note = sessionStorage.getItem(RESTORE_NOTE);
      if (note) {
        sessionStorage.removeItem(RESTORE_NOTE);
        var info = JSON.parse(note) || {};
        var ids = info.maps || [];
        var fixed = info.healed || [];
        if (ids.length) {
          mapNames().then(function (names) {
            MAP_NAMES = names;
            var nameOf = function (id) { return MAP_NAMES[id] || ('地图 ' + id); };
            var txt = ids.map(nameOf).join('、');
            var extra = fixed.length
              ? '；<b>' + esc(fixed.map(nameOf).join('、')) + '</b> 的记录与地图对不上（切图时写错了），已按服务器存档修正'
              : '';
            showNotice('☁ 已从服务器补回缺失的国家：<b>' + esc(txt) + '</b>'
              + '（存档时间 ' + esc(fmtTime(info.at)) + '）' + extra, 'info');
            setTimeout(function () {
              if (noticeMode === 'info' && !pendingDeletion.length) hideNotice();
            }, 12000);
          });
        }
      }
    } catch (e) {}
    refreshCount(counter);
    setInterval(function () { refreshCount(counter); }, 3000);
    setInterval(autosave, 2000);              // 自动保存兜底（每 2 秒）

    restoreFromServer();                      // 载入时先尝试从服务器恢复（完成前不推送）
    setInterval(function () { pushToServer(false); }, 5000);   // 同步到服务器（内容没变就跳过）
    window.addEventListener('pagehide', beaconSave);
    window.addEventListener('beforeunload', beaconSave);

    panel.querySelector('.smo-pt-export').addEventListener('click', exportProgress);
    panel.querySelector('.smo-pt-restore').addEventListener('click', openBackupList);

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) {
        importProgress(input.files[0]);
        input.value = '';
      }
    });
    document.body.appendChild(input);
    panel.querySelector('.smo-pt-import').addEventListener('click', function () { input.click(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

  /* ---------- 力量之月攻略注入（本地增强） ----------
   * 点击地图上的力量之月标记时，在弹出的气泡里追加该月亮的中文获取方法。
   * 数据来自 data/guides_zh.json：{ mapSlug: { "编号": {zh, name, img} } }
   * 用标记标题开头的编号匹配（本地标记名形如 "1  迷雾上方的青蛙跳"）。
   */
  (function () {
    var GUIDES = null;
    var MAP_SLUG = {};

    function loadJson(url) {
      return fetch(url).then(function (r) { return r.json(); });
    }

    loadJson('data/maps.json').then(function (j) {
      (j.data || []).forEach(function (m) {
        var layers = m.m_tile_layers || [];
        var u = layers.length ? (layers[0].url_template || '') : '';
        var parts = u.split('/');
        var i = parts.indexOf('map');
        if (i >= 0 && parts[i + 1]) MAP_SLUG[String(m.map_id)] = parts[i + 1];
      });
    }).catch(function () {});

    loadJson('data/guides_zh.json').then(function (j) { GUIDES = j; }).catch(function () {});
    window.GUIDES_REF = function () { return GUIDES; };
    window.SLUG_REF = function () { return MAP_SLUG; };
    window.GUIDE_STATUS = function () {
      if (!GUIDES) return '数据未加载';
      var el = document.querySelector('[ng-controller="BodyCtrl as body"]');
      var id = null;
      try { var sc = window.angular && window.angular.element(el).scope(); var mm = sc && sc.body && sc.body.map; id = mm && mm.map_id != null ? String(mm.map_id) : null; } catch (e) {}
      var slug = MAP_SLUG[id];
      if (!slug) return '地图未识别(id=' + (id || '?') + ')';
      var n = GUIDES[slug] ? Object.keys(GUIDES[slug]).length : 0;
      return nm_str() + ' ' + slug + ' ' + n + ' 条';
      function nm_str() { try { var s2 = window.angular.element(el).scope(); return s2.body.map.name; } catch (e) { return ''; } }
    };

    /* 用 map_id 而不是 name：name 会被 i18n 翻成中文，和 maps.json 的英文名对不上 */
    function currentMapId() {
      try {
        var el = document.querySelector('[ng-controller="BodyCtrl as body"]');
        if (!window.angular || !el) return null;
        var sc = window.angular.element(el).scope();
        var m = sc && sc.body && sc.body.map;
        return m && m.map_id != null ? String(m.map_id) : null;
      } catch (e) { return null; }
    }

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function inject(pop) {
      if (!GUIDES || !pop || pop.querySelector('.smo-guide')) return;
      var titleEl = pop.querySelector('.title');
      if (!titleEl) return;
      var m = (titleEl.textContent || '').trim().match(/^(\d{1,3})\s/);
      if (!m) return;
      var slug = MAP_SLUG[currentMapId()];
      if (!slug || !GUIDES[slug]) return;
      var g = GUIDES[slug][String(parseInt(m[1], 10))];
      if (!g || !g.zh) return;

      var box = document.createElement('div');
      box.className = 'smo-guide';
      var html = '<hr style="margin:.55rem 0 .4rem">' +
        '<div style="font-weight:600;margin-bottom:.3rem">📖 获取方法</div>';
      g.zh.split('\n').forEach(function (line) {
        html += '<div style="margin-bottom:.3rem;font-size:.88em;line-height:1.55">' + esc(line) + '</div>';
      });
      if (g.img) {
        html += '<a href="' + g.img + '" target="_blank" rel="noopener" style="font-size:.85em">查看原站截图 →</a>';
      }
      box.innerHTML = html;

      var desc = pop.querySelector('.desc');
      if (desc && desc.parentNode) desc.parentNode.insertBefore(box, desc.nextSibling);
      else pop.insertBefore(box, pop.firstChild);
    }

    function scan() {
      document.querySelectorAll('.leaflet-popup-content').forEach(inject);
    }

    if (window.MutationObserver) {
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    }
    setTimeout(scan, 1500);
    setTimeout(scan, 4000);
  })();


  /* ---------- 攻略功能自检（诊断用） ---------- */
  (function () {
    var box = document.createElement('div');
    box.id = 'smo-guide-diag';
    // 目标位置：并进底部居中的进度面板（排在按钮行上方）；面板还没建好时先按底部居中兜底
    var DIAG_FIXED = 'position:fixed;left:0;right:0;bottom:10px;margin:0 auto;width:max-content;max-width:92vw;' +
      'background:rgba(0,0,0,.72);color:#fff;font:11px/1.5 system-ui,sans-serif;padding:3px 8px;' +
      'border-radius:10px;pointer-events:none;text-align:center;z-index:9999';
    var DIAG_INLINE = 'background:rgba(0,0,0,.72);color:#fff;font:11px/1.5 system-ui,sans-serif;' +
      'padding:3px 8px;border-radius:10px;pointer-events:none;max-width:92vw;text-align:center;';
    box.style.cssText = DIAG_FIXED;
    box.textContent = '攻略: 初始化…';

    function attachPanel() {
      var panel = document.getElementById(PANEL_ID);
      if (!panel) return false;
      if (box.parentNode !== panel || panel.firstChild !== box) {
        box.style.cssText = DIAG_INLINE;
        panel.insertBefore(box, panel.firstChild);   // 面板最上方：📖 → 弹窗 → 状态行 → 按钮行
      }
      return true;
    }
    function add() {
      if (!document.body || document.getElementById('smo-guide-diag')) return;   // 已在文档里就不再重复添加
      if (!attachPanel()) document.body.appendChild(box);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();

    function state() {
      try {
        var el = document.querySelector('[ng-controller="BodyCtrl as body"]');
        var sc = window.angular && window.angular.element(el).scope();
        var m = sc && sc.body && sc.body.map;
        return m ? (m.name + ' #' + m.map_id) : '(无地图)';
      } catch (e) { return '(读取失败)'; }
    }
    setInterval(function () {
      var el = document.getElementById('smo-guide-diag');
      if (!el) { add(); return; }
      attachPanel();                                 // 面板稍后建好时挪进来
      window.__smoGuideDebug = { guidesLoaded: GUIDES_REF(), mapSlugMap: SLUG_REF(), currentMap: state() };
      el.textContent = '📖 ' + (typeof GUIDE_STATUS === 'function' ? GUIDE_STATUS() : '?') + ' | 当前地图: ' + (state() || '?');
    }, 1500);

    // ?openguide=1 → 依次点开标记，直到找到一个带编号的（月亮），方便验证攻略注入
    if (location.search.indexOf('openguide=1') >= 0) {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        var icons = document.querySelectorAll('.leaflet-marker-icon');
        if (!icons.length) { if (tries > 40) clearInterval(iv); return; }
        clearInterval(iv);
        var i = 0, max = Math.min(icons.length, 25);
        (function next() {
          if (i >= max) return;
          var el = icons[i++];
          try { el.click(); } catch (e) {}
          setTimeout(function () {
            var ti = document.querySelector('.leaflet-popup-content .title');
            var tx = ti ? (ti.textContent || '').trim() : '';
            if (/^\d{1,3}\s/.test(tx)) {
              var g = document.querySelector('.leaflet-popup-content .smo-guide');
              var d = document.getElementById('smo-guide-diag');
              if (d) d.textContent = (g ? '✅ 攻略已注入: ' : '⚠️ 有标记但未注入: ') + tx;
            } else { setTimeout(next, 120); }
          }, 320);
        })();
      }, 700);
    }
  })();

})();
