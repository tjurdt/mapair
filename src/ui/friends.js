import { modal, closeModal } from "./modal.js";
import { esc } from "./html.js";
import { formatFriendCode, looksLikeFriendCode, validateFriendInput } from "../friends.js";

const INPUT_ERRORS = {
  empty: "請先輸入使用者 ID", invalid: "這個 ID 格式不正確",
  self: "這是你自己的 ID", duplicate: "這位好友已經在清單裡了"
};

/**
 * The friends manager modal (docs/FRIENDS.md handshake).
 *
 * The panel reads live friend state through the injected getters and applies
 * optimistic patches to `friendsState` / `incomingRequestsState` (the real
 * `noSpaceState` maps); the Firestore listeners reconcile afterwards. Returns
 * its `render` fn so the caller can re-run it when a snapshot lands.
 *
 * @returns {() => void} render
 */
export function openFriendsPanel({
  currentUid, repo, isCurrent,
  getFriends, getIncomingRaw,
  getIncoming, getSuggestions, getFriendCode, profileName, participantName,
  ensureFriendCode, onFriendCodeReady, afterMutation, onClose
}) {
  // getFriends() / getIncomingRaw() return the *live* noSpaceState maps (their
  // listeners reassign the objects). Optimistic patches go straight onto them;
  // the next snapshot replaces the map with the reconciled truth.
  const friendsState = () => getFriends() || {};
  const incomingState = () => getIncomingRaw() || {};
  const entries = () => Object.values(friendsState());
  const incomingKey = (fromUid) => `${fromUid}__${currentUid}`;

  modal(`
    <h2 style="margin-bottom:4px">好友</h2>
    <div class="admin" style="margin-bottom:10px">送出邀請、對方接受後，「同行者」選單就能直接選到他。<br>
      你的好友碼：<code id="fm_mycode" style="user-select:all;font-size:14px;letter-spacing:1px">${esc(formatFriendCode(getFriendCode()) || "產生中…")}</code>
      <span style="opacity:.6"> · ID：<code id="fm_myid" style="user-select:all;word-break:break-all">${esc(currentUid)}</code></span></div>
    <div class="row" style="gap:6px">
      <input id="fm_uid" placeholder="輸入好友碼（例：ABC-D23）或使用者 ID" style="flex:1;min-width:0;padding:9px;border:1px solid var(--line);border-radius:8px">
      <button class="btn grey" id="fm_add">送出邀請</button>
    </div>
    <div id="fm_err" class="admin" style="color:#b25b6b;margin-top:4px"></div>
    <div id="fm_incoming_wrap" style="display:none">
      <div class="sethead">好友邀請</div>
      <div id="fm_incoming"></div>
    </div>
    <div class="sethead">我的好友</div>
    <div id="fm_list"></div>
    <div id="fm_outgoing_wrap" style="display:none">
      <div class="sethead">邀請中（待對方確認）</div>
      <div id="fm_outgoing"></div>
    </div>
    <div id="fm_suggest_wrap" style="display:none">
      <div class="sethead">曾一起記錄、還沒加好友</div>
      <div id="fm_suggest"></div>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn" id="fm_done">完成</button></div>
  `);

  const g = (id) => document.getElementById(id);
  const err = g("fm_err");

  async function run(operation, optimistic) {
    if (!isCurrent()) return;
    if (typeof optimistic === "function") optimistic();
    render();
    try { await operation(repo); err.textContent = ""; }
    catch (e) { err.textContent = "操作失敗：" + (e?.message || e); }
    afterMutation();
  }

  async function addOrAccept(raw) {
    err.textContent = "";
    let value = typeof raw === "string" ? raw.trim() : "";
    if (looksLikeFriendCode(value)) {
      if (!isCurrent()) return;
      let resolved = null;
      try { resolved = await repo.uidForFriendCode(value); }
      catch (e) { err.textContent = "查詢好友碼失敗：" + (e?.message || e); return; }
      if (!resolved) { err.textContent = "找不到這個好友碼"; return; }
      value = resolved;
    }
    const existing = friendsState()[value];
    if (value === currentUid) { err.textContent = "這是你自己"; return; }
    if (existing?.state === "linked") { err.textContent = "你們已經是好友了"; return; }
    if (existing?.state === "pending_out") { err.textContent = "已送出邀請，等待對方確認"; return; }
    if (getIncoming().some((r) => r.from === value)) {
      if (g("fm_uid")) g("fm_uid").value = "";
      run((r) => r.acceptFriendRequest(value), () => {
        friendsState()[value] = { friendUid: value, nickname: "", pinned: false, state: "linked" };
        delete incomingState()[incomingKey(value)];
      });
      return;
    }
    const check = validateFriendInput(value, { selfUid: currentUid, existingUids: entries().map((f) => f.friendUid) });
    if (!check.ok) { err.textContent = INPUT_ERRORS[check.reason] || "無法送出"; return; }
    if (g("fm_uid")) g("fm_uid").value = "";
    run((r) => r.sendFriendRequest(check.friendUid), () => {
      friendsState()[check.friendUid] = { friendUid: check.friendUid, nickname: "", pinned: false, state: "pending_out" };
    });
  }

  function personCell(name, id) {
    return `<span style="flex:1 1 130px;min-width:0">
      <strong style="word-break:break-all">${esc(name || "（尚未載入名稱）")}</strong>
      <span class="admin" style="display:block;word-break:break-all">${esc(id)}</span></span>`;
  }

  function render() {
    if (!g("fm_list")) { onClose(); return; }

    const code = getFriendCode();
    if (g("fm_mycode") && code) g("fm_mycode").textContent = formatFriendCode(code);

    const incoming = getIncoming();
    g("fm_incoming_wrap").style.display = incoming.length ? "block" : "none";
    g("fm_incoming").innerHTML = incoming.map((r) => `
      <div class="srow" style="align-items:center;gap:6px;flex-wrap:wrap">
        ${personCell(profileName(r.from), r.from)}
        <button class="fm_accept btn grey" data-uid="${esc(r.from)}" style="flex:0 0 auto">接受</button>
        <button class="fm_decline" data-uid="${esc(r.from)}" style="flex:0 0 auto;background:none;border:0;color:#b25b6b;cursor:pointer">婉拒</button>
      </div>`).join("");
    g("fm_incoming").querySelectorAll(".fm_accept").forEach((b) => b.onclick = () =>
      run((r) => r.acceptFriendRequest(b.dataset.uid), () => {
        friendsState()[b.dataset.uid] = { friendUid: b.dataset.uid, nickname: "", pinned: false, state: "linked" };
        delete incomingState()[incomingKey(b.dataset.uid)];
      }));
    g("fm_incoming").querySelectorAll(".fm_decline").forEach((b) => b.onclick = () =>
      run((r) => r.declineFriendRequest(b.dataset.uid), () => {
        delete incomingState()[incomingKey(b.dataset.uid)];
      }));

    const linked = entries().filter((f) => f.state === "linked").sort((a, b) =>
      Number(b.pinned) - Number(a.pinned) || participantName(a.friendUid).localeCompare(participantName(b.friendUid)));
    g("fm_list").innerHTML = linked.length ? linked.map((f) => `
      <div class="srow" style="align-items:center;gap:6px;flex-wrap:wrap">
        ${personCell(profileName(f.friendUid), f.friendUid)}
        <input class="fm_nick" data-uid="${esc(f.friendUid)}" value="${esc(f.nickname)}" placeholder="綽號" style="flex:0 0 92px;padding:6px;border:1px solid var(--line);border-radius:6px">
        <label style="flex:0 0 auto;font-size:12px;color:var(--ink-soft)"><input type="checkbox" class="fm_pin" data-uid="${esc(f.friendUid)}" ${f.pinned ? "checked" : ""} style="vertical-align:middle"> 置頂</label>
        <button class="fm_del" data-uid="${esc(f.friendUid)}" style="flex:0 0 auto;background:none;border:0;color:#b25b6b;cursor:pointer">移除</button>
      </div>`).join("") : `<div class="admin">還沒有好友。</div>`;
    g("fm_list").querySelectorAll(".fm_nick").forEach((i) => i.onchange = () =>
      run((r) => r.setFriendNickname(i.dataset.uid, i.value), () => {
        if (friendsState()[i.dataset.uid]) friendsState()[i.dataset.uid].nickname = i.value.trim().slice(0, 60);
      }));
    g("fm_list").querySelectorAll(".fm_pin").forEach((b) => b.onchange = () =>
      run((r) => r.setFriendPinned(b.dataset.uid, b.checked), () => {
        if (friendsState()[b.dataset.uid]) friendsState()[b.dataset.uid].pinned = b.checked;
      }));
    g("fm_list").querySelectorAll(".fm_del").forEach((b) => b.onclick = () =>
      run((r) => r.removeFriend(b.dataset.uid), () => { delete friendsState()[b.dataset.uid]; }));

    const outgoing = entries().filter((f) => f.state === "pending_out");
    g("fm_outgoing_wrap").style.display = outgoing.length ? "block" : "none";
    g("fm_outgoing").innerHTML = outgoing.map((f) => `
      <div class="srow" style="align-items:center;gap:6px">
        ${personCell(profileName(f.friendUid), f.friendUid)}
        <button class="fm_cancel" data-uid="${esc(f.friendUid)}" style="flex:0 0 auto;background:none;border:0;color:#b25b6b;cursor:pointer">取消邀請</button>
      </div>`).join("");
    g("fm_outgoing").querySelectorAll(".fm_cancel").forEach((b) => b.onclick = () =>
      run((r) => r.discardOutgoingRequest(b.dataset.uid), () => { delete friendsState()[b.dataset.uid]; }));

    const suggestions = getSuggestions();
    g("fm_suggest_wrap").style.display = suggestions.length ? "block" : "none";
    g("fm_suggest").innerHTML = suggestions.map((id) => `
      <div class="srow" style="align-items:center;gap:6px">
        ${personCell(profileName(id), id)}
        <button class="fm_addsug btn grey" data-uid="${esc(id)}" style="flex:0 0 auto">送出邀請</button>
      </div>`).join("");
    g("fm_suggest").querySelectorAll(".fm_addsug").forEach((b) => b.onclick = () => addOrAccept(b.dataset.uid));
  }

  g("fm_add").onclick = () => addOrAccept(g("fm_uid").value);
  g("fm_uid").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); addOrAccept(g("fm_uid").value); } };
  g("fm_done").onclick = () => { onClose(); closeModal(); };
  render();

  // Give this user a shareable short code on first open.
  if (!getFriendCode() && isCurrent()) {
    ensureFriendCode().then((code) => {
      if (!isCurrent()) return;
      onFriendCodeReady(code);
      if (g("fm_mycode")) g("fm_mycode").textContent = formatFriendCode(code);
    }).catch((e) => { if (g("fm_err")) g("fm_err").textContent = "無法產生好友碼：" + (e?.message || e); });
  }

  return render;
}
