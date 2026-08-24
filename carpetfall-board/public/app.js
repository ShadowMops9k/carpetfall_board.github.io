(function () {
"use strict";

/* ============================== helpers ============================== */
var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
  return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
var $ = function (s, r) { return (r || document).querySelector(s); };
var byId = function (arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; };
var LS = {
  get: function (k, d) { try { var v = localStorage.getItem("cf_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem("cf_" + k, JSON.stringify(v)); } catch (e) {} }
};

var ERRORS = {
  not_in_guild: "Вас нет на Discord-сервере команды. Попросите пригласить — и заходите снова.",
  bad_state: "Сессия входа устарела. Попробуйте ещё раз.",
  no_code: "Discord не вернул код авторизации.",
  token_exchange_failed: "Discord отклонил обмен кода на токен — проверьте CLIENT_SECRET и Redirect URI в настройках приложения.",
  identify_failed: "Не удалось получить профиль из Discord.",
  member_lookup_failed: "Не удалось проверить участие на сервере. Проверьте DISCORD_GUILD_ID.",
  server_error: "Ошибка на сервере доски. Загляните в логи."
};

/* ============================== state ============================== */
var state = null, me = null;
var canEdit = false, canAdmin = false;
var saveState = "idle", saveMsg = "";
var pendingBoard = null, offline = false;
var ui = {
  q: "", hidden: {}, onlyMine: false,
  folded: LS.get("folded", {}), opened: {}, modal: null, draft: {}
};

function statusOf(id) { return byId(state.statuses, id) || state.statuses[0] || { id: "?", name: "—", color: "#66786c" }; }
function memberOf(id) { return byId(state.members, id); }
function initials(n) {
  n = String(n || "?").trim();
  var p = n.split(/[\s_\-.]+/).filter(Boolean);
  return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
}
function avatarHTML(m, cls) {
  if (!m) return '<span class="ava ' + (cls || "") + '">?</span>';
  return m.avatar
    ? '<span class="ava ' + (cls || "") + '"><img src="' + esc(m.avatar) + '" alt="" loading="lazy"></span>'
    : '<span class="ava ' + (cls || "") + '">' + esc(initials(m.name)) + "</span>";
}
function roleLabel(r) { return r === "admin" ? "админ" : r === "editor" ? "редактор" : "смотрит"; }

/* ============================== сервер ============================== */
function setSave(s, m) {
  saveState = s; saveMsg = m;
  var el = $("#saveind");
  if (el) {
    el.className = "save " + (s === "saving" ? "on" : (s === "error" ? "err" : ""));
    el.innerHTML = '<i class="dot"></i>' + esc(m);
  }
}

function applyBoard(b) {
  if (ui.modal) { pendingBoard = b; return; }
  state = b;
  render();
}

function op(payload, mutate) {
  if (!canEdit) return;
  if (mutate) { mutate(); render(); }
  setSave("saving", "Сохранение");
  fetch("/api/ops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
  }).then(function (res) {
    if (!res.ok) {
      if (res.status === 401) { location.reload(); return; }
      setSave("error", res.status === 403 ? "Недостаточно прав" : "Отклонено сервером");
      return fetch("/api/board").then(function (r) { return r.json(); }).then(function (b) { state = b; render(); });
    }
    offline = false;
    state = res.j; render();
    setSave("idle", "Сохранено");
  }).catch(function () {
    offline = true;
    setSave("error", "Нет связи с сервером");
    render();
  });
}

function connect() {
  var es = new EventSource("/api/events");
  es.onmessage = function (e) {
    offline = false;
    try { applyBoard(JSON.parse(e.data)); } catch (err) {}
  };
  es.onerror = function () {
    offline = true;
    var el = $(".offline");
    if (!el) render();
  };
  es.onopen = function () { if (offline) { offline = false; render(); } };
}

/* ============================== render ============================== */
function counts() {
  var m = {}, total = 0;
  state.columns.forEach(function (c) { c.tasks.forEach(function (t) { m[t.status] = (m[t.status] || 0) + 1; total++; }); });
  return { m: m, total: total };
}

function matches(t) {
  if (ui.hidden[t.status]) return false;
  if (ui.onlyMine && me && t.assignee !== me.id) return false;
  if (ui.q) {
    var q = ui.q.toLowerCase();
    var who = t.assignee ? (memberOf(t.assignee) || {}).name || "" : "";
    if ((t.title + " " + (t.desc || "") + " " + who).toLowerCase().indexOf(q) < 0) return false;
  }
  return true;
}

function cardHTML(t, colId) {
  var st = statusOf(t.status);
  var who = t.assignee ? memberOf(t.assignee) : null;
  var open = !!ui.opened[t.id];
  var kv = '<span class="kv"><span>' + esc(st.name) + "</span>" + (who ? '<span>· ' + esc(who.name) + "</span>" : "") + "</span>";
  var extra = '<div class="reveal"><div class="inner"><div class="body">'
    + (t.desc ? esc(t.desc) : '<span style="opacity:.6">без описания</span>')
    + kv + "</div></div></div>";
  return '<div class="tile card' + (open ? " open" : "") + '" style="--c:' + esc(st.color) + '" '
    + 'tabindex="0" role="button" data-task="' + esc(t.id) + '" data-col="' + esc(colId) + '" '
    + 'title="' + esc(t.title) + (t.desc ? " — " + esc(t.desc.slice(0, 120)) : "") + '">'
    + (t.desc ? '<span class="mark" data-x="1">▤</span>' : "")
    + (who ? '<span class="who" data-x="1">' + esc(initials(who.name)) + "</span>" : "")
    + '<span class="ttl">' + esc(t.title) + "</span>" + extra + "</div>";
}

function colHTML(c) {
  var st = statusOf(c.status);
  var vis = c.tasks.filter(matches);
  var folded = !!ui.folded[c.id];
  var h = '<div class="col" data-colwrap="' + esc(c.id) + '">';
  h += '<div class="tile base" tabindex="0" role="button" style="--c:' + esc(st.color) + '" data-col="' + esc(c.id) + '" '
    + 'title="' + esc(c.name) + ' — нажмите, чтобы свернуть' + (canAdmin ? "; двойной клик — настройки раздела" : "") + '">'
    + '<span class="fold" data-x="1">' + (folded ? "▸" : "▾") + "</span>"
    + '<span class="count" data-x="1">' + vis.length + (vis.length !== c.tasks.length ? "/" + c.tasks.length : "") + "</span>"
    + "<span>" + esc(c.name) + "</span></div>";
  if (!folded) {
    if (canEdit) h += '<button class="addcard" data-addcard="' + esc(c.id) + '">+ таск</button>';
    vis.forEach(function (t) { h += cardHTML(t, c.id); });
  }
  h += "</div>";
  return h;
}

function render() {
  if (!me) { renderGate(); return; }
  var prevBw = $(".boardwrap");
  var keep = prevBw ? { t: prevBw.scrollTop, l: prevBw.scrollLeft } : null;
  var cs = counts();
  var h = '<div class="shell">';

  h += '<div class="nav">'
    + '<div class="brand"><b>Carpet<i>FALL</i></b><span>' + esc(state.subtitle || "Дорожная карта") + "</span></div>"
    + '<div class="navlinks">'
    + (canAdmin ? '<button class="btn" data-open="column">+ Раздел</button>' : "")
    + (canAdmin ? '<button class="btn" data-open="statuses">Статусы</button>' : "")
    + '<button class="btn" data-open="team">Команда</button>'
    + '<button class="btn ghost" data-fold="all">Свернуть всё</button>'
    + '<button class="btn ghost" data-fold="none">Развернуть</button>'
    + "</div>"
    + '<div class="spacer"></div>'
    + '<span id="saveind" class="save ' + (saveState === "saving" ? "on" : (saveState === "error" ? "err" : "")) + '">'
    + '<i class="dot"></i>' + esc(saveMsg || (canEdit ? "Сохранено" : "Только просмотр")) + "</span>"
    + '<button class="user" data-open="me">' + avatarHTML(me)
    + '<span class="nm">' + esc(me.name) + "</span>"
    + '<span class="role ' + esc(me.role) + '">' + esc(roleLabel(me.role)) + "</span></button>"
    + "</div>";

  h += '<div class="frame"><div class="toolbar">'
    + '<div class="search"><input class="field" id="q" placeholder="поиск по таскам" value="' + esc(ui.q) + '"></div>'
    + '<div class="chips">';
  state.statuses.forEach(function (s) {
    h += '<button class="chip' + (ui.hidden[s.id] ? " off" : "") + '" style="--c:' + esc(s.color) + '" data-tog="' + esc(s.id) + '">'
      + '<i class="dot"></i>' + esc(s.name) + ' <span class="n">' + (cs.m[s.id] || 0) + "</span></button>";
  });
  h += "</div>";
  h += '<button class="chip' + (ui.onlyMine ? "" : " off") + '" style="--c:#3af080" data-mine="1"><i class="dot"></i>Только мои</button>';
  h += '<div class="progress" title="Всего тасков: ' + cs.total + '">';
  state.statuses.forEach(function (s) {
    var w = cs.total ? ((cs.m[s.id] || 0) / cs.total * 100) : 0;
    if (w > 0) h += '<i style="--c:' + esc(s.color) + ";width:" + w.toFixed(2) + '%"></i>';
  });
  h += '</div><span class="meta">' + cs.total + " тасков · " + state.columns.length + " разделов</span>"
    + '<span class="zoom"><button class="btn ghost" data-zoom="-1" title="Мельче">–</button>'
    + '<button class="btn ghost" data-zoom="1" title="Крупнее">+</button></span>';
  h += "</div>";

  h += '<div class="boardwrap"><div class="board">';
  if (!state.columns.length) h += '<div class="empty">Разделов пока нет.' + (canAdmin ? " Нажмите «+ Раздел», чтобы начать." : "") + "</div>";
  else state.columns.forEach(function (c) { h += colHTML(c); });
  if (canAdmin) h += '<button class="addcol" data-open="column">+ раздел</button>';
  h += "</div></div></div>";

  if (!canEdit) h += '<div class="warn">У вашей роли на Discord-сервере нет прав редактирования — доска открыта только на просмотр.</div>';
  h += "</div>";

  if (offline) h += '<div class="offline">Связь с сервером потеряна — переподключаюсь…</div>';

  document.getElementById("root").innerHTML = h;

  applyZoom();
  var bw = $(".boardwrap");
  if (bw) {
    if (keep) { bw.scrollLeft = keep.l; bw.scrollTop = keep.t; }
    else bw.scrollTop = bw.scrollHeight;
  }
  if (ui.modal) drawModal();
}

function applyZoom() { document.documentElement.style.setProperty("--z", LS.get("zoom", 1)); }

function renderGate() {
  var err = new URLSearchParams(location.search).get("error");
  var h = '<div class="gate"><div class="gatebox">'
    + '<div class="logo">Carpet<i>FALL</i></div>'
    + '<div class="sub">Дорожная карта разработки</div>'
    + (err ? '<div class="err">' + esc(ERRORS[err] || ("Вход не удался: " + err)) + "</div>" : "")
    + '<p class="note" style="margin-bottom:20px">Доска команды. Вход только для участников нашего Discord-сервера<span class="caret">&nbsp;</span></p>'
    + '<button class="discord" data-login="1">'
    + '<svg viewBox="0 -28.5 256 256" aria-hidden="true"><path d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193A161.094 161.094 0 0 0 79.735 175.3a136.413 136.413 0 0 1-21.846-10.632 108.636 108.636 0 0 0 5.356-4.237c42.122 19.702 87.89 19.702 129.51 0a131.66 131.66 0 0 0 5.355 4.237 136.07 136.07 0 0 1-21.886 10.653c4.006 8.02 8.638 15.67 13.873 22.848 21.142-6.58 42.646-16.637 64.815-33.213 5.316-56.288-9.08-105.09-38.056-148.36ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18s10.149-26.2 23.015-26.2c12.867 0 23.236 11.804 23.015 26.2.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.014-11.805-23.014-26.18s10.148-26.2 23.014-26.2c12.867 0 23.236 11.804 23.015 26.2 0 14.375-10.148 26.18-23.015 26.18Z"/></svg>'
    + "Войти через Discord</button>"
    + "</div></div>";
  document.getElementById("root").innerHTML = h;
}

/* ============================== modals ============================== */
function openModal(m) { ui.modal = m; drawModal(); }
function closeModal() {
  ui.modal = null;
  var s = $(".scrim"); if (s) s.remove();
  if (pendingBoard) { state = pendingBoard; pendingBoard = null; render(); }
}

function statusPicker(sel) {
  var h = '<div class="picker">';
  state.statuses.forEach(function (s) {
    h += '<button type="button" class="pick" style="--c:' + esc(s.color) + '" data-pickstatus="' + esc(s.id)
      + '" aria-pressed="' + (s.id === sel ? "true" : "false") + '">' + esc(s.name) + "</button>";
  });
  return h + "</div>";
}
function memberOptions(sel) {
  var h = '<option value="">— не назначен —</option>';
  state.members.forEach(function (m) {
    h += '<option value="' + esc(m.id) + '"' + (m.id === sel ? " selected" : "") + ">" + esc(m.name) + "</option>";
  });
  return h;
}

function drawModal() {
  var old = $(".scrim"); if (old) old.remove();
  var m = ui.modal; if (!m) return;
  var h = "";

  if (m.type === "task") {
    var col = byId(state.columns, m.colId); if (!col) { closeModal(); return; }
    var t = m.taskId ? byId(col.tasks, m.taskId) : null;
    var isNew = !t;
    if (!t) t = { id: "", title: "", desc: "", status: (state.statuses[1] || state.statuses[0]).id, assignee: me.id, author: me.name, created: Date.now() };
    var dt = t.created ? new Date(t.created).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }) : "";
    h = '<div class="modal" role="dialog" aria-modal="true">'
      + "<h2>" + (isNew ? "Новый таск" : "Таск") + " · " + esc(col.name) + '<button class="btn ghost x" data-close="1">✕</button></h2>'
      + '<div class="mbody">'
      + '<div><label class="lbl" for="t-title">Название</label>'
      + '<input class="field" id="t-title" value="' + esc(t.title) + '" placeholder="Что нужно сделать" autocomplete="off"></div>'
      + '<div><label class="lbl">Статус</label>' + statusPicker(t.status) + "</div>"
      + '<div class="row">'
      + '<div><label class="lbl" for="t-who">Исполнитель</label><select class="field" id="t-who">' + memberOptions(t.assignee) + "</select></div>"
      + '<div><label class="lbl" for="t-col">Раздел</label><select class="field" id="t-col">'
      + state.columns.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === col.id ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("")
      + "</select></div></div>"
      + '<div><label class="lbl" for="t-desc">Описание</label>'
      + '<textarea class="field" id="t-desc" placeholder="Детали, ссылки, критерии готовности">' + esc(t.desc || "") + "</textarea></div>"
      + (isNew ? "" : '<div class="meta">' + esc([t.author ? "создал " + t.author : "", dt].filter(Boolean).join(" · ")) + "</div>")
      + "</div>"
      + '<div class="mfoot">'
      + (isNew ? "" : '<button class="btn danger" data-deltask="1">Удалить</button>')
      + '<div class="spacer"></div>'
      + '<button class="btn" data-close="1">Отмена</button>'
      + '<button class="btn primary" data-savetask="1">' + (isNew ? "Создать" : "Сохранить") + "</button>"
      + "</div></div>";
    ui.draft = { status: t.status };
  }

  if (m.type === "column") {
    var c = m.colId ? byId(state.columns, m.colId) : null;
    var isNewC = !c;
    if (!c) c = { id: "", name: "", status: (state.statuses[1] || state.statuses[0]).id, tasks: [] };
    h = '<div class="modal" role="dialog" aria-modal="true">'
      + "<h2>" + (isNewC ? "Новый раздел" : "Раздел") + '<button class="btn ghost x" data-close="1">✕</button></h2>'
      + '<div class="mbody">'
      + '<div><label class="lbl" for="c-name">Название</label>'
      + '<input class="field" id="c-name" value="' + esc(c.name) + '" placeholder="Например: Мобы" autocomplete="off"></div>'
      + '<div><label class="lbl">Статус раздела</label>' + statusPicker(c.status) + "</div>"
      + (isNewC ? "" : '<div><label class="lbl">Порядок</label><div class="picker">'
        + '<button type="button" class="btn" data-movecol="-1">← левее</button>'
        + '<button type="button" class="btn" data-movecol="1">правее →</button></div></div>')
      + "</div>"
      + '<div class="mfoot">'
      + (isNewC ? "" : '<button class="btn danger" data-delcol="1">Удалить раздел</button>')
      + '<div class="spacer"></div>'
      + '<button class="btn" data-close="1">Отмена</button>'
      + '<button class="btn primary" data-savecol="1">' + (isNewC ? "Создать" : "Сохранить") + "</button>"
      + "</div></div>";
    ui.draft = { status: c.status };
  }

  if (m.type === "statuses") {
    h = '<div class="modal wide" role="dialog" aria-modal="true">'
      + '<h2>Статусы<button class="btn ghost x" data-close="1">✕</button></h2>'
      + '<div class="mbody"><p class="note">Названия и цвета статусов общие для всей команды. Удалить можно любой, кроме последнего — его таски переедут на первый в списке.</p>'
      + '<div class="list">';
    state.statuses.forEach(function (s) {
      h += '<div class="listrow">'
        + '<input type="color" value="' + esc(s.color) + '" data-stcolor="' + esc(s.id) + '" aria-label="Цвет статуса">'
        + '<input class="field" value="' + esc(s.name) + '" data-stname="' + esc(s.id) + '" aria-label="Название статуса">'
        + '<button class="btn ghost" data-stmove="' + esc(s.id) + '" data-dir="-1" title="Выше">▲</button>'
        + '<button class="btn ghost" data-stmove="' + esc(s.id) + '" data-dir="1" title="Ниже">▼</button>'
        + '<button class="btn danger" data-stdel="' + esc(s.id) + '" title="Удалить">✕</button>'
        + "</div>";
    });
    h += '</div><button class="btn" data-addstatus="1">+ Добавить статус</button></div>'
      + '<div class="mfoot"><div class="spacer"></div><button class="btn primary" data-close="1">Готово</button></div></div>';
  }

  if (m.type === "team") {
    h = '<div class="modal" role="dialog" aria-modal="true">'
      + '<h2>Команда<button class="btn ghost x" data-close="1">✕</button></h2>'
      + '<div class="mbody"><p class="note">Список тех, кто уже заходил на доску. Роли приходят из Discord — меняются ролями на сервере, а не здесь.</p>'
      + '<div class="list">';
    if (!state.members.length) h += '<div class="note">Пока никого нет.</div>';
    state.members.forEach(function (mm) {
      h += '<div class="listrow">' + avatarHTML(mm)
        + '<span class="who-name">' + esc(mm.name) + "</span>"
        + '<span class="role ' + esc(mm.role) + '">' + esc(roleLabel(mm.role)) + "</span></div>";
    });
    h += "</div></div>"
      + '<div class="mfoot"><div class="spacer"></div><button class="btn primary" data-close="1">Готово</button></div></div>';
  }

  if (m.type === "me") {
    h = '<div class="modal" role="dialog" aria-modal="true">'
      + '<h2>Профиль<button class="btn ghost x" data-close="1">✕</button></h2>'
      + '<div class="mbody"><div class="listrow">' + avatarHTML(me)
      + '<span class="who-name">' + esc(me.name) + "</span>"
      + '<span class="role ' + esc(me.role) + '">' + esc(roleLabel(me.role)) + "</span></div>"
      + '<p class="note">'
      + (me.role === "admin" ? "Полные права: разделы, статусы, удаление тасков."
        : me.role === "editor" ? "Можете создавать, править и двигать таски. Структуру доски меняют админы."
        : "Доска открыта на просмотр. Права выдаются ролью на Discord-сервере.")
      + "</p></div>"
      + '<div class="mfoot"><div class="spacer"></div><button class="btn ghost" data-logout="1">Выйти</button></div></div>';
  }

  var scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = h;
  document.getElementById("root").appendChild(scrim);
  var f = scrim.querySelector("input.field,textarea.field");
  if (f) setTimeout(function () { f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); }, 20);
}

/* ============================== events ============================== */
var suppressClick = false;

document.addEventListener("click", function (e) {
  var el;
  if (suppressClick) { suppressClick = false; return; }
  if (!e.target || !e.target.closest) return;

  if (e.target.closest("[data-login]")) { location.href = "/auth/login"; return; }
  if (e.target.closest("[data-logout]")) {
    fetch("/auth/logout", { method: "POST" }).then(function () { location.href = "/"; });
    return;
  }
  if (e.target.classList && e.target.classList.contains("scrim")) { closeModal(); return; }
  if (e.target.closest("[data-close]")) { closeModal(); return; }

  if ((el = e.target.closest("[data-open]"))) {
    var k = el.getAttribute("data-open");
    if ((k === "column" || k === "statuses") && !canAdmin) return;
    openModal({ type: k });
    return;
  }

  if ((el = e.target.closest("[data-tog]"))) {
    var sid = el.getAttribute("data-tog");
    if (ui.hidden[sid]) delete ui.hidden[sid]; else ui.hidden[sid] = true;
    render(); return;
  }
  if (e.target.closest("[data-mine]")) { ui.onlyMine = !ui.onlyMine; render(); return; }
  if ((el = e.target.closest("[data-zoom]"))) {
    var z = Math.min(1.45, Math.max(0.72, LS.get("zoom", 1) + (+el.getAttribute("data-zoom")) * 0.12));
    LS.set("zoom", z); applyZoom(); return;
  }
  if ((el = e.target.closest("[data-fold]"))) {
    var mode = el.getAttribute("data-fold");
    ui.folded = {};
    if (mode === "all") state.columns.forEach(function (c) { ui.folded[c.id] = true; });
    LS.set("folded", ui.folded); render(); return;
  }

  if ((el = e.target.closest("[data-addcard]"))) {
    if (!canEdit) return;
    openModal({ type: "task", colId: el.getAttribute("data-addcard") });
    return;
  }

  if ((el = e.target.closest(".tile.base"))) {
    var cid = el.getAttribute("data-col");
    if (ui.folded[cid]) delete ui.folded[cid]; else ui.folded[cid] = true;
    LS.set("folded", ui.folded); render(); return;
  }

  if ((el = e.target.closest(".tile.card"))) {
    var tid = el.getAttribute("data-task");
    if ((e.target.getAttribute && e.target.getAttribute("data-x") === "1") || !canEdit) {
      if (ui.opened[tid]) delete ui.opened[tid]; else ui.opened[tid] = true;
      render(); return;
    }
    openModal({ type: "task", colId: el.getAttribute("data-col"), taskId: tid });
    return;
  }

  if ((el = e.target.closest("[data-pickstatus]"))) {
    ui.draft.status = el.getAttribute("data-pickstatus");
    Array.prototype.forEach.call(el.parentNode.querySelectorAll("[data-pickstatus]"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-pickstatus") === ui.draft.status ? "true" : "false");
    });
    return;
  }

  /* ── таски ── */
  if (e.target.closest("[data-savetask]")) {
    var m = ui.modal;
    var title = $("#t-title").value.trim();
    if (!title) { $("#t-title").focus(); return; }
    var payload = {
      title: title, desc: $("#t-desc").value,
      status: ui.draft.status, assignee: $("#t-who").value || null
    };
    var destId = $("#t-col").value;
    if (m.taskId) {
      payload.type = "task.update"; payload.taskId = m.taskId;
      var moveTo = destId !== m.colId ? destId : null;
      closeModal();
      op(payload);
      if (moveTo) op({ type: "task.move", taskId: m.taskId, toColId: moveTo });
    } else {
      payload.type = "task.create"; payload.colId = destId || m.colId;
      closeModal();
      op(payload);
    }
    return;
  }
  if (e.target.closest("[data-deltask]")) {
    var mm = ui.modal, cc = byId(state.columns, mm.colId);
    var tt = cc && byId(cc.tasks, mm.taskId);
    if (tt && confirm("Удалить таск «" + tt.title + "»?")) {
      closeModal();
      op({ type: "task.delete", taskId: mm.taskId });
    }
    return;
  }

  /* ── разделы ── */
  if (e.target.closest("[data-savecol]")) {
    var mc = ui.modal;
    var nm = $("#c-name").value.trim();
    if (!nm) { $("#c-name").focus(); return; }
    var body = mc.colId
      ? { type: "column.update", colId: mc.colId, name: nm, status: ui.draft.status }
      : { type: "column.create", name: nm, status: ui.draft.status };
    closeModal();
    op(body);
    return;
  }
  if (e.target.closest("[data-delcol]")) {
    var c3 = byId(state.columns, ui.modal.colId);
    if (c3 && confirm("Удалить раздел «" + c3.name + "» и все " + c3.tasks.length + " тасков в нём?")) {
      var id3 = c3.id; closeModal();
      op({ type: "column.delete", colId: id3 });
    }
    return;
  }
  if ((el = e.target.closest("[data-movecol]"))) {
    var dir = +el.getAttribute("data-movecol");
    var c4 = byId(state.columns, ui.modal.colId);
    var i4 = state.columns.indexOf(c4) + dir;
    if (i4 >= 0 && i4 < state.columns.length) op({ type: "column.move", colId: c4.id, index: i4 });
    return;
  }

  /* ── статусы ── */
  if (e.target.closest("[data-addstatus]")) { op({ type: "status.create", name: "Новый статус", color: "#5ec8b0" }); return; }
  if ((el = e.target.closest("[data-stdel]"))) {
    if (state.statuses.length < 2) return;
    op({ type: "status.delete", statusId: el.getAttribute("data-stdel") });
    return;
  }
  if ((el = e.target.closest("[data-stmove]"))) {
    var s3 = byId(state.statuses, el.getAttribute("data-stmove"));
    var j3 = state.statuses.indexOf(s3) + (+el.getAttribute("data-dir"));
    if (j3 >= 0 && j3 < state.statuses.length) op({ type: "status.move", statusId: s3.id, index: j3 });
    return;
  }
});

document.addEventListener("dblclick", function (e) {
  if (!e.target || !e.target.closest || !canAdmin) return;
  var el = e.target.closest(".tile.base");
  if (el) openModal({ type: "column", colId: el.getAttribute("data-col") });
});

document.addEventListener("input", function (e) {
  if (e.target.id === "q") {
    ui.q = e.target.value;
    clearTimeout(ui._qt);
    ui._qt = setTimeout(function () {
      render();
      var q = $("#q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    }, 160);
  }
});

document.addEventListener("change", function (e) {
  var el = e.target, id;
  if ((id = el.getAttribute("data-stname"))) op({ type: "status.update", statusId: id, name: el.value });
  else if ((id = el.getAttribute("data-stcolor"))) op({ type: "status.update", statusId: id, color: el.value });
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") { if ($(".scrim")) closeModal(); return; }
  if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("tile")) {
    e.preventDefault(); e.target.click(); return;
  }
  if (e.key === "Enter") {
    if (e.target.id === "t-title" || e.target.id === "c-name") {
      e.preventDefault();
      var b = $(".scrim [data-savetask]") || $(".scrim [data-savecol]");
      if (b) b.click();
    }
  }
});

/* ============================== drag & drop ============================== */
var drag = null;

function endDrag() {
  if (!drag) return;
  if (drag.ghost) drag.ghost.remove();
  if (drag.el) drag.el.classList.remove("dragging");
  Array.prototype.forEach.call(document.querySelectorAll(".col.dragover"), function (n) { n.classList.remove("dragover"); });
  document.body.classList.remove("dnd");
  document.body.style.userSelect = "";
  drag = null;
}

document.addEventListener("pointerdown", function (e) {
  if (!canEdit || e.button !== 0 || e.pointerType === "touch") return;
  if (!e.target || !e.target.closest) return;
  var card = e.target.closest(".tile.card");
  if (!card) return;
  drag = { id: card.getAttribute("data-task"), el: card, x0: e.clientX, y0: e.clientY, started: false, col: null };
});

document.addEventListener("pointermove", function (e) {
  if (!drag) return;
  if (!drag.started) {
    if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 6) return;
    drag.started = true;
    var r = drag.el.getBoundingClientRect();
    var g = document.createElement("div");
    g.className = "tile card drag-ghost";
    g.style.width = r.width + "px";
    g.style.setProperty("--c", getComputedStyle(drag.el).getPropertyValue("--c").trim() || "#3af080");
    g.textContent = drag.el.querySelector(".ttl") ? drag.el.querySelector(".ttl").textContent : drag.el.textContent;
    document.body.appendChild(g);
    drag.ghost = g; drag.ox = r.width / 2; drag.oy = r.height / 2;
    drag.el.classList.add("dragging");
    document.body.classList.add("dnd");
    document.body.style.userSelect = "none";
  }
  e.preventDefault();
  drag.ghost.style.transform = "translate(" + (e.clientX - drag.ox) + "px," + (e.clientY - drag.oy) + "px)";
  drag.ghost.style.visibility = "hidden";
  var under = document.elementFromPoint(e.clientX, e.clientY);
  drag.ghost.style.visibility = "";
  var col = (under && under.closest) ? under.closest(".col") : null;
  if (col !== drag.col) {
    Array.prototype.forEach.call(document.querySelectorAll(".col.dragover"), function (n) { n.classList.remove("dragover"); });
    if (col) col.classList.add("dragover");
    drag.col = col;
  }
  var bw = $(".boardwrap");
  if (bw) {
    var br = bw.getBoundingClientRect();
    if (e.clientX > br.right - 70) bw.scrollLeft += 18;
    else if (e.clientX < br.left + 70) bw.scrollLeft -= 18;
  }
}, { passive: false });

document.addEventListener("pointerup", function (e) {
  if (!drag) return;
  var d = drag;
  if (!d.started) { endDrag(); return; }
  suppressClick = true; setTimeout(function () { suppressClick = false; }, 0);
  var col = d.col;
  if (!col) { endDrag(); return; }
  var colId = col.getAttribute("data-colwrap");
  var target = byId(state.columns, colId);
  if (!target) { endDrag(); return; }
  var cards = Array.prototype.slice.call(col.querySelectorAll(".tile.card")).filter(function (c) { return c !== d.el; });
  var below = cards.filter(function (cd) {
    var r = cd.getBoundingClientRect();
    return (r.top + r.height / 2) >= e.clientY;
  });
  var idx = 0;
  if (below.length) {
    var lastId = below[below.length - 1].getAttribute("data-task");
    for (var k = 0; k < target.tasks.length; k++) if (target.tasks[k].id === lastId) { idx = k + 1; break; }
  }
  var from = null;
  state.columns.forEach(function (c) {
    var i = c.tasks.findIndex(function (t) { return t.id === d.id; });
    if (i >= 0) from = { col: c, i: i };
  });
  if (from && from.col.id === colId && from.i < idx) idx--;
  endDrag();
  if (!from) return;
  var moved = from.col.tasks[from.i];
  op({ type: "task.move", taskId: d.id, toColId: colId, index: idx }, function () {
    from.col.tasks.splice(from.i, 1);
    target.tasks.splice(Math.max(0, Math.min(idx, target.tasks.length)), 0, moved);
  });
});

document.addEventListener("pointercancel", endDrag);
window.addEventListener("blur", endDrag);

/* ============================== boot ============================== */
Promise.all([
  fetch("/api/me").then(function (r) { return r.json(); }),
  fetch("/api/board").then(function (r) { return r.ok ? r.json() : null; })
]).then(function (res) {
  me = res[0].user;
  if (!me) { renderGate(); return; }
  canAdmin = me.role === "admin";
  canEdit = me.role === "admin" || me.role === "editor";
  state = res[1];
  if (!state) { renderGate(); return; }
  if (location.search) history.replaceState(null, "", location.pathname);
  render();
  connect();
}).catch(function () {
  document.getElementById("root").innerHTML =
    '<div class="gate"><div class="gatebox"><div class="logo">Carpet<i>FALL</i></div>'
    + '<p class="note">Сервер доски не отвечает. Проверьте, что он запущен.</p></div></div>';
});
})();
