const {
  apiGet,
  apiPost,
  roomIdFromLocation,
  getSession,
  clearSession,
  goToRoom,
  setMessage,
  escapeHtml,
  bidText,
  relativePlayers,
} = window.DdzCommon;

const gameRoomCode = document.getElementById("gameRoomCode");
const gameStatusText = document.getElementById("gameStatusText");
const backRoomBtn = document.getElementById("backRoomBtn");
const restartBtn = document.getElementById("restartBtn");
const opponentTop = document.getElementById("opponentTop");
const opponentRight = document.getElementById("opponentRight");
const kittyZone = document.getElementById("kittyZone");
const trickZone = document.getElementById("trickZone");
const turnBadge = document.getElementById("turnBadge");
const playerSummary = document.getElementById("playerSummary");
const actionHint = document.getElementById("actionHint");
const bidActions = document.getElementById("bidActions");
const playActions = document.getElementById("playActions");
const playBtn = document.getElementById("playBtn");
const passBtn = document.getElementById("passBtn");
const clearBtn = document.getElementById("clearBtn");
const mySeat = document.getElementById("mySeat");
const myHand = document.getElementById("myHand");
const gameLog = document.getElementById("gameLog");

const roomId = roomIdFromLocation();
const session = roomId ? getSession(roomId) : null;
let selected = [];
let latestState = null;
let pollTimer = null;

if (!roomId || !session) {
  window.location.replace(`./room.html?room=${encodeURIComponent(roomId || "")}`);
}

function playerById(state, playerId) {
  return state.players.find((player) => player.id === playerId);
}

function renderOpponent(node, player, state, orientation) {
  if (!player) {
    node.innerHTML = "";
    return;
  }

  const backCards = Array.from({ length: Math.min(player.handCount, 14) }, (_, index) => {
    const offsetStyle = orientation === "top" ? `style="left:${index * 14}px"` : `style="top:${index * 8}px"`;
    return `<span class="card-back ${orientation}" ${offsetStyle}></span>`;
  }).join("");

  const isTurn = state.turnPlayerId === player.id;
  node.innerHTML = `
    <div class="opponent-head">
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <div class="opponent-meta">${player.isLandlord ? "地主" : "农民"} · ${bidText(player.bid)}</div>
      </div>
      <span class="turn-dot ${isTurn ? "active" : ""}">${isTurn ? "出牌中" : "等待"}</span>
    </div>
    <div class="opponent-count">${player.handCount} 张</div>
    <div class="opponent-cards ${orientation}">${backCards}</div>
  `;
}

function renderTrick(state) {
  if (!state.lastPlay) {
    trickZone.innerHTML = '<span class="trick-placeholder">这一轮还没人出牌</span>';
    return;
  }
  const owner = playerById(state, state.lastPlay.playerId);
  trickZone.innerHTML = `
    <div class="trick-owner">${escapeHtml(owner?.name || "玩家")} · ${escapeHtml(state.lastPlay.comboLabel)}</div>
    <div class="played-list">
      ${state.lastPlay.cards.map(renderPlayedCard).join("")}
    </div>
  `;
}

function renderPlayedCard(card) {
  return `
    <div class="mini-card ${card.color}">
      <span>${escapeHtml(card.label)}</span>
    </div>
  `;
}

function renderKitty(state) {
  if (!state.landlordPlayerId) {
    kittyZone.innerHTML = '<span class="trick-placeholder">等待叫分结束</span>';
    return;
  }
  kittyZone.innerHTML = `
    <div class="played-list">
      ${state.kitty.map(renderPlayedCard).join("")}
    </div>
  `;
}

function renderMySeat(state, me) {
  mySeat.innerHTML = `
    <div>
      <strong>${escapeHtml(me.name)}（你）</strong>
      <span>${me.isLandlord ? "地主" : "农民"} · ${bidText(me.bid)}</span>
    </div>
    <div class="self-meta">${me.handCount} 张手牌</div>
  `;
}

function renderMyHand(state) {
  const selectedSet = new Set(selected);
  myHand.innerHTML = state.myHand
    .map((card, index) => {
      const active = selectedSet.has(card.id) ? "selected" : "";
      return `
        <button
          type="button"
          class="poker-card ${card.color} ${active}"
          data-card-id="${card.id}"
          style="z-index:${index + 1}; margin-left:${index === 0 ? 0 : -28}px"
        >
          <span class="corner top">${escapeHtml(card.icon || "")}<strong>${escapeHtml(card.rank)}</strong></span>
          <span class="card-face">${escapeHtml(card.label)}</span>
          <span class="corner bottom">${escapeHtml(card.icon || "")}<strong>${escapeHtml(card.rank)}</strong></span>
        </button>
      `;
    })
    .join("");

  myHand.querySelectorAll("[data-card-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.cardId;
      if (selected.includes(id)) {
        selected = selected.filter((item) => item !== id);
      } else {
        selected = [...selected, id];
      }
      renderGame(latestState);
    });
  });
}

function renderGame(state) {
  latestState = state;
  const relative = relativePlayers(state);
  const me = relative.self;
  const currentSelection = new Set(state.myHand.map((card) => card.id));
  selected = selected.filter((id) => currentSelection.has(id));

  gameRoomCode.textContent = state.roomId;
  backRoomBtn.href = `./room.html?room=${encodeURIComponent(state.roomId)}`;
  restartBtn.disabled = !state.canRestart;

  renderOpponent(opponentTop, relative.top, state, "top");
  renderOpponent(opponentRight, relative.right, state, "side");
  renderKitty(state);
  renderTrick(state);
  renderMySeat(state, me);
  renderMyHand(state);

  const turnPlayer = playerById(state, state.turnPlayerId);
  turnBadge.textContent = state.phase === "finished" ? `${escapeHtml(playerById(state, state.winnerPlayerId)?.name || "玩家")} 获胜` : `${escapeHtml(turnPlayer?.name || "玩家")} 操作中`;

  if (state.phase === "bidding") {
    gameStatusText.textContent = `当前最高叫分 ${state.highestBid} 分，轮流叫分中。`;
  } else if (state.phase === "playing") {
    const landlord = playerById(state, state.landlordPlayerId);
    gameStatusText.textContent = `地主是 ${escapeHtml(landlord?.name || "玩家")}，正式出牌中。`;
  } else {
    gameStatusText.textContent = `${escapeHtml(playerById(state, state.winnerPlayerId)?.name || "玩家")} 率先出完牌，${state.winnerSide || ""}胜利。`;
  }

  const isMyTurn = state.turnPlayerId === state.playerId;
  bidActions.classList.toggle("hidden", !(state.phase === "bidding" && isMyTurn));
  playActions.classList.toggle("hidden", !(state.phase === "playing" && isMyTurn));
  passBtn.disabled = !(state.phase === "playing" && isMyTurn && state.lastPlay && state.lastPlay.playerId !== state.playerId);
  playBtn.disabled = !(state.phase === "playing" && isMyTurn && selected.length);
  clearBtn.disabled = !selected.length;

  playerSummary.textContent = `${escapeHtml(me.name)} · ${me.handCount} 张手牌`;
  if (state.phase === "bidding" && isMyTurn) {
    actionHint.textContent = "轮到你叫分。";
  } else if (state.phase === "playing" && isMyTurn) {
    actionHint.textContent = selected.length ? `已选择 ${selected.length} 张牌，准备出牌。` : "轮到你出牌。";
  } else if (state.phase === "finished") {
    actionHint.textContent = state.canRestart ? "你可以点击“再来一局”。" : "等待房主开始下一局。";
  } else {
    actionHint.textContent = "等待其他玩家操作。";
  }

  gameLog.innerHTML = [...state.logs]
    .reverse()
    .map((line) => `<div class="log-entry">${escapeHtml(line)}</div>`)
    .join("");
}

async function fetchState() {
  const state = await apiGet(`/api/rooms/${roomId}/state?playerId=${encodeURIComponent(session.playerId)}&token=${encodeURIComponent(session.token)}`);
  if (state.phase === "waiting") {
    goToRoom(roomId);
    return;
  }
  renderGame(state);
}

async function sendAction(payload) {
  try {
    const state = await apiPost(`/api/rooms/${roomId}/action`, {
      playerId: session.playerId,
      token: session.token,
      ...payload,
    });
    selected = [];
    renderGame(state);
  } catch (error) {
    actionHint.textContent = error.message;
  }
}

if (roomId && session) {
  document.querySelectorAll("[data-bid]").forEach((button) => {
    button.addEventListener("click", () => sendAction({ kind: "bid", bid: Number(button.dataset.bid) }));
  });

  playBtn.addEventListener("click", () => {
    if (!selected.length) {
      return;
    }
    sendAction({ kind: "play", cardIds: selected });
  });

  passBtn.addEventListener("click", () => sendAction({ kind: "pass" }));

  clearBtn.addEventListener("click", () => {
    selected = [];
    if (latestState) {
      renderGame(latestState);
    }
  });

  restartBtn.addEventListener("click", () => sendAction({ kind: "restart" }));

  pollTimer = window.setInterval(async () => {
    try {
      await fetchState();
    } catch (error) {
      if (error.message.includes("身份已失效")) {
        clearSession(roomId);
        goToRoom(roomId);
        return;
      }
      actionHint.textContent = error.message;
    }
  }, 1200);

  fetchState().catch((error) => {
    if (error.message.includes("身份已失效")) {
      clearSession(roomId);
      goToRoom(roomId);
      return;
    }
    setMessage(actionHint, error.message, true);
  });
}
