// 自分専用の秘書アプリ - Node.js標準モジュールのみで動作するサーバー
// 追加インストール不要。 `node server.js` で起動します。

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const INDEX_FILE = path.join(__dirname, 'index.html');

// ---- データ保存・読み込み ------------------------------------------------

// タスクを新スキーマへ正規化（旧データも壊さないよう既定値を補完＝マイグレーション）
function normalizeTask(t) {
  t = t || {};
  return {
    id: t.id || generateId(),
    title: (t.title || '').toString(),
    detail: (t.detail || '').toString(),
    dueDate: (t.dueDate || '').toString(),   // "YYYY-MM-DD"
    dueTime: (t.dueTime || '').toString(),   // "HH:MM"
    priority: ['urgent', 'high', 'mid', 'low'].includes(t.priority) ? t.priority : 'mid',
    category: (t.category || 'その他').toString(),
    estimateMin: Number.isFinite(t.estimateMin) ? t.estimateMin : (t.estimateMin ? Number(t.estimateMin) || null : null),
    status: ['todo', 'doing', 'done'].includes(t.status) ? t.status : (t.done ? 'done' : 'todo'),
    done: !!t.done,
    subtasks: Array.isArray(t.subtasks)
      ? t.subtasks.map((s) => ({ id: s.id || generateId(), title: (s.title || '').toString(), done: !!s.done }))
      : [],
    repeat: ['none', 'daily', 'weekly', 'monthly'].includes(t.repeat) ? t.repeat : 'none',
    relatedGoal: (t.relatedGoal || '').toString(),
    postponeCount: Number.isFinite(t.postponeCount) ? t.postponeCount : (Number(t.postponeCount) || 0),
    createdAt: t.createdAt || new Date().toISOString(),
    completedAt: t.completedAt || null,
  };
}

// メモを新スキーマへ正規化（カテゴリ・タグ・固定・更新日時を補完）
function normalizeNote(n) {
  n = n || {};
  return {
    id: n.id || generateId(),
    title: (n.title || '').toString(),
    content: (n.content || '').toString(),
    category: (n.category || '未分類').toString(),
    tags: Array.isArray(n.tags) ? n.tags.map((t) => t.toString()) : [],
    pinned: !!n.pinned,
    createdAt: n.createdAt || new Date().toISOString(),
    updatedAt: n.updatedAt || n.createdAt || new Date().toISOString(),
  };
}

// 予定を正規化
function normalizeEvent(e) {
  e = e || {};
  return {
    id: e.id || generateId(),
    title: (e.title || '').toString(),
    date: (e.date || '').toString(),        // "YYYY-MM-DD"
    startTime: (e.startTime || '').toString(),
    endTime: (e.endTime || '').toString(),
    place: (e.place || '').toString(),
    detail: (e.detail || '').toString(),
    items: (e.items || '').toString(),      // 持ち物
    prepare: (e.prepare || '').toString(),  // 準備すること
    travelMin: Number.isFinite(e.travelMin) ? e.travelMin : (Number(e.travelMin) || null),
    notifyMin: Number.isFinite(e.notifyMin) ? e.notifyMin : (Number(e.notifyMin) || null),
    repeat: ['none', 'daily', 'weekly', 'monthly'].includes(e.repeat) ? e.repeat : 'none',
    source: e.source || 'local',            // 将来のGoogleカレンダー連携用
    createdAt: e.createdAt || new Date().toISOString(),
  };
}

// 目標を正規化
function normalizeGoal(g) {
  g = g || {};
  return {
    id: g.id || generateId(),
    title: (g.title || '').toString(),
    purpose: (g.purpose || '').toString(),
    due: (g.due || '').toString(),
    category: (g.category || 'その他').toString(),
    progress: Number.isFinite(g.progress) ? g.progress : (Number(g.progress) || 0),
    criteria: (g.criteria || '').toString(),  // 達成条件
    memo: (g.memo || '').toString(),
    createdAt: g.createdAt || new Date().toISOString(),
  };
}

// デイリーレビューを正規化
function normalizeDaily(d) {
  d = d || {};
  return {
    id: d.id || generateId(),
    date: (d.date || new Date().toISOString().slice(0, 10)).toString(),
    did: (d.did || '').toString(),
    notDone: (d.notDone || '').toString(),
    mood: Number.isFinite(d.mood) ? d.mood : (Number(d.mood) || 3),
    satisfaction: Number.isFinite(d.satisfaction) ? d.satisfaction : (Number(d.satisfaction) || 3),
    tomorrow: (d.tomorrow || '').toString(),
    free: (d.free || '').toString(),
    createdAt: d.createdAt || new Date().toISOString(),
  };
}

// data.json を読み込む。無ければ初期データを返す。
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      notes: Array.isArray(data.notes) ? data.notes.map(normalizeNote) : [],
      tasks: Array.isArray(data.tasks) ? data.tasks.map(normalizeTask) : [],
      reviews: Array.isArray(data.reviews) ? data.reviews : [],
      events: Array.isArray(data.events) ? data.events.map(normalizeEvent) : [],
      goals: Array.isArray(data.goals) ? data.goals.map(normalizeGoal) : [],
      dailyReviews: Array.isArray(data.dailyReviews) ? data.dailyReviews.map(normalizeDaily) : [],
      prefs: (data.prefs && typeof data.prefs === 'object') ? data.prefs : {},
    };
  } catch (e) {
    // ファイルが無い / 壊れている場合は空のデータから始める
    return { notes: [], tasks: [], reviews: [], events: [], goals: [], dailyReviews: [], prefs: {} };
  }
}

// data.json へ書き込む（アプリを閉じても消えないように永続化）
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 一意なIDを生成
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- HTTPリクエストのボディを読む -----------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // 過大なリクエストを防ぐ
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('不正なJSONです'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // ファイル(file://)から直接開いた場合でも通信できるように許可する
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

// ---- AI（りな）対話：LLM呼び出し -----------------------------------------
// APIキーはサーバー側の環境変数 ANTHROPIC_API_KEY から読み込みます。
// 画面（フロント）にはキーを一切置きません。未設定ならルールベースへ自動フォールバック。
function callLLM(message, context) {
  return new Promise((resolve) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return resolve(null);
    const system = [
      'あなたは「秘書りな」。ユーザー（生田さま）専属の、優秀で落ち着いたパーソナル秘書です。',
      '口調は優しく簡潔。必要以上に褒めず、ユーザーを責めず、先回りして提案します。',
      '呼びかけは基本「生田さま」。毎回は付けず、会話の始まりや重要な案内でだけ使います。',
      '返答は短く、2〜4文以内。分からないことは知ったふりをしません。',
      'データの追加・変更・削除はアプリ側が確認カードで行います。あなたは実行せず、提案と助言に徹します。',
      context ? ('現在の状況：' + context) : '',
    ].filter(Boolean).join('\n');
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: message }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(payload) },
    }, (r) => {
      let b = '';
      r.on('data', (c) => { b += c; });
      r.on('end', () => { try { const j = JSON.parse(b); resolve((j.content && j.content[0] && j.content[0].text) || null); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(payload); req.end();
  });
}

// ---- APIハンドラ ----------------------------------------------------------

async function handleApi(req, res, url) {
  const method = req.method;

  // CORSプリフライト(OPTIONS)への応答
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // 全データ取得
  if (url === '/api/data' && method === 'GET') {
    return sendJson(res, 200, loadData());
  }

  // メモ追加（カテゴリ・タグ・固定に対応）
  if (url === '/api/notes' && method === 'POST') {
    const body = await readBody(req);
    const title = (body.title || '').toString().trim();
    const content = (body.content || '').toString().trim();
    if (!title && !content) {
      return sendJson(res, 400, { error: 'タイトルまたは本文を入力してください' });
    }
    const data = loadData();
    const note = normalizeNote({
      ...body, title, content,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    data.notes.unshift(note);
    saveData(data);
    return sendJson(res, 201, note);
  }

  // メモ更新（編集・固定切替）
  const noteMatch = url.match(/^\/api\/notes\/([^/]+)$/);
  if (noteMatch && method === 'PATCH') {
    const id = noteMatch[1];
    const body = await readBody(req);
    const data = loadData();
    const note = data.notes.find((n) => n.id === id);
    if (!note) return sendJson(res, 404, { error: 'メモが見つかりません' });
    for (const key of ['title', 'content', 'category', 'tags', 'pinned']) {
      if (key in body) note[key] = body[key];
    }
    note.updatedAt = new Date().toISOString();
    const idx = data.notes.findIndex((n) => n.id === id);
    data.notes[idx] = normalizeNote(note);
    saveData(data);
    return sendJson(res, 200, data.notes[idx]);
  }

  // メモ削除
  if (noteMatch && method === 'DELETE') {
    const id = noteMatch[1];
    const data = loadData();
    data.notes = data.notes.filter((n) => n.id !== id);
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  // タスク追加（全項目対応。{title} だけでも従来どおり動く＝後方互換）
  if (url === '/api/tasks' && method === 'POST') {
    const body = await readBody(req);
    const title = (body.title || '').toString().trim();
    if (!title) {
      return sendJson(res, 400, { error: 'タスク内容を入力してください' });
    }
    const data = loadData();
    const task = normalizeTask({
      ...body,
      title,
      done: false,
      status: 'todo',
      postponeCount: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    data.tasks.unshift(task);
    saveData(data);
    return sendJson(res, 201, task);
  }

  // タスク更新（完了切替・各項目編集・延期）
  const taskMatch = url.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === 'PATCH') {
    const id = taskMatch[1];
    const body = await readBody(req);
    const data = loadData();
    const task = data.tasks.find((t) => t.id === id);
    if (!task) return sendJson(res, 404, { error: 'タスクが見つかりません' });

    // 延期：期限を1日後ろにずらし、延期回数を+1（UTC基準でタイムゾーンのズレを防ぐ）
    if (body.postpone === true) {
      task.postponeCount = (task.postponeCount || 0) + 1;
      if (task.dueDate) {
        const [y, m, dd] = task.dueDate.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1, dd));
        d.setUTCDate(d.getUTCDate() + 1);
        task.dueDate = d.toISOString().slice(0, 10);
      }
    }

    // 編集可能なフィールドだけ反映
    const editable = ['title', 'detail', 'dueDate', 'dueTime', 'priority', 'category',
      'estimateMin', 'status', 'subtasks', 'repeat', 'relatedGoal'];
    for (const key of editable) {
      if (key in body) task[key] = body[key];
    }

    // 完了状態の切替（完了日時も自動管理）
    if (typeof body.done === 'boolean') {
      task.done = body.done;
      task.status = body.done ? 'done' : (task.status === 'done' ? 'todo' : task.status);
      task.completedAt = body.done ? new Date().toISOString() : null;
    }

    // 正規化して保存（型崩れ防止）
    const idx = data.tasks.findIndex((t) => t.id === id);
    data.tasks[idx] = normalizeTask(task);
    saveData(data);
    return sendJson(res, 200, data.tasks[idx]);
  }

  // タスク削除
  if (taskMatch && method === 'DELETE') {
    const id = taskMatch[1];
    const data = loadData();
    data.tasks = data.tasks.filter((t) => t.id !== id);
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  // 週次の振り返り 追加
  if (url === '/api/reviews' && method === 'POST') {
    const body = await readBody(req);
    const comment = (body.comment || '').toString().trim();
    const week = (body.week || '').toString().trim();
    if (!comment) {
      return sendJson(res, 400, { error: '振り返りコメントを入力してください' });
    }
    const data = loadData();
    const review = {
      id: generateId(),
      week: week || '（週の指定なし）',
      comment,
      createdAt: new Date().toISOString(),
    };
    data.reviews.unshift(review);
    saveData(data);
    return sendJson(res, 201, review);
  }

  // 週次の振り返り 削除
  const reviewMatch = url.match(/^\/api\/reviews\/([^/]+)$/);
  if (reviewMatch && method === 'DELETE') {
    const id = reviewMatch[1];
    const data = loadData();
    data.reviews = data.reviews.filter((r) => r.id !== id);
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  // ===== 予定（カレンダー） =====
  if (url === '/api/events' && method === 'POST') {
    const body = await readBody(req);
    const title = (body.title || '').toString().trim();
    if (!title) return sendJson(res, 400, { error: '予定名を入力してください' });
    if (!body.date) return sendJson(res, 400, { error: '日付を入力してください' });
    const data = loadData();
    const ev = normalizeEvent({ ...body, title, createdAt: new Date().toISOString() });
    data.events.push(ev);
    saveData(data);
    return sendJson(res, 201, ev);
  }
  const eventMatch = url.match(/^\/api\/events\/([^/]+)$/);
  if (eventMatch && method === 'PATCH') {
    const id = eventMatch[1];
    const body = await readBody(req);
    const data = loadData();
    const ev = data.events.find((e) => e.id === id);
    if (!ev) return sendJson(res, 404, { error: '予定が見つかりません' });
    for (const key of ['title', 'date', 'startTime', 'endTime', 'place', 'detail', 'items', 'prepare', 'travelMin', 'notifyMin', 'repeat']) {
      if (key in body) ev[key] = body[key];
    }
    const idx = data.events.findIndex((e) => e.id === id);
    data.events[idx] = normalizeEvent(ev);
    saveData(data);
    return sendJson(res, 200, data.events[idx]);
  }
  if (eventMatch && method === 'DELETE') {
    const id = eventMatch[1];
    const data = loadData();
    data.events = data.events.filter((e) => e.id !== id);
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  // ===== 目標 =====
  if (url === '/api/goals' && method === 'POST') {
    const body = await readBody(req);
    const title = (body.title || '').toString().trim();
    if (!title) return sendJson(res, 400, { error: '目標名を入力してください' });
    const data = loadData();
    const goal = normalizeGoal({ ...body, title, createdAt: new Date().toISOString() });
    data.goals.unshift(goal);
    saveData(data);
    return sendJson(res, 201, goal);
  }
  const goalMatch = url.match(/^\/api\/goals\/([^/]+)$/);
  if (goalMatch && method === 'PATCH') {
    const id = goalMatch[1];
    const body = await readBody(req);
    const data = loadData();
    const goal = data.goals.find((g) => g.id === id);
    if (!goal) return sendJson(res, 404, { error: '目標が見つかりません' });
    for (const key of ['title', 'purpose', 'due', 'category', 'progress', 'criteria', 'memo']) {
      if (key in body) goal[key] = body[key];
    }
    const idx = data.goals.findIndex((g) => g.id === id);
    data.goals[idx] = normalizeGoal(goal);
    saveData(data);
    return sendJson(res, 200, data.goals[idx]);
  }
  if (goalMatch && method === 'DELETE') {
    const id = goalMatch[1];
    const data = loadData();
    data.goals = data.goals.filter((g) => g.id !== id);
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  // ===== デイリーレビュー =====
  if (url === '/api/daily' && method === 'POST') {
    const body = await readBody(req);
    const hasContent = ['did', 'notDone', 'tomorrow', 'free'].some((k) => (body[k] || '').toString().trim());
    if (!hasContent) return sendJson(res, 400, { error: '振り返りの内容を入力してください' });
    const data = loadData();
    const daily = normalizeDaily({ ...body, createdAt: new Date().toISOString() });
    data.dailyReviews.unshift(daily);
    saveData(data);
    return sendJson(res, 201, daily);
  }
  const dailyMatch = url.match(/^\/api\/daily\/([^/]+)$/);
  if (dailyMatch && method === 'DELETE') {
    const id = dailyMatch[1];
    const data = loadData();
    data.dailyReviews = data.dailyReviews.filter((d) => d.id !== id);
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  // ===== AI（りな）対話 =====
  if (url === '/api/chat' && method === 'POST') {
    const body = await readBody(req);
    const message = (body.message || '').toString().trim();
    if (!message) return sendJson(res, 400, { error: 'メッセージがありません' });
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    if (!hasKey) return sendJson(res, 200, { reply: null, source: 'none' });
    const reply = await callLLM(message, (body.context || '').toString().slice(0, 2000));
    return sendJson(res, 200, { reply: reply || null, source: reply ? 'llm' : 'error' });
  }

  // ===== バックアップの読み込み（インポート：全データを置き換え） =====
  if (url === '/api/import' && method === 'POST') {
    const body = await readBody(req);
    if (!body || typeof body !== 'object') return sendJson(res, 400, { error: '不正なデータ形式です' });
    const data = {
      notes: Array.isArray(body.notes) ? body.notes.map(normalizeNote) : [],
      tasks: Array.isArray(body.tasks) ? body.tasks.map(normalizeTask) : [],
      reviews: Array.isArray(body.reviews) ? body.reviews : [],
      events: Array.isArray(body.events) ? body.events.map(normalizeEvent) : [],
      goals: Array.isArray(body.goals) ? body.goals.map(normalizeGoal) : [],
      dailyReviews: Array.isArray(body.dailyReviews) ? body.dailyReviews.map(normalizeDaily) : [],
      prefs: (body.prefs && typeof body.prefs === 'object') ? body.prefs : {},
    };
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  // ===== 設定（テーマ・通知など） =====
  if (url === '/api/prefs' && method === 'PATCH') {
    const body = await readBody(req);
    const data = loadData();
    data.prefs = { ...data.prefs, ...body };
    saveData(data);
    return sendJson(res, 200, data.prefs);
  }

  return sendJson(res, 404, { error: 'Not Found' });
}

// ---- サーバー本体 ---------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  try {
    if (url.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    // PWA: マニフェスト
    if (url === '/manifest.webmanifest') {
      const manifest = {
        name: '秘書りな — AI Secretary', short_name: '秘書りな',
        start_url: '/', display: 'standalone', background_color: '#0d0f16', theme_color: '#7c74ff',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      };
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
      return res.end(JSON.stringify(manifest));
    }
    // PWA: アイコン（抽象オーブ）
    if (url === '/icon.svg') {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="g" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="42%" stop-color="#9d8bff"/><stop offset="100%" stop-color="#7c74ff"/></radialGradient></defs><rect width="512" height="512" rx="112" fill="#0d0f16"/><circle cx="256" cy="256" r="150" fill="url(#g)"/><circle cx="256" cy="256" r="186" fill="none" stroke="#9d8bff" stroke-width="6" opacity="0.5"/></svg>`;
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(svg);
    }
    // PWA: Service Worker（最小のオフライン・シェル）
    if (url === '/sw.js') {
      const sw = `const C='rina-v1';\nself.addEventListener('install',e=>{self.skipWaiting();});\nself.addEventListener('activate',e=>{self.clients.claim();});\nself.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname.startsWith('/api/'))return;e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request)));});`;
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(sw);
    }

    // それ以外は画面（index.html）を返す
    if (url === '/' || url === '/index.html') {
      const html = fs.readFileSync(INDEX_FILE);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (e) {
    sendJson(res, 500, { error: e.message || 'サーバーエラー' });
  }
});

server.listen(PORT, () => {
  console.log(`秘書アプリを起動しました → http://localhost:${PORT}`);
  console.log('停止するには Ctrl + C を押してください。');
});
