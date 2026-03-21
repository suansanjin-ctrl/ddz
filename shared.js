const STORAGE_KEY = "ddz-lan-sessions";
const REQUEST_TIMEOUT_MS = 10000;

function readSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

function writeSessions(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function saveSession(roomId, session) {
  const sessions = readSessions();
  sessions[roomId.toUpperCase()] = session;
  writeSessions(sessions);
}

function getSession(roomId) {
  const sessions = readSessions();
  return sessions[roomId.toUpperCase()] || null;
}

function clearSession(roomId) {
  const sessions = readSessions();
  delete sessions[roomId.toUpperCase()];
  writeSessions(sessions);
}

async function apiRequest(path, options = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : 0;
  let response;

  try {
    response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
      signal: controller ? controller.signal : options.signal,
    });
  } catch (error) {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    if (error?.name === "AbortError") {
      throw new Error("请求超时，请确认局域网服务还在运行。");
    }
    throw new Error("连接服务器失败，请确认你和房主在同一网络并且服务已经启动。");
  }

  if (timeoutId) {
    window.clearTimeout(timeoutId);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {}

  if (!response.ok) {
    throw new Error(payload.error || "请求失败，请稍后再试。");
  }
  return payload;
}

function apiGet(path) {
  return apiRequest(path, { method: "GET" });
}

function apiPost(path, body) {
  return apiRequest(path, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

function roomIdFromInput(input) {
  const value = (input || "").trim();
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return (url.searchParams.get("room") || "").toUpperCase();
    } catch (_) {
      return "";
    }
  }
  return value.toUpperCase();
}

function roomIdFromLocation() {
  return (new URLSearchParams(window.location.search).get("room") || "").toUpperCase();
}

function goToRoom(roomId) {
  window.location.href = `./room.html?room=${encodeURIComponent(roomId)}`;
}

function goToGame(roomId) {
  window.location.href = `./game.html?room=${encodeURIComponent(roomId)}`;
}

function goHome() {
  window.location.href = "./index.html";
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "readonly");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(helper);
  if (!copied) {
    throw new Error("复制失败");
  }
}

function setMessage(node, message, isError = false) {
  node.textContent = message || "";
  node.classList.toggle("is-error", Boolean(message && isError));
  node.classList.toggle("is-success", Boolean(message && !isError));
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function bidText(bid) {
  if (bid === null || bid === undefined) {
    return "未叫分";
  }
  return bid === 0 ? "不叫" : `${bid} 分`;
}

function relativePlayers(state) {
  const order = state.order || [];
  const selfIndex = order.indexOf(state.playerId);
  const leftId = selfIndex >= 0 && order.length > 1 ? order[(selfIndex + 1) % order.length] : null;
  const rightId = selfIndex >= 0 && order.length > 2 ? order[(selfIndex + 2) % order.length] : null;
  return {
    self: state.players.find((player) => player.id === state.playerId),
    left: state.players.find((player) => player.id === leftId),
    right: state.players.find((player) => player.id === rightId),
  };
}

window.DdzCommon = {
  saveSession,
  getSession,
  clearSession,
  apiGet,
  apiPost,
  roomIdFromInput,
  roomIdFromLocation,
  goToRoom,
  goToGame,
  goHome,
  copyText,
  setMessage,
  escapeHtml,
  bidText,
  relativePlayers,
};
