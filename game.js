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
const LAST_NAME_KEY = "ddz-last-name";

const ui = {
  roomCode: document.getElementById("gameRoomCode"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  tableFelt: document.querySelector(".table-felt"),
  statusText: document.getElementById("gameStatusText"),
  stageBadge: document.getElementById("stageBadge"),
  stagePrompt: document.getElementById("stagePrompt"),
  seatLeft: document.getElementById("seatLeft"),
  seatRight: document.getElementById("seatRight"),
  mySeat: document.getElementById("mySeat"),
  deckDock: document.getElementById("deckDock"),
  dealBanner: document.getElementById("dealBanner"),
  kittyZone: document.getElementById("kittyZone"),
  kittyHint: document.getElementById("kittyHint"),
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
  lastRenderedPhase: null,
  dealTimer: null,
  dealCleanupTimer: null,
  syncInFlight: false,
  actionPending: false,
  joinPending: false,
  startPending: false,
};

if (!roomId) {
  goHome();
}

function setTablePhase(phase) {
  ui.tableFelt.dataset.phase = phase || "waiting";
}

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

function stopPolling() {
  if (app.pollTimer) {
    window.clearInterval(app.pollTimer);
    app.pollTimer = null;
  }
}

function startPolling() {
  if (!app.pollTimer) {
    app.pollTimer = window.setInterval(syncPage, 1200);
  }
}

function showClosedRoom(message) {
  stopPolling();
  app.turnDeadline = 0;
  ui.turnTimer.classList.add("hidden");
  ui.overlay.classList.remove("hidden");
  ui.overlayTitle.textContent = "这桌已经不可用";
  ui.overlayDesc.textContent = message || "房间可能已经过期、被清理，或者房主已经重新开桌。";
  ui.joinForm.classList.add("hidden");
  ui.startBtn.classList.add("hidden");
  ui.waitingPlayers.innerHTML = "";
  ui.shareLink.value = window.location.href;
  ui.statusText.textContent = "牌桌不可用";
  ui.turnBadge.textContent = "请返回首页";
  ui.kittyZone.innerHTML = '<div class="desk-placeholder">牌桌已关闭</div>';
  ui.trickZone.innerHTML = '<div class="desk-placeholder">请返回首页重新加入</div>';
  ui.deskFeed.textContent = "返回首页后，可以重新进入其他牌桌。";
  ui.bidActions.classList.add("hidden");
  ui.playActions.classList.add("hidden");
  ui.playerSummary.textContent = "当前没有可用牌桌";
  ui.actionHint.textContent = "请返回首页，从局域网大厅重新选择牌桌。";
  setMessage(ui.overlayMessage, message || "房间已失效。", true);
}

async function recoverFromSessionError(message) {
  if (!app.session) {
    return false;
  }
  if (!message.includes("身份已失效")) {
    return false;
  }
  clearSession(app.roomId);
  app.session = null;
  await loadSummary();
  return true;
}

function recoverFromMissingRoom(message) {
  if (app.roomId) {
    clearSession(app.roomId);
  }
  app.session = null;
  showClosedRoom(message);
  return true;
}

function setStageCopy(badge, prompt, kittyHint) {
  ui.stageBadge.textContent = badge;
  ui.stagePrompt.textContent = prompt;
  ui.kittyHint.textContent = kittyHint;
}

function stopDealEffect() {
  window.clearTimeout(app.dealTimer);
  window.clearTimeout(app.dealCleanupTimer);
  ui.tableFelt.classList.remove("is-dealing");
  ui.myHand.classList.remove("dealing");
  ui.dealBanner.classList.add("hidden");
}

function triggerDealEffect() {
  stopDealEffect();
  ui.tableFelt.classList.add("is-dealing");
  ui.myHand.classList.add("dealing");
  ui.dealBanner.textContent = "发牌中";
  ui.dealBanner.classList.remove("hidden");
  app.dealTimer = window.setTimeout(() => {
    ui.dealBanner.textContent = "准备叫分";
  }, 950);
  app.dealCleanupTimer = window.setTimeout(() => {
    ui.tableFelt.classList.remove("is-dealing");
    ui.myHand.classList.remove("dealing");
    ui.dealBanner.classList.add("hidden");
  }, 1900);
}

function rememberPhase(phase) {
  const previous = app.lastRenderedPhase;
  app.lastRenderedPhase = phase;
  if (previous === "waiting" && phase === "bidding") {
    triggerDealEffect();
    return;
  }
  if (phase === "waiting") {
    stopDealEffect();
  }
}

function seatBacksMarkup(count, side = "") {
  if (!count) {
    return "";
  }
  const visible = Math.max(1, Math.min(count, 8));
  return `
    <div class="seat-handbacks ${side}">
      ${Array.from({ length: visible })
        .map((_, index) => `<span class="mini-card-back" style="--back-index:${index}"></span>`)
        .join("")}
      <em class="seat-handcount">${count} 张</em>
    </div>
  `;
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
  const backs = options.showBacks ? seatBacksMarkup(options.backCount ?? player.handCount, options.side) : "";

  return `
    <div class="seat-card ${options.self ? "self" : ""} ${player.isLandlord ? "landlord" : ""}">
      <div class="seat-avatar">${avatar}</div>
      <div class="seat-meta">
        <strong>${escapeHtml(player.name)}</strong>
        <span>${escapeHtml(role)}${bid ? ` · ${escapeHtml(bid)}` : ""}</span>
        <em>${escapeHtml(count)}</em>
      </div>
      ${backs}
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
  const phase = summary.phase === "waiting" ? "waiting" : "playing";
  rememberPhase(phase);
  app.turnDeadline = 0;
  app.lastTurnPlayerId = null;
  app.lastPhase = null;
  setTablePhase(phase);
  setStageCopy(
    summary.canJoin ? "牌桌等你入座" : summary.phase === "waiting" ? "这桌已经坐满" : "牌局进行中",
    summary.canJoin
      ? "输入昵称后就会坐到牌桌上，房主开始后自动进入对局。"
      : summary.phase === "waiting"
        ? "已经有 3 个人坐下了，等房主点开始。"
        : "这一局已经开打了，等下一桌会更合适。",
    summary.phase === "waiting" ? "房主开局后会亮底牌" : "底牌已经跟随本局发出"
  );
  ui.roomCode.textContent = summary.roomId || "----";
  ui.shareLink.value = summary.shareUrl || window.location.href;
  ui.statusText.textContent =
    summary.phase === "waiting"
      ? `当前 ${summary.playerCount}/${summary.capacity} 人，等待开局`
      : "这桌正在进行中";
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
  ui.deskFeed.textContent = summary.canJoin ? "点下面输入昵称后直接坐下。" : summary.phase === "waiting" ? "等待房主重新开桌。" : "这一桌正在对局中。";
  ui.bidActions.classList.add("hidden");
  ui.playActions.classList.add("hidden");
  ui.playerSummary.textContent = "尚未入座";
  ui.actionHint.textContent = summary.canJoin ? "加入后会自动留在这个牌桌里等待开局。" : summary.phase === "waiting" ? "当前无法加入。" : "可以等待这一局结束后再加入。";
}

function renderWaitingState(state) {
  app.state = state;
  rememberPhase("waiting");
  app.turnDeadline = 0;
  app.lastTurnPlayerId = null;
  app.lastPhase = null;
  const relative = relativePlayers(state);
  const me = relative.self;
  setTablePhase("waiting");
  setStageCopy(
    state.canStart ? "牌桌已坐满" : "等待玩家入座",
    state.canStart
      ? "人已经齐了，房主点开始后会直接发牌。"
      : "同一局域网下的人打开首页后，会在大厅里直接看到这张桌子。",
    "开局后会自动发出底牌"
  );
  ui.roomCode.textContent = state.roomId;
  ui.shareLink.value = state.shareUrl;
  ui.overlay.classList.remove("hidden");
  ui.overlayTitle.textContent = state.players.length < 3 ? "等待玩家加入" : "牌桌已满，可以开始";
  ui.overlayDesc.textContent = state.canStart
    ? "现在点击开始游戏，所有人都将在这个牌桌里直接进入对局。"
    : state.players.length < 3
      ? "同一网络下的人打开首页后，会在大厅里看到这桌并直接加入。"
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
  ui.playerSummary.textContent = `${me?.name || "你"} 已入座`;
  ui.actionHint.textContent = state.canStart ? "你是房主，可以直接开局。" : "等待房主开始游戏。";
  ui.restartBtn.disabled = true;
}

function renderPlayingState(state) {
  app.state = state;
  rememberPhase(state.phase);
  const relative = relativePlayers(state);
  const me = relative.self;
  const turnPlayer = state.players.find((player) => player.id === state.turnPlayerId);
  const winner = state.players.find((player) => player.id === state.winnerPlayerId);
  const lastPlayPlayer = state.lastPlay ? state.players.find((player) => player.id === state.lastPlay.playerId) : null;
  const landlord = state.players.find((player) => player.id === state.landlordPlayerId);
  const selectedSet = new Set(state.myHand.map((card) => card.id));
  const isMyTurn = state.turnPlayerId === state.playerId;
  app.selected = app.selected.filter((id) => selectedSet.has(id));

  ui.overlay.classList.add("hidden");
  setTablePhase(state.phase);
  ui.roomCode.textContent = state.roomId;
  ui.shareLink.value = state.shareUrl;
  ui.statusText.textContent =
    state.phase === "bidding"
      ? `抢地主中 · 当前最高 ${state.highestBid} 分`
      : state.phase === "finished"
        ? `${winner?.name || "玩家"} 获胜`
        : `地主：${landlord?.name || "待定"}`;

  if (state.phase === "bidding") {
    setStageCopy(
      "抢地主",
      isMyTurn ? "轮到你叫分，分数越高越容易拿到地主。" : `等待 ${turnPlayer?.name || "玩家"} 叫分。`,
      state.highestBid > 0 ? `当前桌面最高叫分 ${state.highestBid} 分` : "还没人叫分"
    );
  } else if (state.phase === "playing") {
    const followText =
      state.lastPlay && state.lastPlay.playerId !== state.playerId
        ? `需要压过 ${lastPlayPlayer?.name || "玩家"} 的 ${state.lastPlay.comboLabel}`
        : "你当前是先手，可以自由选择合法牌型。";
    setStageCopy(
      "出牌阶段",
      isMyTurn ? followText : `等待 ${turnPlayer?.name || "玩家"} 出牌。`,
      landlord ? `底牌已经归 ${landlord.name}` : "地主确定后底牌会显示在这里"
    );
  } else {
    const landlordWon = winner && winner.id === state.landlordPlayerId;
    setStageCopy(
      landlordWon ? "地主胜利" : "农民胜利",
      `${winner?.name || "玩家"} 已经把手牌出完，这一局结束了。`,
      "可以直接在这张桌子上继续下一局"
    );
  }

  ui.seatLeft.innerHTML = seatMarkup(relative.left, {
    placeholder: "等待左侧玩家",
    isTurn: state.turnPlayerId === relative.left?.id,
    showBacks: state.phase !== "waiting",
    backCount: relative.left?.handCount,
    side: "left",
  });
  ui.seatRight.innerHTML = seatMarkup(relative.right, {
    placeholder: "等待右侧玩家",
    isTurn: state.turnPlayerId === relative.right?.id,
    showBacks: state.phase !== "waiting",
    backCount: relative.right?.handCount,
    side: "right",
  });
  ui.mySeat.innerHTML = seatMarkup(me, {
    self: true,
    placeholder: "你的位置",
    isTurn: state.turnPlayerId === me?.id,
  });

  ui.kittyZone.innerHTML = playedCardsMarkup(state.kitty);
  if (state.lastPlay) {
    ui.trickZone.innerHTML = `
      <div class="desk-play-head">${escapeHtml(lastPlayPlayer?.name || "玩家")} · ${escapeHtml(state.lastPlay.comboLabel)}</div>
      <div class="desk-card-row large">${playedCardsMarkup(state.lastPlay.cards)}</div>
    `;
  } else {
    ui.trickZone.innerHTML = '<div class="desk-placeholder">本轮还没人出牌</div>';
  }

  ui.turnBadge.textContent =
    state.phase === "finished"
      ? `${winner?.name || "玩家"} 胜利`
      : isMyTurn
        ? state.phase === "bidding"
          ? "轮到你叫分"
          : "轮到你出牌"
        : `${turnPlayer?.name || "玩家"} 操作中`;
  syncTurnTimer(state);

  ui.deskFeed.innerHTML = [...state.logs]
    .slice(-4)
    .map((line) => `<div class="feed-line"><span class="feed-dot"></span><span>${escapeHtml(line)}</span></div>`)
    .join("");

  ui.playerSummary.textContent = `${me?.name || "你"} · ${state.myHand.length} 张手牌`;
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
          style="--card-index:${index}; z-index:${index + 1}; margin-left:${index === 0 ? 0 : -38}px"
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
  const state = await apiPost(`/api/rooms/${app.roomId}/state`, {
    playerId: app.session.playerId,
    token: app.session.token,
  });
  if (state.phase === "waiting") {
    renderWaitingState(state);
  } else {
    renderPlayingState(state);
  }
}

async function joinRoom(name) {
  savePreferredName(name);
  const payload = await apiPost(`/api/rooms/${app.roomId}/join`, { name });
  saveSession(payload.roomId, payload);
  app.session = payload;
  await loadState();
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
    app.actionPending = true;
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
    if (await recoverFromSessionError(error.message)) {
      return;
    }
    if (error.message.includes("房间不存在")) {
      recoverFromMissingRoom(error.message);
      return;
    }
    setMessage(ui.overlayMessage, error.message, true);
    ui.actionHint.textContent = error.message;
  } finally {
    app.actionPending = false;
  }
}

async function syncPage() {
  if (app.syncInFlight || app.actionPending || app.joinPending || app.startPending || document.hidden) {
    return;
  }
  app.syncInFlight = true;
  try {
    if (app.session) {
      await loadState();
    } else {
      await loadSummary();
    }
  } catch (error) {
    if (await recoverFromSessionError(error.message)) {
      return;
    }
    if (error.message.includes("房间不存在")) {
      recoverFromMissingRoom(error.message);
      return;
    }
    setMessage(ui.overlayMessage, error.message, true);
  } finally {
    app.syncInFlight = false;
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
ui.startBtn.addEventListener("click", async () => {
  if (app.startPending) {
    return;
  }
  try {
    app.startPending = true;
    ui.startBtn.disabled = true;
    await startGame();
  } catch (error) {
    if (await recoverFromSessionError(error.message)) {
      return;
    }
    if (error.message.includes("房间不存在")) {
      recoverFromMissingRoom(error.message);
      return;
    }
    setMessage(ui.overlayMessage, error.message, true);
  } finally {
    app.startPending = false;
    if (app.state?.phase === "waiting") {
      ui.startBtn.disabled = !app.state.canStart;
    }
  }
});

ui.joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (app.joinPending) {
    return;
  }
  setMessage(ui.overlayMessage, "");
  try {
    app.joinPending = true;
    const joinSubmit = ui.joinForm.querySelector("button[type='submit']");
    joinSubmit.disabled = true;
    await joinRoom(ui.joinName.value);
  } catch (error) {
    if (error.message.includes("房间不存在")) {
      recoverFromMissingRoom(error.message);
      return;
    }
    setMessage(ui.overlayMessage, error.message, true);
  } finally {
    app.joinPending = false;
    const joinSubmit = ui.joinForm.querySelector("button[type='submit']");
    joinSubmit.disabled = false;
  }
});

document.querySelectorAll("[data-bid]").forEach((button) => {
  button.addEventListener("click", () => {
    if (app.actionPending) {
      return;
    }
    sendAction({ kind: "bid", bid: Number(button.dataset.bid) });
  });
});

ui.playBtn.addEventListener("click", () => {
  if (!app.selected.length || app.actionPending) {
    return;
  }
  sendAction({ kind: "play", cardIds: app.selected });
});

ui.passBtn.addEventListener("click", () => {
  if (app.actionPending) {
    return;
  }
  sendAction({ kind: "pass" });
});

ui.clearBtn.addEventListener("click", () => {
  app.selected = [];
  if (app.state) {
    renderPlayingState(app.state);
  }
});

ui.restartBtn.addEventListener("click", () => {
  if (app.actionPending) {
    return;
  }
  sendAction({ kind: "restart" });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPolling();
    return;
  }
  syncPage();
  startPolling();
});

window.addEventListener("pagehide", () => {
  stopPolling();
  if (app.tickTimer) {
    window.clearInterval(app.tickTimer);
    app.tickTimer = null;
  }
});

ui.roomCode.textContent = app.roomId || "----";
ui.shareLink.value = window.location.href;
ui.joinName.value = loadSavedName();
startPolling();
app.tickTimer = window.setInterval(paintTurnTimer, 250);
syncPage();
