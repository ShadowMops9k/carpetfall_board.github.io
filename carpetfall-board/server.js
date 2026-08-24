import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ────────────────────────────── конфиг ────────────────────────────── */
loadEnvFile(path.join(__dirname, ".env"));

const CFG = {
  clientId:     req("DISCORD_CLIENT_ID"),
  clientSecret: req("DISCORD_CLIENT_SECRET"),
  baseUrl:      (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, ""),
  guildId:      req("DISCORD_GUILD_ID"),
  adminRoles:   list(process.env.ADMIN_ROLE_IDS),
  editorRoles:  list(process.env.EDITOR_ROLE_IDS),
  adminUsers:   list(process.env.ADMIN_USER_IDS),
  // игровые панели (Pterodactyl и родня) отдают порт и IP своими переменными
  port:         Number(process.env.PORT || process.env.SERVER_PORT || 3000),
  host:         process.env.SERVER_IP || "0.0.0.0",
  secret:       process.env.SESSION_SECRET || "",
};
if (!CFG.secret || CFG.secret === "change-me-to-a-long-random-string") {
  console.error("\n  SESSION_SECRET не задан в .env.");
  console.error("  Сгенерируйте:  openssl rand -hex 32\n");
  process.exit(1);
}
const REDIRECT_URI = CFG.baseUrl + "/auth/callback";
const SECURE_COOKIE = CFG.baseUrl.startsWith("https://");

function req(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n  В .env не заполнено ${name}. Скопируйте .env.example в .env и заполните.\n`);
    process.exit(1);
  }
  return v;
}
function list(v) { return String(v || "").split(",").map(s => s.trim()).filter(Boolean); }
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

/* ────────────────────────────── хранилище ────────────────────────────── */
const DATA_DIR  = path.join(__dirname, "data");
const BOARD_FILE = path.join(DATA_DIR, "board.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

let board = fs.existsSync(BOARD_FILE)
  ? JSON.parse(fs.readFileSync(BOARD_FILE, "utf8"))
  : seedBoard();
board.users ||= {};
board.version ||= 1;

let writeQueued = false;
function persist() {
  board.version++;
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    const tmp = BOARD_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(board, null, 1));
    fs.renameSync(tmp, BOARD_FILE);
  }, 120);
}

function seedBoard() {
  const uid = () => crypto.randomBytes(5).toString("hex");
  const S = [
    { id: "done", name: "Готово",   color: "#3ac96a" },
    { id: "wip",  name: "В работе", color: "#b0a45c" },
    { id: "bug",  name: "Проблема", color: "#b04a44" },
    { id: "hold", name: "Отложено", color: "#66786c" },
  ];
  const t = (title, status) => ({ id: uid(), title, desc: "", status, assignee: null, author: null, created: Date.now() });
  const c = (name, status, tasks) => ({ id: uid(), name, status, tasks: tasks.map(x => t(x[0], x[1])) });
  return {
    version: 1,
    subtitle: "Дорожная карта",
    statuses: S,
    users: {},
    columns: [
      c("Добыча", "wip", [["Деревья","done"],["Камни: мелкие / крупные","wip"],["Растения / грибы","wip"]]),
      c("Силовая броня", "done", [["Убрать верстаки","hold"],["Пофиксить баги","hold"]]),
      c("Система рук", "wip", [["Оружия","done"],["Помп. дробовик","done"],["Штык-нож","done"],["Кий","wip"],["Гранаты","wip"],["АК-47","wip"],["SPAS","done"],["Снайперская винтовка","done"],["Deagle","done"],["Макаров","wip"],["10-мм пистолет","wip"],["Топор","wip"],["Кирка","wip"],["Бензопила","wip"],["Бур","wip"],["М-16","wip"],["Двустволка","done"]]),
      c("Лодка", "bug", [["Физика","wip"],["Многопользовательское использование","hold"],["Вход игрока через катсцену","hold"],["Пофиксить баги","hold"]]),
      c("Квесты", "bug", [["Диалоги","wip"]]),
      c("Физика", "done", [["Пропы","done"],["Машины","wip"],["Предметы","wip"]]),
      c("Бильярд", "wip", [["Доработка сессий","hold"]]),
      c("Мин. механики", "done", [["Дождь","done"],["Загрузчик моделей","done"],["Фикс обновлений блоков","done"],["Физ. предметы","wip"]]),
      c("Катсцены", "done", [["Гестуры","wip"]]),
      c("Фурнитура (стафф)", "done", [["Правки","done"]]),
      c("Создание персонажа", "wip", [["Билды","done"],["Админ S.P.E.C.I.A.L.","done"],["Атрибуты S.P.E.C.I.A.L.","done"],["Навыки (скиллы)","done"],["Способности (перки)","wip"],["Происхождение","wip"]]),
      c("Игрок", "done", [["Уровень","done"],["Радиация","done"],["ХП","done"],["Инвентарь","done"]]),
      c("Плагин", "done", [["Чат","done"],["Таб","done"],["АФК-мод","done"],["Чат-бабло","done"],["Предметы","done"]]),
      c("UI / Menu", "wip", [["Движок","done"],["Сайт","wip"],["Pip-Boy","wip"],["S.P.E.C.I.A.L.","wip"],["Интерфейс торговли с НПС","bug"],["HUD","wip"]]),
      c("Система строительства", "hold", []),
      c("Мобы", "wip", [["Медведь","done"],["Игорь","done"],["Гуль","done"],["Рад. скорпион","wip"],["Болотник","wip"],["Рад. таракан","wip"],["Рад. олень","wip"],["Робот-охранник","wip"],["Штурмотрон","hold"],["Кротокрыс","wip"],["Брамин","wip"],["Дутень","hold"],["Гнус","wip"],["Рейдеры","wip"],["Супер-мутанты","wip"],["Коготь смерти","wip"]]),
    ],
  };
}

/* ────────────────────────────── сессии ────────────────────────────── */
const b64u  = b => Buffer.from(b).toString("base64url");
const unb64 = s => Buffer.from(s, "base64url").toString("utf8");
const sign  = d => crypto.createHmac("sha256", CFG.secret).update(d).digest("base64url");

function makeToken(payload) {
  const body = b64u(JSON.stringify(payload));
  return body + "." + sign(body);
}
function readToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const good = sign(body);
  if (mac.length !== good.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(unb64(body));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setCookie(res, name, value, maxAgeSec) {
  const bits = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (SECURE_COOKIE) bits.push("Secure");
  bits.push(`Max-Age=${maxAgeSec}`);
  res.append("Set-Cookie", bits.join("; "));
}

/* ────────────────────────────── права ────────────────────────────── */
function roleFor(userId, discordRoles) {
  if (CFG.adminUsers.includes(userId)) return "admin";
  if (CFG.adminRoles.some(r => discordRoles.includes(r))) return "admin";
  if (!CFG.editorRoles.length) return "editor";
  if (CFG.editorRoles.some(r => discordRoles.includes(r))) return "editor";
  return "viewer";
}

/* ────────────────────────────── приложение ────────────────────────────── */
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((r, _res, next) => { r.cookies = parseCookies(r.headers.cookie); next(); });

function auth(req, _res, next) {
  req.user = readToken(req.cookies.cf_session);
  next();
}
app.use(auth);

const needRole = need => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "not_authenticated" });
  const rank = { viewer: 0, editor: 1, admin: 2 };
  if (rank[req.user.role] < rank[need]) {
    return res.status(403).json({ error: "forbidden", need });
  }
  next();
};

/* ── OAuth2 ── */
app.get("/auth/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  setCookie(res, "cf_oauth", state, 600);
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", CFG.clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds guilds.members.read");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "none");
  res.redirect(url.toString());
});

app.get("/auth/callback", async (req, res) => {
  const fail = reason => res.redirect("/?error=" + encodeURIComponent(reason));
  try {
    if (!req.query.code) return fail("no_code");
    if (!req.query.state || req.query.state !== req.cookies.cf_oauth) return fail("bad_state");

    const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CFG.clientId,
        client_secret: CFG.clientSecret,
        grant_type: "authorization_code",
        code: String(req.query.code),
        redirect_uri: REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) return fail("token_exchange_failed");
    const token = await tokenRes.json();
    const bearer = { Authorization: `Bearer ${token.access_token}` };

    const meRes = await fetch("https://discord.com/api/v10/users/@me", { headers: bearer });
    if (!meRes.ok) return fail("identify_failed");
    const me = await meRes.json();

    const memberRes = await fetch(
      `https://discord.com/api/v10/users/@me/guilds/${CFG.guildId}/member`, { headers: bearer });
    if (memberRes.status === 404) return fail("not_in_guild");
    if (!memberRes.ok) return fail("member_lookup_failed");
    const member = await memberRes.json();

    const role = roleFor(me.id, member.roles || []);
    if (role === "viewer" && CFG.editorRoles.length === 0) {
      /* невозможно, но пусть будет явно */
    }

    const name = member.nick || me.global_name || me.username;
    const avatar = me.avatar
      ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${(BigInt(me.id) >> 22n) % 6n}.png`;

    board.users[me.id] = { id: me.id, name, avatar, role, seen: Date.now() };
    persist();
    broadcast();

    setCookie(res, "cf_session", makeToken({
      id: me.id, name, avatar, role, exp: Date.now() + 30 * 24 * 3600 * 1000,
    }), 30 * 24 * 3600);
    setCookie(res, "cf_oauth", "", 0);
    res.redirect("/");
  } catch (e) {
    console.error("OAuth error:", e);
    fail("server_error");
  }
});

app.post("/auth/logout", (req, res) => { setCookie(res, "cf_session", "", 0); res.json({ ok: true }); });

/* ── данные ── */
app.get("/api/me", (req, res) => res.json({ user: req.user || null }));
app.get("/api/board", needRole("viewer"), (req, res) => res.json(publicBoard()));

function publicBoard() {
  return {
    version: board.version,
    subtitle: board.subtitle,
    statuses: board.statuses,
    columns: board.columns,
    members: Object.values(board.users).sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
}

/* ── SSE: живое обновление у всех открытых вкладок ── */
const clients = new Set();
app.get("/api/events", needRole("viewer"), (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": ok\n\n");
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
});
function broadcast() {
  const data = `data: ${JSON.stringify(publicBoard())}\n\n`;
  for (const c of clients) { try { c.write(data); } catch {} }
}

/* ── операции ── */
const findCol  = id => board.columns.find(c => c.id === id);
const findTask = id => {
  for (const c of board.columns) {
    const i = c.tasks.findIndex(t => t.id === id);
    if (i >= 0) return { col: c, task: c.tasks[i], i };
  }
  return null;
};
const nid = () => crypto.randomBytes(5).toString("hex");
const clean = (s, max) => String(s ?? "").slice(0, max);

app.post("/api/ops", needRole("editor"), (req, res) => {
  const op = req.body || {};
  const isAdmin = req.user.role === "admin";
  const adminOnly = () => { const e = new Error("forbidden"); e.status = 403; throw e; };

  try {
    switch (op.type) {
      case "task.create": {
        const col = findCol(op.colId);
        if (!col) throw notFound();
        const title = clean(op.title, 200).trim();
        if (!title) throw bad("empty_title");
        col.tasks.push({
          id: nid(), title, desc: clean(op.desc, 4000),
          status: statusId(op.status), assignee: userId(op.assignee),
          author: req.user.name, created: Date.now(),
        });
        break;
      }
      case "task.update": {
        const f = findTask(op.taskId);
        if (!f) throw notFound();
        if (op.title !== undefined) {
          const title = clean(op.title, 200).trim();
          if (!title) throw bad("empty_title");
          f.task.title = title;
        }
        if (op.desc     !== undefined) f.task.desc     = clean(op.desc, 4000);
        if (op.status   !== undefined) f.task.status   = statusId(op.status);
        if (op.assignee !== undefined) f.task.assignee = userId(op.assignee);
        break;
      }
      case "task.move": {
        const f = findTask(op.taskId);
        const to = findCol(op.toColId);
        if (!f || !to) throw notFound();
        f.col.tasks.splice(f.i, 1);
        let i = Number.isInteger(op.index) ? op.index : to.tasks.length;
        i = Math.max(0, Math.min(i, to.tasks.length));
        to.tasks.splice(i, 0, f.task);
        break;
      }
      case "task.delete": {
        const f = findTask(op.taskId);
        if (!f) throw notFound();
        f.col.tasks.splice(f.i, 1);
        break;
      }

      case "column.create": {
        if (!isAdmin) adminOnly();
        const name = clean(op.name, 80).trim();
        if (!name) throw bad("empty_name");
        board.columns.push({ id: nid(), name, status: statusId(op.status), tasks: [] });
        break;
      }
      case "column.update": {
        if (!isAdmin) adminOnly();
        const col = findCol(op.colId);
        if (!col) throw notFound();
        if (op.name !== undefined) {
          const name = clean(op.name, 80).trim();
          if (!name) throw bad("empty_name");
          col.name = name;
        }
        if (op.status !== undefined) col.status = statusId(op.status);
        break;
      }
      case "column.move": {
        if (!isAdmin) adminOnly();
        const col = findCol(op.colId);
        if (!col) throw notFound();
        const from = board.columns.indexOf(col);
        let to = Math.max(0, Math.min(Number(op.index), board.columns.length - 1));
        board.columns.splice(from, 1);
        board.columns.splice(to, 0, col);
        break;
      }
      case "column.delete": {
        if (!isAdmin) adminOnly();
        const col = findCol(op.colId);
        if (!col) throw notFound();
        board.columns.splice(board.columns.indexOf(col), 1);
        break;
      }

      case "status.create": {
        if (!isAdmin) adminOnly();
        if (board.statuses.length >= 12) throw bad("too_many_statuses");
        board.statuses.push({ id: nid(), name: clean(op.name, 40).trim() || "Новый статус", color: color(op.color) });
        break;
      }
      case "status.update": {
        if (!isAdmin) adminOnly();
        const s = board.statuses.find(x => x.id === op.statusId);
        if (!s) throw notFound();
        if (op.name  !== undefined) s.name  = clean(op.name, 40).trim() || s.name;
        if (op.color !== undefined) s.color = color(op.color);
        break;
      }
      case "status.move": {
        if (!isAdmin) adminOnly();
        const s = board.statuses.find(x => x.id === op.statusId);
        if (!s) throw notFound();
        const from = board.statuses.indexOf(s);
        const to = Math.max(0, Math.min(Number(op.index), board.statuses.length - 1));
        board.statuses.splice(from, 1);
        board.statuses.splice(to, 0, s);
        break;
      }
      case "status.delete": {
        if (!isAdmin) adminOnly();
        if (board.statuses.length < 2) throw bad("last_status");
        const s = board.statuses.find(x => x.id === op.statusId);
        if (!s) throw notFound();
        board.statuses.splice(board.statuses.indexOf(s), 1);
        const first = board.statuses[0].id;
        board.columns.forEach(c => {
          if (c.status === s.id) c.status = first;
          c.tasks.forEach(t => { if (t.status === s.id) t.status = first; });
        });
        break;
      }

      case "board.subtitle": {
        if (!isAdmin) adminOnly();
        board.subtitle = clean(op.subtitle, 60);
        break;
      }

      default: throw bad("unknown_op");
    }
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  persist();
  broadcast();
  res.json(publicBoard());
});

function statusId(v) {
  const s = board.statuses.find(x => x.id === v);
  return s ? s.id : board.statuses[0].id;
}
function userId(v) { return v && board.users[v] ? v : null; }
function color(v)  { return /^#[0-9a-fA-F]{6}$/.test(String(v || "")) ? v : "#66786c"; }
function bad(m)      { const e = new Error(m); e.status = 400; return e; }
function notFound()  { const e = new Error("not_found"); e.status = 404; return e; }

/* ── статика ── */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.listen(CFG.port, CFG.host, () => {
  console.log(`\n  CarpetFall Board`);
  console.log(`  ├ адрес:          ${CFG.baseUrl}`);
  console.log(`  ├ слушает:        ${CFG.host}:${CFG.port}`);
  console.log(`  ├ redirect URI:   ${REDIRECT_URI}`);
  console.log(`  ├ Discord-сервер: ${CFG.guildId}`);
  console.log(`  ├ админ-роли:     ${CFG.adminRoles.join(", ") || "— (только ADMIN_USER_IDS)"}`);
  console.log(`  └ редакторы:      ${CFG.editorRoles.join(", ") || "все участники сервера"}\n`);
});
