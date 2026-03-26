const { apiGet, apiPost, getSession, saveSession, goToGame, copyText, setMessage, escapeHtml } = window.DdzCommon;

const LAST_NAME_KEY = "ddz-last-name";

const serverOrigin = document.getElementById("serverOrigin");
const copyOriginBtn = document.getElementById("copyOriginBtn");
const createForm = document.getElementById("createForm");
const createName = document.getElementById("createName");
const hallName = document.getElementById("hallName");
const hallStats = document.getElementById("hallStats");
const roomList = document.getElementById("roomList");
const refreshRoomsBtn = document.getElementById("refreshRoomsBtn");
const homeMessage = document.getElementById("homeMessage");

let roomPollTimer = null;
let lobbyRequestInFlight = false;
let createPending = false;
let joinPendingRoomId = "";

function loadSavedName() {
  try {
    return localStorage.getItem(LAST_NAME_KEY) || "";
  } catch (_) {
    return "";
  }
}

function savePreferredName(name) {
  const value = (name || "").trim();
  try {
    if (value) {
      localStorage.setItem(LAST_NAME_KEY, value);
    }
  } catch (_) {}
}

function syncNames(value, source) {
  if (source !== "create" && createName.value !== value) {
    createName.value = value;
  }
  if (source !== "hall" && hallName.value !== value) {
    hallName.value = value;
  }
}

function currentPreferredName() {
  return (hallName.value || createName.value || "").trim();
}

function roomCardMarkup(room) {
  const savedSession = getSession(room.roomId);
  const canResume = Boolean(savedSession);
  const joinLabel = canResume ? "返回这桌" : room.canJoin ? "加入这桌" : room.phase === "waiting" ? "已坐满" : "进行中";
  return `
    <article class="room-card ${room.canJoin ? "joinable" : "locked"}">
      <div class="room-card-head">
        <div>
          <strong>房间 ${escapeHtml(room.roomId)}</strong>
          <span>房主：${escapeHtml(room.hostName)}</span>
        </div>
        <span class="room-status ${room.canJoin ? "joinable" : "locked"}">${escapeHtml(room.status)}</span>
      </div>
      <div class="room-card-meta">
        <span>${room.playerCount}/${room.capacity} 人</span>
        <span>${room.canJoin ? "可直接入座" : "当前不可加入"}</span>
      </div>
      <div class="room-player-list">
        ${room.players
          .map((player) => {
            return `
              <span class="room-player-chip ${player.isHost ? "host" : ""}">
                ${escapeHtml(player.name)}${player.isHost ? " · 房主" : ""}
              </span>
            `;
          })
          .join("")}
      </div>
      <button
        class="${room.canJoin ? "primary-btn" : "ghost-btn"} room-join-btn"
        type="button"
        data-join-room="${escapeHtml(room.roomId)}"
        ${room.canJoin || canResume ? "" : "disabled"}
      >
        ${joinLabel}
      </button>
    </article>
  `;
}

function renderRoomList(payload) {
  const rooms = payload.rooms || [];
  const joinableRooms = rooms.filter((room) => room.canJoin);
  hallStats.textContent = joinableRooms.length
    ? `当前有 ${joinableRooms.length} 张可加入的牌桌`
    : "当前没有等待中的牌桌";

  if (!rooms.length) {
    roomList.innerHTML = `
      <div class="room-empty">
        <strong>还没有人开桌</strong>
        <span>你可以先创建一桌，其他人打开这个地址后就能直接看见。</span>
      </div>
    `;
    return;
  }

  roomList.innerHTML = rooms.map(roomCardMarkup).join("");
}

async function loadLobbyRooms(showError = false) {
  if (lobbyRequestInFlight) {
    return;
  }
  lobbyRequestInFlight = true;
  try {
    const payload = await apiGet("/api/rooms/public");
    renderRoomList(payload);
  } catch (error) {
    if (showError) {
      setMessage(homeMessage, error.message, true);
    }
    hallStats.textContent = "大厅刷新失败";
    roomList.innerHTML = `
      <div class="room-empty">
        <strong>暂时读不到房间大厅</strong>
        <span>请确认当前页面对应的房间服务可访问，然后再刷新一次。</span>
      </div>
    `;
  } finally {
    lobbyRequestInFlight = false;
  }
}

async function bootstrapHome() {
  const savedName = loadSavedName();
  if (savedName) {
    syncNames(savedName);
  }

  try {
    const info = await apiGet("/api/server-info");
    serverOrigin.textContent = info.origin || info.publicOrigin || info.lanOrigin;
  } catch (error) {
    serverOrigin.textContent = "无法读取服务器地址";
    setMessage(homeMessage, error.message, true);
  }

  await loadLobbyRooms();
  roomPollTimer = window.setInterval(() => loadLobbyRooms(false), 1800);
}

copyOriginBtn.addEventListener("click", async () => {
  try {
    await copyText(serverOrigin.textContent);
    setMessage(homeMessage, "访问地址已复制。");
  } catch (_) {
    setMessage(homeMessage, "复制失败，请手动复制地址。", true);
  }
});

createName.addEventListener("input", () => {
  syncNames(createName.value, "create");
  savePreferredName(createName.value);
});

hallName.addEventListener("input", () => {
  syncNames(hallName.value, "hall");
  savePreferredName(hallName.value);
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (createPending) {
    return;
  }
  setMessage(homeMessage, "");
  try {
    createPending = true;
    const submitButton = createForm.querySelector("button[type='submit']");
    submitButton.disabled = true;
    const name = createName.value.trim();
    savePreferredName(name);
    const payload = await apiPost("/api/rooms", { name });
    saveSession(payload.roomId, payload);
    goToGame(payload.roomId);
  } catch (error) {
    setMessage(homeMessage, error.message, true);
  } finally {
    createPending = false;
    const submitButton = createForm.querySelector("button[type='submit']");
    submitButton.disabled = false;
  }
});

roomList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-join-room]");
  if (!button) {
    return;
  }

  const roomId = button.dataset.joinRoom;
  const existingSession = getSession(roomId);
  if (existingSession) {
    goToGame(roomId);
    return;
  }
  if (joinPendingRoomId) {
    return;
  }

  const name = currentPreferredName();
  if (!name) {
    setMessage(homeMessage, "先输入你的昵称，再加入牌桌。", true);
    hallName.focus();
    return;
  }

  setMessage(homeMessage, "");
  try {
    joinPendingRoomId = roomId;
    button.disabled = true;
    savePreferredName(name);
    const payload = await apiPost(`/api/rooms/${roomId}/join`, { name });
    saveSession(payload.roomId, payload);
    goToGame(payload.roomId);
  } catch (error) {
    setMessage(homeMessage, error.message, true);
    await loadLobbyRooms(false);
  } finally {
    joinPendingRoomId = "";
    button.disabled = false;
  }
});

refreshRoomsBtn.addEventListener("click", () => {
  setMessage(homeMessage, "");
  loadLobbyRooms(true);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (roomPollTimer) {
      window.clearInterval(roomPollTimer);
      roomPollTimer = null;
    }
    return;
  }
  loadLobbyRooms(false);
  if (!roomPollTimer) {
    roomPollTimer = window.setInterval(() => loadLobbyRooms(false), 1800);
  }
});

window.addEventListener("pagehide", () => {
  if (roomPollTimer) {
    window.clearInterval(roomPollTimer);
    roomPollTimer = null;
  }
});

bootstrapHome();
