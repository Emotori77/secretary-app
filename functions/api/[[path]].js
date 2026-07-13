// Cloudflare Pages Functions
// /api/* をすべて処理します。データは KV ネームスペース(バインド名: DATA) に保存します。
// server.js(Node版) と同じ機能を、Cloudflare上で動く形に移植したものです。

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
const nowIso = () => new Date().toISOString();

// ---- 正規化（server.js と同じ） ----
function normalizeTask(t) {
  t = t || {};
  return {
    id: t.id || genId(),
    title: (t.title || '').toString(),
    detail: (t.detail || '').toString(),
    dueDate: (t.dueDate || '').toString(),
    dueTime: (t.dueTime || '').toString(),
    priority: ['urgent', 'high', 'mid', 'low'].includes(t.priority) ? t.priority : 'mid',
    category: (t.category || 'その他').toString(),
    estimateMin: Number.isFinite(t.estimateMin) ? t.estimateMin : (t.estimateMin ? Number(t.estimateMin) || null : null),
    status: ['todo', 'doing', 'done'].includes(t.status) ? t.status : (t.done ? 'done' : 'todo'),
    done: !!t.done,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map((s) => ({ id: s.id || genId(), title: (s.title || '').toString(), done: !!s.done })) : [],
    repeat: ['none', 'daily', 'weekly', 'monthly'].includes(t.repeat) ? t.repeat : 'none',
    relatedGoal: (t.relatedGoal || '').toString(),
    postponeCount: Number.isFinite(t.postponeCount) ? t.postponeCount : (Number(t.postponeCount) || 0),
    createdAt: t.createdAt || nowIso(),
    completedAt: t.completedAt || null,
  };
}
function normalizeNote(n) {
  n = n || {};
  return {
    id: n.id || genId(),
    title: (n.title || '').toString(),
    content: (n.content || '').toString(),
    category: (n.category || '未分類').toString(),
    tags: Array.isArray(n.tags) ? n.tags.map((t) => t.toString()) : [],
    pinned: !!n.pinned,
    createdAt: n.createdAt || nowIso(),
    updatedAt: n.updatedAt || n.createdAt || nowIso(),
  };
}
function normalizeEvent(e) {
  e = e || {};
  return {
    id: e.id || genId(),
    title: (e.title || '').toString(),
    date: (e.date || '').toString(),
    startTime: (e.startTime || '').toString(),
    endTime: (e.endTime || '').toString(),
    place: (e.place || '').toString(),
    detail: (e.detail || '').toString(),
    items: (e.items || '').toString(),
    prepare: (e.prepare || '').toString(),
    travelMin: Number.isFinite(e.travelMin) ? e.travelMin : (Number(e.travelMin) || null),
    notifyMin: Number.isFinite(e.notifyMin) ? e.notifyMin : (Number(e.notifyMin) || null),
    repeat: ['none', 'daily', 'weekly', 'monthly'].includes(e.repeat) ? e.repeat : 'none',
    source: e.source || 'local',
    createdAt: e.createdAt || nowIso(),
  };
}
function normalizeGoal(g) {
  g = g || {};
  return {
    id: g.id || genId(),
    title: (g.title || '').toString(),
    purpose: (g.purpose || '').toString(),
    due: (g.due || '').toString(),
    category: (g.category || 'その他').toString(),
    progress: Number.isFinite(g.progress) ? g.progress : (Number(g.progress) || 0),
    criteria: (g.criteria || '').toString(),
    memo: (g.memo || '').toString(),
    createdAt: g.createdAt || nowIso(),
  };
}
function normalizeDaily(d) {
  d = d || {};
  return {
    id: d.id || genId(),
    date: (d.date || nowIso().slice(0, 10)).toString(),
    did: (d.did || '').toString(),
    notDone: (d.notDone || '').toString(),
    mood: Number.isFinite(d.mood) ? d.mood : (Number(d.mood) || 3),
    satisfaction: Number.isFinite(d.satisfaction) ? d.satisfaction : (Number(d.satisfaction) || 3),
    tomorrow: (d.tomorrow || '').toString(),
    free: (d.free || '').toString(),
    createdAt: d.createdAt || nowIso(),
  };
}

async function loadData(env) {
  let d = {};
  try { const raw = await env.DATA.get('data'); if (raw) d = JSON.parse(raw); } catch (e) { d = {}; }
  return {
    notes: Array.isArray(d.notes) ? d.notes.map(normalizeNote) : [],
    tasks: Array.isArray(d.tasks) ? d.tasks.map(normalizeTask) : [],
    reviews: Array.isArray(d.reviews) ? d.reviews : [],
    events: Array.isArray(d.events) ? d.events.map(normalizeEvent) : [],
    goals: Array.isArray(d.goals) ? d.goals.map(normalizeGoal) : [],
    dailyReviews: Array.isArray(d.dailyReviews) ? d.dailyReviews.map(normalizeDaily) : [],
    prefs: (d.prefs && typeof d.prefs === 'object') ? d.prefs : {},
  };
}
async function saveData(env, data) { await env.DATA.put('data', JSON.stringify(data)); }

// ---- AI(りな) 対話 ----
async function callLLM(key, message, contextStr) {
  const system = [
    'あなたは「秘書りな」。ユーザー（生田さま）専属の、優秀で落ち着いたパーソナル秘書です。',
    '口調は優しく簡潔。必要以上に褒めず、ユーザーを責めず、先回りして提案します。',
    '呼びかけは基本「生田さま」。毎回は付けず、会話の始まりや重要な案内でだけ使います。',
    '返答は短く、2〜4文以内。分からないことは知ったふりをしません。',
    'データの追加・変更・削除はアプリ側が確認カードで行います。あなたは実行せず、提案と助言に徹します。',
    contextStr ? ('現在の状況：' + contextStr) : '',
  ].filter(Boolean).join('\n');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, system, messages: [{ role: 'user', content: message }] }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.content && j.content[0] && j.content[0].text) || null;
  } catch (e) { return null; }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const seg = params.path || [];       // /api/tasks/123 → ['tasks','123']
  const res = seg[0];
  const id = seg[1];

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.DATA) return json({ error: 'KVストレージ(DATA)が未設定です。CloudflareでKVネームスペースを作成し、変数名「DATA」でバインドしてください。' }, 500);

  const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await request.json().catch(() => ({})) : {};

  // GET /api/data
  if (res === 'data' && method === 'GET') return json(await loadData(env));

  // AI(りな) 対話
  if (res === 'chat' && method === 'POST') {
    const message = (body.message || '').toString().trim();
    if (!message) return json({ error: 'メッセージがありません' }, 400);
    if (!env.ANTHROPIC_API_KEY) return json({ reply: null, source: 'none' });
    const reply = await callLLM(env.ANTHROPIC_API_KEY, message, (body.context || '').toString().slice(0, 2000));
    return json({ reply: reply || null, source: reply ? 'llm' : 'error' });
  }

  // ===== メモ =====
  if (res === 'notes') {
    const data = await loadData(env);
    if (method === 'POST') {
      const title = (body.title || '').toString().trim(), content = (body.content || '').toString().trim();
      if (!title && !content) return json({ error: 'タイトルまたは本文を入力してください' }, 400);
      const note = normalizeNote({ ...body, title, content, createdAt: nowIso(), updatedAt: nowIso() });
      data.notes.unshift(note); await saveData(env, data); return json(note, 201);
    }
    if (id && method === 'PATCH') {
      const note = data.notes.find((n) => n.id === id); if (!note) return json({ error: 'メモが見つかりません' }, 404);
      for (const k of ['title', 'content', 'category', 'tags', 'pinned']) if (k in body) note[k] = body[k];
      note.updatedAt = nowIso();
      const i = data.notes.findIndex((n) => n.id === id); data.notes[i] = normalizeNote(note);
      await saveData(env, data); return json(data.notes[i]);
    }
    if (id && method === 'DELETE') { data.notes = data.notes.filter((n) => n.id !== id); await saveData(env, data); return json({ ok: true }); }
  }

  // ===== タスク =====
  if (res === 'tasks') {
    const data = await loadData(env);
    if (method === 'POST') {
      const title = (body.title || '').toString().trim();
      if (!title) return json({ error: 'タスク内容を入力してください' }, 400);
      const task = normalizeTask({ ...body, title, done: false, status: 'todo', postponeCount: 0, createdAt: nowIso(), completedAt: null });
      data.tasks.unshift(task); await saveData(env, data); return json(task, 201);
    }
    if (id && method === 'PATCH') {
      const task = data.tasks.find((t) => t.id === id); if (!task) return json({ error: 'タスクが見つかりません' }, 404);
      if (body.postpone === true) {
        task.postponeCount = (task.postponeCount || 0) + 1;
        if (task.dueDate) { const [y, m, dd] = task.dueDate.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); dt.setUTCDate(dt.getUTCDate() + 1); task.dueDate = dt.toISOString().slice(0, 10); }
      }
      for (const k of ['title', 'detail', 'dueDate', 'dueTime', 'priority', 'category', 'estimateMin', 'status', 'subtasks', 'repeat', 'relatedGoal']) if (k in body) task[k] = body[k];
      if (typeof body.done === 'boolean') { task.done = body.done; task.status = body.done ? 'done' : (task.status === 'done' ? 'todo' : task.status); task.completedAt = body.done ? nowIso() : null; }
      const i = data.tasks.findIndex((t) => t.id === id); data.tasks[i] = normalizeTask(task);
      await saveData(env, data); return json(data.tasks[i]);
    }
    if (id && method === 'DELETE') { data.tasks = data.tasks.filter((t) => t.id !== id); await saveData(env, data); return json({ ok: true }); }
  }

  // ===== 週次の振り返り =====
  if (res === 'reviews') {
    const data = await loadData(env);
    if (method === 'POST') {
      const comment = (body.comment || '').toString().trim(), week = (body.week || '').toString().trim();
      if (!comment) return json({ error: '振り返りコメントを入力してください' }, 400);
      const review = { id: genId(), week: week || '（週の指定なし）', comment, createdAt: nowIso() };
      data.reviews.unshift(review); await saveData(env, data); return json(review, 201);
    }
    if (id && method === 'DELETE') { data.reviews = data.reviews.filter((r) => r.id !== id); await saveData(env, data); return json({ ok: true }); }
  }

  // ===== 予定 =====
  if (res === 'events') {
    const data = await loadData(env);
    if (method === 'POST') {
      const title = (body.title || '').toString().trim();
      if (!title) return json({ error: '予定名を入力してください' }, 400);
      if (!body.date) return json({ error: '日付を入力してください' }, 400);
      const ev = normalizeEvent({ ...body, title, createdAt: nowIso() });
      data.events.push(ev); await saveData(env, data); return json(ev, 201);
    }
    if (id && method === 'PATCH') {
      const ev = data.events.find((e) => e.id === id); if (!ev) return json({ error: '予定が見つかりません' }, 404);
      for (const k of ['title', 'date', 'startTime', 'endTime', 'place', 'detail', 'items', 'prepare', 'travelMin', 'notifyMin', 'repeat']) if (k in body) ev[k] = body[k];
      const i = data.events.findIndex((e) => e.id === id); data.events[i] = normalizeEvent(ev);
      await saveData(env, data); return json(data.events[i]);
    }
    if (id && method === 'DELETE') { data.events = data.events.filter((e) => e.id !== id); await saveData(env, data); return json({ ok: true }); }
  }

  // ===== 目標 =====
  if (res === 'goals') {
    const data = await loadData(env);
    if (method === 'POST') {
      const title = (body.title || '').toString().trim();
      if (!title) return json({ error: '目標名を入力してください' }, 400);
      const goal = normalizeGoal({ ...body, title, createdAt: nowIso() });
      data.goals.unshift(goal); await saveData(env, data); return json(goal, 201);
    }
    if (id && method === 'PATCH') {
      const goal = data.goals.find((g) => g.id === id); if (!goal) return json({ error: '目標が見つかりません' }, 404);
      for (const k of ['title', 'purpose', 'due', 'category', 'progress', 'criteria', 'memo']) if (k in body) goal[k] = body[k];
      const i = data.goals.findIndex((g) => g.id === id); data.goals[i] = normalizeGoal(goal);
      await saveData(env, data); return json(data.goals[i]);
    }
    if (id && method === 'DELETE') { data.goals = data.goals.filter((g) => g.id !== id); await saveData(env, data); return json({ ok: true }); }
  }

  // ===== デイリーレビュー =====
  if (res === 'daily') {
    const data = await loadData(env);
    if (method === 'POST') {
      const has = ['did', 'notDone', 'tomorrow', 'free'].some((k) => (body[k] || '').toString().trim());
      if (!has) return json({ error: '振り返りの内容を入力してください' }, 400);
      const daily = normalizeDaily({ ...body, createdAt: nowIso() });
      data.dailyReviews.unshift(daily); await saveData(env, data); return json(daily, 201);
    }
    if (id && method === 'DELETE') { data.dailyReviews = data.dailyReviews.filter((d) => d.id !== id); await saveData(env, data); return json({ ok: true }); }
  }

  // ===== バックアップ読み込み（全置き換え） =====
  if (res === 'import' && method === 'POST') {
    if (!body || typeof body !== 'object') return json({ error: '不正なデータ形式です' }, 400);
    const data = {
      notes: Array.isArray(body.notes) ? body.notes.map(normalizeNote) : [],
      tasks: Array.isArray(body.tasks) ? body.tasks.map(normalizeTask) : [],
      reviews: Array.isArray(body.reviews) ? body.reviews : [],
      events: Array.isArray(body.events) ? body.events.map(normalizeEvent) : [],
      goals: Array.isArray(body.goals) ? body.goals.map(normalizeGoal) : [],
      dailyReviews: Array.isArray(body.dailyReviews) ? body.dailyReviews.map(normalizeDaily) : [],
      prefs: (body.prefs && typeof body.prefs === 'object') ? body.prefs : {},
    };
    await saveData(env, data); return json({ ok: true });
  }

  // ===== 設定 =====
  if (res === 'prefs' && method === 'PATCH') {
    const data = await loadData(env);
    data.prefs = { ...data.prefs, ...body };
    await saveData(env, data); return json(data.prefs);
  }

  return json({ error: 'Not Found' }, 404);
}
