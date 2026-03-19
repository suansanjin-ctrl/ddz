const {
  apiGet,
  apiPost,
  roomIdFromLocation,
  getSession,
  clearSession,
  saveSession,
  goToGame,
  copyText,
  setMessage,
  escapeHtml,
} = window.DdzCommon;

const roomCode = document.getElementById("roomCode");
const roomHeadline = document.getElementById("roomHeadline");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const joinCard = document.getElementById("joinCard");
const quickJoinForm = document.getElementById("quickJoinForm");
const quickJoinName = document.getElementById("quickJoinName");
const seatList = document.getElementById("seatList");
const shareLink = document.getElementById("shareLink");
const startBtn = document.getElementById("startBtn");
const roomMessage = document.getElementById("roomMessage");

const roomId = roomIdFromLocation();
let session = roomId ? getSession(roomId) : null;
let pollTimer = null;

function renderSummary(summary) {
  roomCode.textContent = summary.roomId || "----";
  shareLink.value = summary.shareUrl || window.location.href;
  roomHeadline.textContent =
    summary.phase === "waiting"
      ? `当前 ${summary.playerCount}/${summary.capacity} 人，满 3 人后房主开局。`
      : "对局已经开始，已加入的玩家会进入牌桌。";

  const seats = Array.from({ length: summary.capacity }, (_, index) => summary.players[index] || null);
  seatList.innerHTML = seats
    .map((player, index) => {
      if (!player) {
        return `
          <div class="seat-item empty">
            <span class="seat-tag">座位 ${index + 1}</span>
            <strong>等待加入</strong>
          </div>
        `;
      }
      return `
        <div class="seat-item">
          <span class="seat-tag">座位 ${index + 1}</span>
          <strong>${escapeHtml(player.name)}</strong>
        </div>
      `;
    })
    .join("");
}

function renderState(state) {
  renderSummary({
    roomId: state.roomId,
    phase: state.phase,
    shareUrl: state.shareUrl,
    playerCount: state.players.length,
    capacity: 3,
    players: state.players,
  });

  const me = state.players.find((player) => player.id === state.playerId);
  roomHeadline.textContent =
    state.phase === "waiting"
      ? `你是 ${me?.name || "玩家"}，房间已就绪，等房主开局。`
      : "对局已经开始，正在进入牌桌。";

  joinCard.classList.add("hidden");
  startBtn.disabled = !state.canStart;
  if (state.phase !== "waiting") {
    window.setTimeout(() => goToGame(state.roomId), 300);
  }
}

async function loadPublicSummary() {
  const summary = await apiGet(`/api/rooms/${roomId}/summary`);
  renderSummary(summary);
  joinCard.classList.toggle("hidden", !summary.canJoin);
  if (!summary.canJoin) {
    setMessage(roomMessage, summary.phase === "waiting" ? "房间已满。" : "对局已经开始，暂时不能再加入。", true);
  }
}

async function loadPrivateState() {
  const state = await apiGet(`/api/rooms/${roomId}/state?playerId=${encodeURIComponent(session.playerId)}&token=${encodeURIComponent(session.token)}`);
  renderState(state);
}

async function syncRoom() {
  if (!roomId) {
    setMessage(roomMessage, "房间号不存在，请返回首页重新进入。", true);
    return;
  }

  try {
    if (session) {
      await loadPrivateState();
    } else {
      await loadPublicSummary();
    }
  } catch (error) {
    if (session && error.message.includes("身份已失效")) {
      clearSession(roomId);
      session = null;
      await loadPublicSummary();
    } else {
      setMessage(roomMessage, error.message, true);
    }
  }
}

quickJoinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(roomMessage, "");
  try {
    const payload = await apiPost(`/api/rooms/${roomId}/join`, { name: quickJoinName.value });
    saveSession(payload.roomId, payload);
    session = payload;
    await syncRoom();
  } catch (error) {
    setMessage(roomMessage, error.message, true);
  }
});

copyLinkBtn.addEventListener("click", async () => {
  try {
    await copyText(shareLink.value);
    setMessage(roomMessage, "房间链接已复制。");
  } catch (_) {
    setMessage(roomMessage, "复制失败，请手动复制。", true);
  }
});

startBtn.addEventListener("click", async () => {
  if (!session) {
    return;
  }
  try {
    setMessage(roomMessage, "");
    await apiPost(`/api/rooms/${roomId}/start`, {
      playerId: session.playerId,
      token: session.token,
    });
    goToGame(roomId);
  } catch (error) {
    setMessage(roomMessage, error.message, true);
  }
});

pollTimer = window.setInterval(syncRoom, 1200);
syncRoom();
