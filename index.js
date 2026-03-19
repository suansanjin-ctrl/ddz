const { apiGet, apiPost, roomIdFromInput, saveSession, goToGame, copyText, setMessage } = window.DdzCommon;

const serverOrigin = document.getElementById("serverOrigin");
const copyOriginBtn = document.getElementById("copyOriginBtn");
const createForm = document.getElementById("createForm");
const joinForm = document.getElementById("joinForm");
const createName = document.getElementById("createName");
const joinName = document.getElementById("joinName");
const joinRoom = document.getElementById("joinRoom");
const homeMessage = document.getElementById("homeMessage");

async function bootstrapHome() {
  try {
    const info = await apiGet("/api/server-info");
    serverOrigin.textContent = info.lanOrigin;
  } catch (error) {
    serverOrigin.textContent = "无法读取服务器地址";
    setMessage(homeMessage, error.message, true);
  }
}

copyOriginBtn.addEventListener("click", async () => {
  try {
    await copyText(serverOrigin.textContent);
    setMessage(homeMessage, "局域网地址已复制。");
  } catch (_) {
    setMessage(homeMessage, "复制失败，请手动复制地址。", true);
  }
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(homeMessage, "");
  try {
    const payload = await apiPost("/api/rooms", { name: createName.value });
    saveSession(payload.roomId, payload);
    goToGame(payload.roomId);
  } catch (error) {
    setMessage(homeMessage, error.message, true);
  }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(homeMessage, "");
  const roomId = roomIdFromInput(joinRoom.value);
  if (!roomId) {
    setMessage(homeMessage, "请输入正确的房间号或房间链接。", true);
    return;
  }

  try {
    const payload = await apiPost(`/api/rooms/${roomId}/join`, { name: joinName.value });
    saveSession(payload.roomId, payload);
    goToGame(payload.roomId);
  } catch (error) {
    setMessage(homeMessage, error.message, true);
  }
});

bootstrapHome();
