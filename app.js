const PLAYER_IDS = ["p1", "p2", "p3"];
const PLAYER_NAMES = {
  p1: "1 号位",
  p2: "2 号位",
  p3: "3 号位",
};
const CARD_ORDER = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "BJ", "RJ"];
const SUITS = ["♠", "♥", "♣", "♦"];
const RANK_WEIGHT = Object.fromEntries(CARD_ORDER.map((rank, index) => [rank, index + 3]));

const ui = {
  modeLabel: document.getElementById("modeLabel"),
  seatLabel: document.getElementById("seatLabel"),
  phaseLabel: document.getElementById("phaseLabel"),
  beHostBtn: document.getElementById("beHostBtn"),
  startGameBtn: document.getElementById("startGameBtn"),
  joinBtn: document.getElementById("joinBtn"),
  joinSeat: document.getElementById("joinSeat"),
  remoteOffer: document.getElementById("remoteOffer"),
  localAnswer: document.getElementById("localAnswer"),
  joinStatus: document.getElementById("joinStatus"),
  offerP2: document.getElementById("offer-p2"),
  offerP3: document.getElementById("offer-p3"),
  answerP2: document.getElementById("answer-p2"),
  answerP3: document.getElementById("answer-p3"),
  statusP2: document.getElementById("status-p2"),
  statusP3: document.getElementById("status-p3"),
  tableSummary: document.getElementById("tableSummary"),
  kittyBox: document.getElementById("kittyBox"),
  trickBox: document.getElementById("trickBox"),
  turnBanner: document.getElementById("turnBanner"),
  playerP1: document.getElementById("player-p1"),
  playerP2: document.getElementById("player-p2"),
  playerP3: document.getElementById("player-p3"),
  bidActions: document.getElementById("bidActions"),
  playActions: document.getElementById("playActions"),
  handArea: document.getElementById("handArea"),
  actionHint: document.getElementById("actionHint"),
  playBtn: document.getElementById("playBtn"),
  passBtn: document.getElementById("passBtn"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  logBox: document.getElementById("logBox"),
};

const app = {
  role: "idle",
  playerId: null,
  selectedCards: [],
  debugLogs: [],
  peers: {
    host: null,
    p2: null,
    p3: null,
  },
  hostGame: null,
  viewState: null,
};

function logLine(message) {
  const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  app.debugLogs.unshift(`[${time}] ${message}`);
  app.debugLogs = app.debugLogs.slice(0, 12);
  render();
}

function setModeLabel(text) {
  ui.modeLabel.textContent = text;
}

function setSeatLabel() {
  ui.seatLabel.textContent = app.playerId ? PLAYER_NAMES[app.playerId] : "未加入";
}

function updateConnectionStatus() {
  ui.statusP2.textContent = connectionText("p2");
  ui.statusP3.textContent = connectionText("p3");
  ui.joinStatus.textContent = app.role === "peer" ? "已加入，等待房主开局" : "未加入";
  ui.startGameBtn.disabled = !(app.role === "host" && isSeatConnected("p2") && isSeatConnected("p3"));
}

function connectionText(playerId) {
  if (app.role !== "host") {
    return "未连接";
  }
  const peer = app.peers[playerId];
  if (!peer) {
    return "未生成";
  }
  if (peer.channel?.readyState === "open") {
    return "已连接";
  }
  if (peer.pc?.connectionState) {
    return `连接中: ${peer.pc.connectionState}`;
  }
  return "等待应答";
}

function isSeatConnected(playerId) {
  const peer = app.peers[playerId];
  return Boolean(peer?.channel?.readyState === "open");
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of CARD_ORDER.slice(0, 13)) {
      deck.push(makeCard(rank, suit));
    }
  }
  deck.push(makeCard("BJ", ""));
  deck.push(makeCard("RJ", ""));
  return deck;
}

function makeCard(rank, suit) {
  return {
    id: `${rank}-${suit || "joker"}-${Math.random().toString(36).slice(2, 8)}`,
    rank,
    suit,
    value: RANK_WEIGHT[rank],
    label: suit ? `${suit}${rank}` : rank === "BJ" ? "小王" : "大王",
  };
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function sortCards(cards) {
  return [...cards].sort((a, b) => a.value - b.value || a.label.localeCompare(b.label));
}

function nextPlayer(playerId) {
  return PLAYER_IDS[(PLAYER_IDS.indexOf(playerId) + 1) % PLAYER_IDS.length];
}

function startNewGame() {
  const deck = shuffle(createDeck());
  const hands = {
    p1: sortCards(deck.slice(0, 17)),
    p2: sortCards(deck.slice(17, 34)),
    p3: sortCards(deck.slice(34, 51)),
  };
  const kitty = sortCards(deck.slice(51));
  app.hostGame = {
    phase: "bidding",
    turn: "p1",
    hands,
    bids: { p1: null, p2: null, p3: null },
    highestBid: 0,
    highestBidder: null,
    landlord: null,
    kitty,
    lastPlay: null,
    trickLeader: null,
    passCount: 0,
    winner: null,
    winnerSide: null,
    logs: ["新一局开始，等待叫分。"],
  };
  app.selectedCards = [];
  logLine("房主开始新一局。");
  syncHostView();
}

function restartIfAllPassed() {
  if (Object.values(app.hostGame.bids).every((value) => value === 0)) {
    app.hostGame.logs.push("三家都不叫，自动重新发牌。");
    startNewGame();
    return true;
  }
  return false;
}

function hostHandleBid(playerId, bid) {
  const game = app.hostGame;
  if (!game || game.phase !== "bidding" || game.turn !== playerId) {
    return;
  }
  game.bids[playerId] = bid;
  game.logs.push(`${PLAYER_NAMES[playerId]} 叫分: ${bid === 0 ? "不叫" : `${bid} 分`}`);
  if (bid > game.highestBid) {
    game.highestBid = bid;
    game.highestBidder = playerId;
  }
  const next = nextPlayer(playerId);
  if (playerId === "p3") {
    if (restartIfAllPassed()) {
      return;
    }
    const landlord = game.highestBidder;
    game.landlord = landlord;
    game.phase = "playing";
    game.turn = landlord;
    game.trickLeader = landlord;
    game.lastPlay = null;
    game.passCount = 0;
    game.hands[landlord] = sortCards([...game.hands[landlord], ...game.kitty]);
    game.logs.push(`${PLAYER_NAMES[landlord]} 成为地主，底牌已加入手牌。`);
  } else {
    game.turn = next;
  }
  syncHostView();
}

function hostHandlePass(playerId) {
  const game = app.hostGame;
  if (!game || game.phase !== "playing" || game.turn !== playerId || !game.lastPlay) {
    return;
  }
  if (game.trickLeader === playerId) {
    return;
  }
  game.logs.push(`${PLAYER_NAMES[playerId]} 选择不要。`);
  game.passCount += 1;
  if (game.passCount >= 2) {
    game.turn = game.trickLeader;
    game.lastPlay = null;
    game.passCount = 0;
    game.logs.push("两家连续不要，新一轮由上手出牌。");
  } else {
    game.turn = nextPlayer(playerId);
  }
  syncHostView();
}

function hostHandlePlay(playerId, cardIds) {
  const game = app.hostGame;
  if (!game || game.phase !== "playing" || game.turn !== playerId) {
    return;
  }
  const hand = game.hands[playerId];
  const cards = cardIds.map((id) => hand.find((item) => item.id === id)).filter(Boolean);
  if (cards.length !== cardIds.length) {
    return;
  }
  const combo = classifyCombo(cards);
  if (!combo) {
    logLine("选择的牌型不合法。");
    return;
  }
  if (game.lastPlay && game.trickLeader !== playerId) {
    if (!canBeat(combo, game.lastPlay.combo)) {
      logLine("当前出牌压不过桌面上的牌。");
      return;
    }
  }
  const remaining = hand.filter((card) => !cardIds.includes(card.id));
  game.hands[playerId] = sortCards(remaining);
  game.lastPlay = {
    playerId,
    combo,
    cards: sortCards(cards),
  };
  game.trickLeader = playerId;
  game.passCount = 0;
  game.logs.push(`${PLAYER_NAMES[playerId]} 出牌: ${describeCards(cards)} (${combo.label})`);
  if (remaining.length === 0) {
    game.phase = "finished";
    game.winner = playerId;
    game.winnerSide = playerId === game.landlord ? "地主" : "农民";
    game.logs.push(`${PLAYER_NAMES[playerId]} 率先出完牌，${game.winnerSide}胜利。`);
  } else {
    game.turn = nextPlayer(playerId);
  }
  syncHostView();
}

function syncHostView() {
  app.viewState = buildViewState("p1");
  updateConnectionStatus();
  render();
  for (const playerId of ["p2", "p3"]) {
    const peer = app.peers[playerId];
    if (peer?.channel?.readyState === "open") {
      safeSend(peer.channel, {
        type: "state",
        payload: buildViewState(playerId),
      });
    }
  }
}

function buildViewState(viewerId) {
  const game = app.hostGame;
  if (!game) {
    return {
      phase: "lobby",
      playerId: viewerId,
      players: buildLobbyPlayers(viewerId),
      logs: [],
    };
  }
  const players = {};
  for (const playerId of PLAYER_IDS) {
    const hand = game.hands[playerId];
    players[playerId] = {
      name: PLAYER_NAMES[playerId],
      handCount: hand.length,
      hand: playerId === viewerId ? hand : [],
      bid: game.bids[playerId],
      isLandlord: game.landlord === playerId,
    };
  }
  return {
    phase: game.phase,
    playerId: viewerId,
    turn: game.turn,
    highestBid: game.highestBid,
    landlord: game.landlord,
    kitty: game.landlord ? game.kitty : [],
    players,
    lastPlay: game.lastPlay,
    winner: game.winner,
    winnerSide: game.winnerSide,
    logs: [...game.logs].slice(-14),
  };
}

function buildLobbyPlayers(viewerId) {
  return Object.fromEntries(
    PLAYER_IDS.map((playerId) => [
      playerId,
      {
        name: PLAYER_NAMES[playerId],
        handCount: 0,
        hand: playerId === viewerId ? [] : [],
        bid: null,
        isLandlord: false,
      },
    ]),
  );
}

function describeCards(cards) {
  return sortCards(cards)
    .map((card) => card.label)
    .join(" ");
}

function describeCombo(combo) {
  if (!combo) {
    return "未出牌";
  }
  return `${combo.label}`;
}

function render() {
  const state = app.viewState || {
    phase: "lobby",
    playerId: app.playerId || "p1",
    players: buildLobbyPlayers(app.playerId || "p1"),
    logs: [],
  };
  const visibleHand = state.players[state.playerId]?.hand || [];
  const visibleIds = new Set(visibleHand.map((card) => card.id));
  app.selectedCards = app.selectedCards.filter((cardId) => visibleIds.has(cardId));
  ui.phaseLabel.textContent = phaseText(state.phase);
  ui.tableSummary.textContent = summaryText(state);
  ui.kittyBox.textContent =
    state.landlord && state.kitty?.length ? `底牌: ${describeCards(state.kitty)}` : "底牌: 未揭晓";
  ui.trickBox.textContent = state.lastPlay
    ? `${PLAYER_NAMES[state.lastPlay.playerId]} 上手: ${describeCards(state.lastPlay.cards)} (${describeCombo(state.lastPlay.combo)})`
    : "本轮还没人出牌";
  ui.turnBanner.textContent = turnText(state);
  renderPlayerSlot(ui.playerP1, state, "p1");
  renderPlayerSlot(ui.playerP2, state, "p2");
  renderPlayerSlot(ui.playerP3, state, "p3");
  renderHand(visibleHand);
  renderActions(state);
  renderLogs(state.logs || []);
}

function phaseText(phase) {
  if (phase === "bidding") return "叫分";
  if (phase === "playing") return "出牌";
  if (phase === "finished") return "结算";
  return "大厅";
}

function summaryText(state) {
  if (state.phase === "lobby") {
    return "房主完成三人连接后即可开局。";
  }
  if (state.phase === "bidding") {
    return `当前最高叫分 ${state.highestBid} 分，轮到 ${PLAYER_NAMES[state.turn]}。`;
  }
  if (state.phase === "playing") {
    return `地主是 ${PLAYER_NAMES[state.landlord]}，轮到 ${PLAYER_NAMES[state.turn]} 出牌。`;
  }
  if (state.phase === "finished") {
    return `${PLAYER_NAMES[state.winner]} 已出完手牌，${state.winnerSide}胜利。`;
  }
  return "等待开始。";
}

function turnText(state) {
  if (state.phase === "finished") {
    return `${PLAYER_NAMES[state.winner]} 胜利`;
  }
  if (!state.turn) {
    return "等待开始";
  }
  return `${PLAYER_NAMES[state.turn]} 的回合`;
}

function renderPlayerSlot(node, state, playerId) {
  const player = state.players[playerId];
  const isMe = state.playerId === playerId;
  const lastPlay = state.lastPlay?.playerId === playerId ? describeCards(state.lastPlay.cards) : "暂未出牌";
  node.innerHTML = `
    <div class="player-head">
      <div>
        <strong>${player.name}${isMe ? "（你）" : ""}</strong>
        <div class="last-play">叫分: ${player.bid === null ? "未操作" : player.bid === 0 ? "不叫" : `${player.bid} 分`}</div>
      </div>
      <span class="badge">${player.isLandlord ? "地主" : "农民"}</span>
    </div>
    <div class="hand-count">${player.handCount}</div>
    <div class="last-play">剩余手牌</div>
    <div class="last-play">最近出牌: ${lastPlay}</div>
  `;
}

function renderHand(cards) {
  ui.handArea.innerHTML = "";
  if (!cards.length) {
    ui.handArea.innerHTML = '<div class="last-play">当前没有可显示的手牌。</div>';
    return;
  }
  for (const card of sortCards(cards)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `card ${card.suit === "♥" || card.suit === "♦" || card.rank === "RJ" ? "red" : ""} ${
      app.selectedCards.includes(card.id) ? "selected" : ""
    }`;
    button.innerHTML = `<strong>${card.label}</strong><small>${rankName(card.rank)}</small>`;
    button.addEventListener("click", () => toggleCardSelection(card.id));
    ui.handArea.appendChild(button);
  }
}

function rankName(rank) {
  if (rank === "BJ") return "Black Joker";
  if (rank === "RJ") return "Red Joker";
  return "手牌";
}

function renderActions(state) {
  const isMyTurn = state.turn === state.playerId;
  const myHand = state.players[state.playerId]?.hand || [];
  ui.bidActions.classList.toggle("hidden", !(state.phase === "bidding" && isMyTurn));
  ui.playActions.classList.toggle("hidden", !(state.phase === "playing" && isMyTurn));
  ui.passBtn.disabled = !(state.phase === "playing" && isMyTurn && state.lastPlay && state.lastPlay.playerId !== state.playerId);
  ui.playBtn.disabled = !(state.phase === "playing" && isMyTurn && app.selectedCards.length > 0);
  ui.clearSelectionBtn.disabled = app.selectedCards.length === 0;
  if (state.phase === "bidding" && isMyTurn) {
    ui.actionHint.textContent = "轮到你叫分。";
  } else if (state.phase === "playing" && isMyTurn) {
    const cards = myHand.filter((card) => app.selectedCards.includes(card.id));
    const combo = cards.length ? classifyCombo(cards) : null;
    ui.actionHint.textContent = cards.length
      ? combo
        ? `已选 ${describeCards(cards)}，牌型: ${combo.label}`
        : "当前选择不是合法牌型。"
      : "轮到你出牌，先选择手牌。";
  } else if (state.phase === "finished") {
    ui.actionHint.textContent = `${PLAYER_NAMES[state.winner]} 获胜。房主可以点击“开始新一局”重新发牌。`;
  } else {
    ui.actionHint.textContent = "等待其他玩家操作。";
  }
}

function renderLogs(lines) {
  ui.logBox.innerHTML = "";
  const merged = [...app.debugLogs, ...[...lines].reverse()];
  for (const line of merged) {
    const entry = document.createElement("div");
    entry.className = "log-line";
    entry.textContent = line;
    ui.logBox.appendChild(entry);
  }
}

function toggleCardSelection(cardId) {
  const set = new Set(app.selectedCards);
  if (set.has(cardId)) {
    set.delete(cardId);
  } else {
    set.add(cardId);
  }
  app.selectedCards = [...set];
  render();
}

function submitBid(bid) {
  if (app.role === "host") {
    hostHandleBid(app.playerId, bid);
    return;
  }
  sendAction({ kind: "bid", bid });
}

function submitPlay() {
  if (!app.selectedCards.length) {
    return;
  }
  const picked = [...app.selectedCards];
  app.selectedCards = [];
  if (app.role === "host") {
    hostHandlePlay(app.playerId, picked);
    render();
    return;
  }
  sendAction({ kind: "play", cardIds: picked });
  render();
}

function submitPass() {
  app.selectedCards = [];
  if (app.role === "host") {
    hostHandlePass(app.playerId);
    render();
    return;
  }
  sendAction({ kind: "pass" });
  render();
}

function sendAction(payload) {
  const peer = app.peers.host;
  if (!peer?.channel || peer.channel.readyState !== "open") {
    logLine("尚未连接到房主。");
    return;
  }
  safeSend(peer.channel, { type: "action", payload });
}

function safeSend(channel, data) {
  if (!channel || channel.readyState !== "open") {
    return;
  }
  channel.send(JSON.stringify(data));
}

function waitIceComplete(pc) {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function createPeerConnection() {
  return new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
}

async function becomeHost() {
  resetLocalSession();
  app.role = "host";
  app.playerId = "p1";
  setModeLabel("房主");
  setSeatLabel();
  updateConnectionStatus();
  app.viewState = {
    phase: "lobby",
    playerId: "p1",
    players: buildLobbyPlayers("p1"),
    logs: ["你已成为房主，请为另外两个座位生成 Offer。"],
  };
  render();
  logLine("已切换为房主模式。");
}

async function createHostOffer(playerId) {
  try {
    if (app.role !== "host") {
      await becomeHost();
    }
    closePeer(app.peers[playerId]);
    const pc = createPeerConnection();
    const channel = pc.createDataChannel("landlord");
    setupHostChannel(playerId, pc, channel);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);
    app.peers[playerId] = { pc, channel };
    updateConnectionStatus();
    getOfferTextarea(playerId).value = JSON.stringify(pc.localDescription);
    logLine(`已生成 ${PLAYER_NAMES[playerId]} 的 Offer。`);
  } catch (error) {
    logLine(`生成 ${PLAYER_NAMES[playerId]} Offer 失败: ${error.message}`);
  }
}

async function acceptHostAnswer(playerId) {
  try {
    const peer = app.peers[playerId];
    if (!peer?.pc) {
      logLine(`请先为 ${PLAYER_NAMES[playerId]} 生成 Offer。`);
      return;
    }
    const answerText = getAnswerTextarea(playerId).value.trim();
    if (!answerText) {
      logLine(`请先粘贴 ${PLAYER_NAMES[playerId]} 返回的 Answer。`);
      return;
    }
    await peer.pc.setRemoteDescription(JSON.parse(answerText));
    updateConnectionStatus();
    logLine(`${PLAYER_NAMES[playerId]} 的 Answer 已接入。`);
  } catch (error) {
    logLine(`接入 ${PLAYER_NAMES[playerId]} 失败: ${error.message}`);
  }
}

function setupHostChannel(playerId, pc, channel) {
  channel.addEventListener("open", () => {
    app.peers[playerId] = { pc, channel };
    safeSend(channel, { type: "hello", payload: { playerId } });
    if (app.hostGame) {
      safeSend(channel, { type: "state", payload: buildViewState(playerId) });
    }
    updateConnectionStatus();
    logLine(`${PLAYER_NAMES[playerId]} 已接入房间。`);
  });
  channel.addEventListener("close", () => {
    updateConnectionStatus();
    logLine(`${PLAYER_NAMES[playerId]} 已断开。`);
  });
  channel.addEventListener("message", (event) => handleHostMessage(playerId, event.data));
  pc.addEventListener("connectionstatechange", () => {
    updateConnectionStatus();
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      logLine(`${PLAYER_NAMES[playerId]} 连接状态: ${pc.connectionState}`);
    }
  });
}

function handleHostMessage(playerId, raw) {
  try {
    const message = JSON.parse(raw);
    if (message.type !== "action") {
      return;
    }
    const payload = message.payload;
    if (payload.kind === "bid") {
      hostHandleBid(playerId, Number(payload.bid));
    }
    if (payload.kind === "play") {
      hostHandlePlay(playerId, payload.cardIds || []);
    }
    if (payload.kind === "pass") {
      hostHandlePass(playerId);
    }
  } catch (error) {
    logLine(`收到 ${PLAYER_NAMES[playerId]} 的消息格式错误: ${error.message}`);
  }
}

async function joinRoom() {
  try {
    const playerId = ui.joinSeat.value;
    const offerText = ui.remoteOffer.value.trim();
    if (!offerText) {
      logLine("请先粘贴房主 Offer。");
      return;
    }
    closePeer(app.peers.host);
    const pc = createPeerConnection();
    pc.addEventListener("datachannel", (event) => {
      setupPeerChannel(playerId, pc, event.channel);
    });
    await pc.setRemoteDescription(JSON.parse(offerText));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceComplete(pc);
    app.role = "peer";
    app.playerId = playerId;
    app.hostGame = null;
    app.selectedCards = [];
    app.peers.host = { pc, channel: null };
    setModeLabel("加入者");
    setSeatLabel();
    ui.localAnswer.value = JSON.stringify(pc.localDescription);
    updateConnectionStatus();
    render();
    logLine(`已为 ${PLAYER_NAMES[playerId]} 生成 Answer，请发回房主。`);
  } catch (error) {
    logLine(`加入房间失败: ${error.message}`);
  }
}

function setupPeerChannel(playerId, pc, channel) {
  app.peers.host = { pc, channel };
  channel.addEventListener("open", () => {
    setModeLabel("联机中");
    updateConnectionStatus();
    logLine(`已连接房主，座位 ${PLAYER_NAMES[playerId]}。`);
  });
  channel.addEventListener("close", () => {
    updateConnectionStatus();
    logLine("与房主的连接已关闭。");
  });
  channel.addEventListener("message", (event) => handlePeerMessage(event.data));
  pc.addEventListener("connectionstatechange", () => {
    updateConnectionStatus();
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      logLine(`房主连接状态: ${pc.connectionState}`);
    }
  });
}

function handlePeerMessage(raw) {
  try {
    const message = JSON.parse(raw);
    if (message.type === "hello") {
      app.playerId = message.payload.playerId;
      setSeatLabel();
      return;
    }
    if (message.type === "state") {
      app.viewState = message.payload;
      render();
    }
  } catch (error) {
    logLine(`收到房主消息失败: ${error.message}`);
  }
}

function closePeer(peer) {
  if (!peer) {
    return;
  }
  try {
    peer.channel?.close();
  } catch (_) {}
  try {
    peer.pc?.close();
  } catch (_) {}
}

function resetLocalSession() {
  closePeer(app.peers.p2);
  closePeer(app.peers.p3);
  closePeer(app.peers.host);
  app.peers = { p2: null, p3: null, host: null };
  app.hostGame = null;
  app.viewState = null;
  app.selectedCards = [];
}

function getOfferTextarea(playerId) {
  return playerId === "p2" ? ui.offerP2 : ui.offerP3;
}

function getAnswerTextarea(playerId) {
  return playerId === "p2" ? ui.answerP2 : ui.answerP3;
}

function classifyCombo(cards) {
  if (!cards.length) {
    return null;
  }
  const sorted = sortCards(cards);
  const counts = countByWeight(sorted);
  const weights = [...counts.keys()].sort((a, b) => a - b);
  const countValues = [...counts.values()].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return { type: "single", main: sorted[0].value, length: 1, label: "单张" };
  }
  if (sorted.length === 2 && isRocket(weights)) {
    return { type: "rocket", main: 99, length: 1, label: "王炸" };
  }
  if (sorted.length === 2 && countValues[0] === 2) {
    return { type: "pair", main: weights[0], length: 1, label: "对子" };
  }
  if (sorted.length === 3 && countValues[0] === 3) {
    return { type: "triple", main: weights[0], length: 1, label: "三张" };
  }
  if (sorted.length === 4 && countValues.join(",") === "1,3") {
    return { type: "triple-single", main: findWeightByCount(counts, 3)[0], length: 1, label: "三带一" };
  }
  if (sorted.length === 4 && countValues[0] === 4) {
    return { type: "bomb", main: weights[0], length: 1, label: "炸弹" };
  }
  if (sorted.length === 5 && countValues.join(",") === "2,3") {
    return { type: "triple-pair", main: findWeightByCount(counts, 3)[0], length: 1, label: "三带一对" };
  }
  if (isStraight(weights, counts, 1, 5)) {
    return { type: "straight", main: weights[0], length: sorted.length, label: "顺子" };
  }
  if (isStraight(weights, counts, 2, 6)) {
    return { type: "pair-straight", main: weights[0], length: sorted.length / 2, label: "连对" };
  }
  const planePure = detectPlane(counts, sorted.length, false);
  if (planePure) {
    return planePure;
  }
  const planeSingle = detectPlane(counts, sorted.length, "single");
  if (planeSingle) {
    return planeSingle;
  }
  const planePair = detectPlane(counts, sorted.length, "pair");
  if (planePair) {
    return planePair;
  }
  const fourTwo = detectFourWithTwo(counts, sorted.length);
  if (fourTwo) {
    return fourTwo;
  }
  return null;
}

function countByWeight(cards) {
  const map = new Map();
  for (const card of cards) {
    map.set(card.value, (map.get(card.value) || 0) + 1);
  }
  return map;
}

function isRocket(weights) {
  return weights.length === 2 && weights.includes(RANK_WEIGHT.BJ) && weights.includes(RANK_WEIGHT.RJ);
}

function findWeightByCount(counts, target) {
  return [...counts.entries()]
    .filter(([, count]) => count === target)
    .map(([weight]) => weight)
    .sort((a, b) => a - b);
}

function isStraight(weights, counts, perGroup, minimumCards) {
  const totalCards = weights.length * perGroup;
  if (totalCards < minimumCards) {
    return false;
  }
  if (weights.some((weight) => weight >= RANK_WEIGHT["2"])) {
    return false;
  }
  if (![...counts.values()].every((count) => count === perGroup)) {
    return false;
  }
  return isConsecutive(weights);
}

function isConsecutive(weights) {
  for (let i = 1; i < weights.length; i += 1) {
    if (weights[i] !== weights[i - 1] + 1) {
      return false;
    }
  }
  return true;
}

function detectPlane(counts, totalCards, wingType) {
  const triples = [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([weight]) => weight)
    .filter((weight) => weight < RANK_WEIGHT["2"])
    .sort((a, b) => a - b);
  for (let start = 0; start < triples.length; start += 1) {
    for (let end = start + 1; end < triples.length; end += 1) {
      const sequence = triples.slice(start, end + 1);
      if (!isConsecutive(sequence)) {
        continue;
      }
      const length = sequence.length;
      const required =
        wingType === false ? length * 3 : wingType === "single" ? length * 4 : length * 5;
      if (required !== totalCards) {
        continue;
      }
      const leftovers = new Map(counts);
      for (const weight of sequence) {
        leftovers.set(weight, leftovers.get(weight) - 3);
      }
      const nonZeroEntries = [...leftovers.entries()].filter(([, count]) => count > 0);
      const values = nonZeroEntries.map(([, count]) => count).sort((a, b) => a - b);
      if (wingType === false && values.length === 0) {
        return { type: "plane", main: sequence[0], length, label: "飞机" };
      }
      if (
        wingType === "single" &&
        values.length === length &&
        values.every((count) => count === 1) &&
        nonZeroEntries.every(([weight]) => !sequence.includes(weight))
      ) {
        return { type: "plane-single", main: sequence[0], length, label: "飞机带单" };
      }
      if (
        wingType === "pair" &&
        values.length === length &&
        values.every((count) => count === 2) &&
        nonZeroEntries.every(([weight]) => !sequence.includes(weight))
      ) {
        return { type: "plane-pair", main: sequence[0], length, label: "飞机带对" };
      }
    }
  }
  return null;
}

function detectFourWithTwo(counts, totalCards) {
  const four = findWeightByCount(counts, 4);
  if (!four.length) {
    return null;
  }
  if (totalCards === 6) {
    return { type: "four-two-single", main: four[0], length: 1, label: "四带二" };
  }
  if (totalCards === 8) {
    const rest = [...counts.entries()].filter(([weight]) => weight !== four[0]);
    if (rest.length === 2 && rest.every(([, count]) => count === 2)) {
      return { type: "four-two-pair", main: four[0], length: 1, label: "四带两对" };
    }
  }
  return null;
}

function canBeat(current, previous) {
  if (!previous) {
    return true;
  }
  if (previous.type === "rocket") {
    return false;
  }
  if (current.type === "rocket") {
    return true;
  }
  if (current.type === "bomb" && previous.type !== "bomb") {
    return true;
  }
  if (current.type !== previous.type) {
    return false;
  }
  if (current.length !== previous.length) {
    return false;
  }
  return current.main > previous.main;
}

function bindEvents() {
  ui.beHostBtn.addEventListener("click", becomeHost);
  ui.startGameBtn.addEventListener("click", () => {
    if (app.role !== "host") {
      return;
    }
    startNewGame();
  });
  ui.joinBtn.addEventListener("click", joinRoom);
  document.querySelectorAll("[data-host-offer]").forEach((button) => {
    button.addEventListener("click", () => createHostOffer(button.dataset.hostOffer));
  });
  document.querySelectorAll("[data-host-answer]").forEach((button) => {
    button.addEventListener("click", () => acceptHostAnswer(button.dataset.hostAnswer));
  });
  document.querySelectorAll("[data-bid]").forEach((button) => {
    button.addEventListener("click", () => submitBid(Number(button.dataset.bid)));
  });
  ui.playBtn.addEventListener("click", submitPlay);
  ui.passBtn.addEventListener("click", submitPass);
  ui.clearSelectionBtn.addEventListener("click", () => {
    app.selectedCards = [];
    render();
  });
}

bindEvents();
render();
logLine("页面已加载。推荐使用三台浏览器窗口分别打开。");
