const STORAGE_KEY = "ddz-lan-sessions";

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
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

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

async function copyText(text) {
  await navigator.clipboard.writeText(text);
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
  const selfIndex = state.order.indexOf(state.playerId);
  const topId = state.order[(selfIndex + 1) % state.order.length];
  const rightId = state.order[(selfIndex + 2) % state.order.length];
  return {
    self: state.players.find((player) => player.id === state.playerId),
    top: state.players.find((player) => player.id === topId),
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
  copyText,
  setMessage,
  escapeHtml,
  bidText,
  relativePlayers,
};
