const {
  apiGet,
  apiPost,
  roomIdFromLocation,
  getSession,
  saveSession,
  clearSession,
  goHome,
  copyText,
  setMessage,
  escapeHtml,
  bidText,
  relativePlayers,
} = window.DdzCommon;

const roomId = roomIdFromLocation();

const ui = {
  roomCode: document.getElementById("gameRoomCode"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  statusText: document.getElementById("gameStatusText"),
  seatLeft: document.getElementById("seatLeft"),
  seatRight: document.getElementById("seatRight"),
  mySeat: document.getElementById("mySeat"),
  kittyZone: document.getElementById("kittyZone"),
  trickZone: document.getElementById("trickZone"),
  turnBadge: document.getElementById("turnBadge"),
  turnTimer: document.getElementById("turnTimer"),
  deskFeed: document.getElementById("deskFeed"),
  overlay: document.getElementById("tableOverlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayDesc: document.getElementById("overlayDesc"),
  shareLink: document.getElementById("shareLink"),
  overlayCopyBtn: document.getElementById("overlayCopyBtn"),
  joinForm: document.getElementById("joinForm"),
  joinName: document.getElementById("joinName"),
  waitingPlayers: document.getElementById("waitingPlayers"),
  startBtn: document.getElementById("startBtn"),
  overlayHomeBtn: document.getElementById("overlayHomeBtn"),
  overlayMessage: document.getElementById("overlayMessage"),
  playerSummary: document.getElementById("playerSummary"),
  actionHint: document.getElementById("actionHint"),
  bidActions: document.getElementById("bidActions"),
  playActions: document.getElementById("playActions"),
  playBtn: document.getElementById("playBtn"),
  passBtn: document.getElementById("passBtn"),
  clearBtn: document.getElementById("clearBtn"),
  restartBtn: document.getElementById("restartBtn"),
  myHand: document.getElementById("myHand"),
};

const app = {
  roomId,
  session: roomId ? getSession(roomId) : null,
  summary: null,
  state: null,
  selected: [],
  pollTimer: null,
  tickTimer: null,
  turnDeadline: 0,
  lastTurnPlayerId: null,
  lastPhase: null,
};

if (!roomId) {
  goHome();
}

function seatMarkup(player, options = {}) {
  if (!player) {
    return `
      <div class="seat-empty">
        <span>${options.placeholder || "等待加入"}</span>
      </div>
    `;
  }

  const avatar = escapeHtml((player.name || "玩").slice(0, 1));
  const role = player.isLandlord ? "地主" : player.isSelf ? "你" : "玩家";
  const bid = player.bid === undefined ? "" : bidText(player.bid);
  const count = typeof player.handCount === "number" ? `${player.handCount} 张` : "已入座";
  const turn = options.isTurn ? '<span class="seat-turning">出牌中</span>' : "";
  const landlordFlag = player.isLandlord ? '<span class="landlord-flag">地主</span>' : "";

  return `
    <div class="seat-card ${options.self ? "self" : ""} ${player.isLandlord ? "landlord" : ""}">
      <div class="seat-avatar">${avatar}</div>
      <div class="seat-meta">
        <strong>${escapeHtml(player.name)}</strong>
        <span>${escapeHtml(role)}${bid ? ` · ${escapeHtml(bid)}` : ""}</span>
        <em>${escapeHtml(count)}</em>
      </div>
      ${landlordFlag}
      ${turn}
    </div>
  `;
}

function cardMini(card) {
  return `
    <div class="desk-card ${card.color || ""}">
      <span>${escapeHtml(card.icon || "")}</span>
      <strong>${escapeHtml(card.rank || card.label || "")}</strong>
    </div>
  `;
}

function playedCardsMarkup(cards) {
  if (!cards?.length) {
    return '<div class="desk-placeholder">等待出牌</div>';
  }
  return cards.map(cardMini).join("");
}

function renderWaitingPlayers(players) {
  ui.waitingPlayers.innerHTML = players
    .map((player, index) => {
      return `
        <div class="waiting-chip">
          <span>${index + 1}</span>
          <strong>${escapeHtml(player.name)}</strong>
        </div>
      `;
    })
    .join("");
}

function renderPublicSummary(summary) {
  app.summary = summary;
  app.turnDeadline = 0;
  app.lastTurnPlayerId = null;
  app.lastPhase = null;
  ui.roomCode.textContent = summary.roomId || "----";
  ui.shareLink.value = summary.shareUrl || window.location.href;
  ui.statusText.textContent = `当前 ${summary.playerCount}/${summary.capacity} 人，等待开局`;
  ui.overlay.classList.remove("hidden");
  ui.overlayTitle.textContent = summary.canJoin ? "加入牌桌" : summary.phase === "waiting" ? "房间已满" : "牌局进行中";
  ui.overlayDesc.textContent = summary.canJoin
    ? "输入昵称后直接入座。房主开始后，你会留在这个牌桌里直接进入对局。"
    : summary.phase === "waiting"
      ? "这桌已经坐满 3 人了。"
      : "这一局已经开始，等下一桌或让房主重开。";
  ui.joinForm.classList.toggle("hidden", !summary.canJoin);
  ui.startBtn.classList.add("hidden");
  renderWaitingPlayers(summary.players || []);
  ui.seatLeft.innerHTML = seatMarkup(summary.players?.[0], { placeholder: "左侧玩家" });
  ui.seatRight.innerHTML = seatMarkup(summary.players?.[1], { placeholder: "右侧玩家" });
  ui.mySeat.innerHTML = seatMarkup(summary.players?.[2], { self: true, placeholder: "你将坐这里" });
  ui.kittyZone.innerHTML = '<div class="desk-placeholder">等待房主开始</div>';
  ui.trickZone.innerHTML = '<div class="desk-placeholder">牌局尚未开始</div>';
  ui.turnBadge.textContent = "等待开始";
  ui.turnTimer.classList.add("hidden");
  ui.deskFeed.textContent = summary.canJoin ? "点下面输入昵称后直接坐下。" : "等待房主重新开桌。";
  ui.bidActions.classList.add("hidden");
  ui.playActions.classList.add("hidden");
  ui.playerSummary.textContent = "尚未入座";
  ui.actionHint.textContent = summary.canJoin ? "加入后会自动留在这个牌桌里等待开局。" : "当前无法加入。";
}

function renderWaitingState(state) {
  app.state = state;
  app.turnDeadline = 0;
  app.lastTurnPlayerId = null;
  app.lastPhase = null;
  const relative = relativePlayers(state);
  const me = relative.self;
  ui.roomCode.textContent = state.roomId;
  ui.shareLink.value = state.shareUrl;
  ui.overlay.classList.remove("hidden");
  ui.overlayTitle.textContent = state.players.length < 3 ? "等待玩家加入" : "牌桌已满，可以开始";
  ui.overlayDesc.textContent = state.canStart
    ? "现在点击开始游戏，所有人都将在这个牌桌里直接进入对局。"
    : state.players.length < 3
      ? "房主把这个链接发给身边的人，他们点开后会直接进桌。"
      : "等待房主开始游戏。";
  ui.joinForm.classList.add("hidden");
  ui.startBtn.classList.toggle("hidden", !state.canStart);
  ui.startBtn.disabled = !state.canStart;
  renderWaitingPlayers(state.players);

  ui.seatLeft.innerHTML = seatMarkup(relative.left, { placeholder: "等待左侧玩家" });
  ui.seatRight.innerHTML = seatMarkup(relative.right, { placeholder: "等待右侧玩家" });
  ui.mySeat.innerHTML = seatMarkup(me, { self: true, placeholder: "你的位置" });

  ui.statusText.textContent = `已就位 ${state.players.length}/3 人`;
  ui.kittyZone.innerHTML = '<div class="desk-placeholder">开局后发底牌</div>';
  ui.trickZone.innerHTML = '<div class="desk-placeholder">大家将在这里出牌</div>';
  ui.turnBadge.textContent = "等待房主开始";
  ui.turnTimer.classList.add("hidden");
  ui.deskFeed.textContent = state.canStart ? "满 3 人了，点击开始。" : "链接已分享后，其他人点开即可直接入座。";
  ui.bidActions.classList.add("hidden");
  ui.playActions.classList.add("hidden");
  ui.playerSummary.textContent = `${escapeHtml(me?.name || "你")} 已入座`;
  ui.actionHint.textContent = state.canStart ? "你是房主，可以直接开局。" : "等待房主开始游戏。";
  ui.restartBtn.disabled = true;
}

function renderPlayingState(state) {
  app.state = state;
  const relative = relativePlayers(state);
  const me = relative.self;
  const turnPlayer = state.players.find((player) => player.id === state.turnPlayerId);
  const winner = state.players.find((player) => player.id === state.winnerPlayerId);
  const selectedSet = new Set(state.myHand.map((card) => card.id));
  app.selected = app.selected.filter((id) => selectedSet.has(id));

  ui.overlay.classList.add("hidden");
  ui.roomCode.textContent = state.roomId;
  ui.shareLink.value = state.shareUrl;
  ui.statusText.textContent =
    state.phase === "bidding"
      ? `当前最高叫分 ${state.highestBid} 分`
      : state.phase === "finished"
        ? `${escapeHtml(winner?.name || "玩家")} 获胜`
        : `地主：${escapeHtml(state.players.find((player) => player.id === state.landlordPlayerId)?.name || "待定")}`;

  ui.seatLeft.innerHTML = seatMarkup(relative.left, {
    placeholder: "等待左侧玩家",
    isTurn: state.turnPlayerId === relative.left?.id,
  });
  ui.seatRight.innerHTML = seatMarkup(relative.right, {
    placeholder: "等待右侧玩家",
    isTurn: state.turnPlayerId === relative.right?.id,
  });
  ui.mySeat.innerHTML = seatMarkup(me, {
    self: true,
    placeholder: "你的位置",
    isTurn: state.turnPlayerId === me?.id,
  });

  ui.kittyZone.innerHTML = playedCardsMarkup(state.kitty);
  if (state.lastPlay) {
    const lastPlayer = state.players.find((player) => player.id === state.lastPlay.playerId);
    ui.trickZone.innerHTML = `
      <div class="desk-play-head">${escapeHtml(lastPlayer?.name || "玩家")} · ${escapeHtml(state.lastPlay.comboLabel)}</div>
      <div class="desk-card-row large">${playedCardsMarkup(state.lastPlay.cards)}</div>
    `;
  } else {
    ui.trickZone.innerHTML = '<div class="desk-placeholder">本轮还没人出牌</div>';
  }

  ui.turnBadge.textContent =
    state.phase === "finished"
      ? `${escapeHtml(winner?.name || "玩家")} 胜利`
      : `${escapeHtml(turnPlayer?.name || "玩家")} 操作中`;
  syncTurnTimer(state);

  ui.deskFeed.innerHTML = [...state.logs].slice(-3).map((line) => `<div>${escapeHtml(line)}</div>`).join("");

  ui.playerSummary.textContent = `${escapeHtml(me?.name || "你")} · ${state.myHand.length} 张手牌`;

  const isMyTurn = state.turnPlayerId === state.playerId;
  ui.bidActions.classList.toggle("hidden", !(state.phase === "bidding" && isMyTurn));
  ui.playActions.classList.toggle("hidden", !(state.phase === "playing" || state.phase === "finished"));
  ui.playBtn.disabled = !(state.phase === "playing" && isMyTurn && app.selected.length);
  ui.passBtn.disabled = !(state.phase === "playing" && isMyTurn && state.lastPlay && state.lastPlay.playerId !== state.playerId);
  ui.clearBtn.disabled = !app.selected.length;
  ui.restartBtn.disabled = !state.canRestart;

  if (state.phase === "bidding") {
    ui.actionHint.textContent = isMyTurn ? "轮到你叫分。" : "等待其他玩家叫分。";
  } else if (state.phase === "playing") {
    ui.actionHint.textContent = isMyTurn
      ? app.selected.length
        ? `已选择 ${app.selected.length} 张牌，点击“出牌”。`
        : "轮到你出牌。"
      : "等待其他玩家出牌。";
  } else {
    ui.actionHint.textContent = state.canRestart ? "你可以点击“再来一局”。" : "等待房主开始下一局。";
  }

  renderMyHand(state.myHand);
}

function syncTurnTimer(state) {
  if (state.phase === "finished") {
    app.turnDeadline = 0;
    ui.turnTimer.classList.add("hidden");
    return;
  }
  if (!app.turnDeadline || app.lastTurnPlayerId !== state.turnPlayerId || app.lastPhase !== state.phase) {
    app.turnDeadline = Date.now() + 15000;
    app.lastTurnPlayerId = state.turnPlayerId;
    app.lastPhase = state.phase;
  }
  ui.turnTimer.classList.remove("hidden");
  paintTurnTimer();
}

function paintTurnTimer() {
  if (!app.turnDeadline) {
    ui.turnTimer.classList.add("hidden");
    return;
  }
  const left = Math.max(0, Math.ceil((app.turnDeadline - Date.now()) / 1000));
  ui.turnTimer.textContent = String(left);
  ui.turnTimer.classList.toggle("danger", left <= 5);
}

function renderMyHand(cards) {
  ui.myHand.innerHTML = cards
    .map((card, index) => {
      const selected = app.selected.includes(card.id) ? "selected" : "";
      return `
        <button
          type="button"
          class="hand-card ${card.color || ""} ${selected}"
          data-card-id="${card.id}"
          style="z-index:${index + 1}; margin-left:${index === 0 ? 0 : -38}px"
        >
          <span class="hand-corner top">${escapeHtml(card.icon || "")}<strong>${escapeHtml(card.rank)}</strong></span>
          <span class="hand-face">${escapeHtml(card.label)}</span>
          <span class="hand-corner bottom">${escapeHtml(card.icon || "")}<strong>${escapeHtml(card.rank)}</strong></span>
        </button>
      `;
    })
    .join("");

  ui.myHand.querySelectorAll("[data-card-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.cardId;
      if (app.selected.includes(id)) {
        app.selected = app.selected.filter((item) => item !== id);
      } else {
        app.selected = [...app.selected, id];
      }
      if (app.state) {
        renderPlayingState(app.state);
      }
    });
  });
}

async function loadSummary() {
  const summary = await apiGet(`/api/rooms/${app.roomId}/summary`);
  renderPublicSummary(summary);
}

async function loadState() {
  const state = await apiGet(
    `/api/rooms/${app.roomId}/state?playerId=${encodeURIComponent(app.session.playerId)}&token=${encodeURIComponent(app.session.token)}`,
  );
  if (state.phase === "waiting") {
    renderWaitingState(state);
  } else {
    renderPlayingState(state);
  }
}

async function joinRoom(name) {
  const payload = await apiPost(`/api/rooms/${app.roomId}/join`, { name });
  saveSession(payload.roomId, payload);
  app.session = payload;
  await syncPage();
}

async function startGame() {
  if (!app.session) {
    return;
  }
  const state = await apiPost(`/api/rooms/${app.roomId}/start`, {
    playerId: app.session.playerId,
    token: app.session.token,
  });
  renderPlayingState(state);
}

async function sendAction(payload) {
  if (!app.session) {
    return;
  }
  try {
    const state = await apiPost(`/api/rooms/${app.roomId}/action`, {
      playerId: app.session.playerId,
      token: app.session.token,
      ...payload,
    });
    app.selected = [];
    if (state.phase === "waiting") {
      renderWaitingState(state);
    } else {
      renderPlayingState(state);
    }
  } catch (error) {
    setMessage(ui.overlayMessage, error.message, true);
    ui.actionHint.textContent = error.message;
  }
}

async function syncPage() {
  try {
    if (app.session) {
      await loadState();
    } else {
      await loadSummary();
    }
  } catch (error) {
    if (app.session && error.message.includes("身份已失效")) {
      clearSession(app.roomId);
      app.session = null;
      await loadSummary();
      return;
    }
    setMessage(ui.overlayMessage, error.message, true);
  }
}

ui.copyLinkBtn.addEventListener("click", async () => {
  try {
    await copyText(ui.shareLink.value || window.location.href);
    ui.actionHint.textContent = "邀请链接已复制。";
  } catch (_) {
    ui.actionHint.textContent = "复制失败，请手动复制。";
  }
});

ui.overlayCopyBtn.addEventListener("click", async () => {
  try {
    await copyText(ui.shareLink.value || window.location.href);
    setMessage(ui.overlayMessage, "链接已复制。");
  } catch (_) {
    setMessage(ui.overlayMessage, "复制失败，请手动复制。", true);
  }
});

ui.overlayHomeBtn.addEventListener("click", () => goHome());
ui.startBtn.addEventListener("click", () => startGame().catch((error) => setMessage(ui.overlayMessage, error.message, true)));

ui.joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(ui.overlayMessage, "");
  try {
    await joinRoom(ui.joinName.value);
  } catch (error) {
    setMessage(ui.overlayMessage, error.message, true);
  }
});

document.querySelectorAll("[data-bid]").forEach((button) => {
  button.addEventListener("click", () => sendAction({ kind: "bid", bid: Number(button.dataset.bid) }));
});

ui.playBtn.addEventListener("click", () => {
  if (!app.selected.length) {
    return;
  }
  sendAction({ kind: "play", cardIds: app.selected });
});

ui.passBtn.addEventListener("click", () => sendAction({ kind: "pass" }));

ui.clearBtn.addEventListener("click", () => {
  app.selected = [];
  if (app.state) {
    renderPlayingState(app.state);
  }
});

ui.restartBtn.addEventListener("click", () => sendAction({ kind: "restart" }));

ui.roomCode.textContent = app.roomId || "----";
ui.shareLink.value = window.location.href;
app.pollTimer = window.setInterval(syncPage, 1200);
app.tickTimer = window.setInterval(paintTurnTimer, 250);
syncPage();
