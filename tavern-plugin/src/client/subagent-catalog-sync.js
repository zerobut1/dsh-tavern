// DSH 0.2 renders its header from projectionsBySession, independently of the
// filtered server catalogs. Filter this display store too, leaving the native
// projection watermarks, session events and saved logs untouched.
function syncTavernProjectedSubagentCatalogs(sessions, signals) {
  const list = sessions.list, originalSet = list.set;
  let raw = list.getSnapshot(), disposed = false;
  const retired = new Map(), signatures = new Map(), watches = new Map(), pending = new Set(), again = new Set();
  function project(snapshot) {
    let projections = snapshot.projectionsBySession, byId = snapshot.byId;
    const hidden = new Set();
    for (const [parentId, ids] of retired) {
      if (!isPlayMode(tavernSessionModes.values[parentId])) continue;
      const block = projections[parentId], entries = block?.values.subagentCatalog;
      for (const id of ids) if (byId[id]?.running !== true && (!byId[id] || byId[id].parentId === parentId)) hidden.add(id);
      if (!Array.isArray(entries)) continue;
      const visible = entries.filter(entry => !hidden.has(entry.id));
      if (visible.length !== entries.length) projections = { ...projections, [parentId]: { ...block, values: { ...block.values, subagentCatalog: visible } } };
    }
    for (const id of hidden) if (Object.hasOwn(byId, id)) {
      if (byId === snapshot.byId) byId = { ...byId };
      delete byId[id];
    }
    const ids = snapshot.ids.filter(id => !hidden.has(id));
    return projections === snapshot.projectionsBySession && byId === snapshot.byId && ids.length === snapshot.ids.length
      ? snapshot : { ...snapshot, projectionsBySession: projections, byId, ids };
  }
  function publish(snapshot) { raw = snapshot; return originalSet.call(list, project(snapshot)); }
  async function refresh(parentId) {
    if (disposed) return;
    if (pending.has(parentId)) { again.add(parentId); return; }
    pending.add(parentId);
    try {
      const result = await rpc('listGameSubagents', {}, parentId);
      if (!disposed && Array.isArray(result.retiredIds)) {
        retired.set(parentId, new Set(result.retiredIds));
        publish(raw);
      }
    } catch (error) { if (!disposed) console.warn('[DSH Tavern] 子代理目录刷新失败', error); }
    finally { pending.delete(parentId); if (again.delete(parentId)) void refresh(parentId); }
  }
  function reconcile() {
    for (const [parentId, block] of Object.entries(raw.projectionsBySession || {})) {
      if (!isPlayMode(tavernSessionModes.values[parentId]) || !Array.isArray(block.values.subagentCatalog)) continue;
      if (!watches.has(parentId) && signals?.subscribe) watches.set(parentId, signals.subscribe(parentId, 'subagents', () => { void refresh(parentId); }));
      const signature = block.values.subagentCatalog.map(entry => entry.id).join('|');
      if (signatures.get(parentId) === signature) continue;
      signatures.set(parentId, signature);
      void refresh(parentId);
    }
  }
  list.set = publish;
  const stop = list.subscribe(reconcile);
  tavernSessionModes.listeners.add(reconcile);
  reconcile();
  return function () {
    disposed = true; stop(); tavernSessionModes.listeners.delete(reconcile);
    for (const unwatch of watches.values()) unwatch();
    if (list.set === publish) { list.set = originalSet; originalSet.call(list, raw); }
  };
}

// Older hosts count session summaries and read a separate lazy catalog.
// Refresh an opened catalog when membership/activity changes in the summary feed.
function syncTavernSubagentCatalogs(sessions, signals) {
  if (typeof sessions?.list?.set === 'function' && sessions.list.getSnapshot().projectionsBySession) return syncTavernProjectedSubagentCatalogs(sessions, signals);
  if (!sessions || !sessions.list || typeof sessions.refreshSubagents !== 'function') return function () {};
  const signatures = new Map();
  let disposed = false;
  function reconcile() {
    const snapshot = sessions.list.getSnapshot();
    const groups = new Map();
    for (const row of Object.values(snapshot.byId || {})) {
      if (row.origin !== 'subagent' || !row.parentId) continue;
      if (!groups.has(row.parentId)) groups.set(row.parentId, []);
      groups.get(row.parentId).push(row.id + ':' + String(row.running === true));
    }
    for (const [parentId, catalog] of Object.entries(snapshot.subagentsByParent || {})) {
      if (!catalog || catalog.state !== 'ready') continue;
      const rows = groups.get(parentId) || [];
      const signature = rows.slice().sort().join('|');
      const previous = signatures.get(parentId);
      if (previous === signature) continue;
      signatures.set(parentId, signature);
      // A catalog that just became ready was fetched moments ago; refetching it
      // repeats a full session scan. Only refresh when it misses a known child.
      if (previous === undefined) {
        const listed = new Set((catalog.entries || []).map(function (entry) { return entry && entry.id; }));
        if (rows.every(function (row) { return listed.has(row.slice(0, row.lastIndexOf(':'))); })) continue;
      }
      Promise.resolve().then(function () {
        if (!disposed) return sessions.refreshSubagents(parentId);
      }).catch(function (error) { console.warn('[DSH Tavern] 子代理目录刷新失败', error); });
    }
  }
  // Tavern retires failed background workers. The host keeps a disposed subagent in the
  // session list as an idle row; reloading the list drops it, as a page reload would.
  let watched = null, unwatch = function () {}, refreshing = null, again = false;
  // The host reuses a list pull already in flight, which may predate this retirement: pull again after it.
  function refreshList() {
    if (disposed || typeof sessions.refresh !== 'function') return;
    if (refreshing) { again = true; return; }
    again = false;
    refreshing = Promise.resolve(sessions.refresh()).catch(function (error) { console.warn('[DSH Tavern] 会话列表刷新失败', error); })
      .finally(function () { refreshing = null; if (again) refreshList(); });
  }
  function follow() {
    // 0.2 hosts dropped the snapshot's top-level current; the main view's retain names it now.
    const snapshot = sessions.list.getSnapshot();
    const main = Object.values(snapshot.byId || {}).find(function (row) { return row && row.retainedBy && (row.retainedBy.mainView ?? 0) > 0; });
    const current = (main && main.id) || snapshot.current || null;
    if (current === watched || !signals || typeof signals.subscribe !== 'function') return;
    unwatch();
    watched = current;
    unwatch = current ? signals.subscribe(current, 'subagents', refreshList) : function () {};
  }
  const stop = sessions.list.subscribe(function () { reconcile(); follow(); });
  reconcile();
  follow();
  return function () { disposed = true; stop(); unwatch(); };
}
