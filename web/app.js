import { initializeWallet, ownerAction } from "../agent/browser/wallet.ts";
import { paymentLabel } from "./presentation.js";

const $ = (sel) => document.querySelector(sel);
const history = [];
let status = null;
let busy = false;
let chatAvailable = false;
let configured = false;
let providers = [];

function updateControls() {
  $("#ai-provider").disabled = busy || !configured;
  $("#send").disabled = busy || !chatAvailable;
  $("#chat-input").disabled = busy || !chatAvailable;
  document.querySelectorAll("[data-prompt]").forEach((b) => { b.disabled = busy || !chatAvailable; });
  document.querySelectorAll("[data-attack]").forEach((b) => { b.disabled = busy || !configured; });
}

const fmt = (sui) => `${Number(sui).toLocaleString("ko-KR", { maximumFractionDigits: 4 })} SUI`;
const short = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "");

async function api(path, body) {
  const res = await fetch(path, body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(href, text) {
  const a = el("a", "", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer";
  return a;
}

function paymentLinks(p) {
  const links = el("div", "links");
  if (p.txUrl) links.append(link(p.txUrl, "Sui 트랜잭션 ↗"));
  if (p.logUrl) links.append(link(p.logUrl, "Walrus 판단 기록 ↗"));
  return links;
}

function addMessage(role, text, providerLabel) {
  const node = el("div", `msg ${role}`);
  if (providerLabel) node.append(el("span", "provider-label", providerLabel));
  node.append(document.createTextNode(text));
  $("#messages").append(node);
  node.scrollIntoView({ block: "end", behavior: "smooth" });
  return node;
}

function addPaymentCard(p) {
  const card = el("div", `pay-card ${p.status}`);
  const who = p.recipientName ?? short(p.recipient);
  const title = `${paymentLabel(p.status)} · ${who} · ${fmt(p.amountSui)}`;
  card.append(el("div", "title", title));
  if (p.reason) card.append(el("div", "", p.reason));
  if (p.recordingError) card.append(el("div", "notice", p.recordingError));
  if (p.logEndEpoch !== undefined) card.append(el("div", "muted small", `판단 기록 보관 종료: epoch ${p.logEndEpoch}`));
  card.append(paymentLinks(p));
  $("#messages").append(card);
  card.scrollIntoView({ block: "end", behavior: "smooth" });
}

function renderStatus(s) {
  status = s;
  const link = $("#allowance-link");
  link.textContent = `Allowance ${short(s.allowanceId)} ↗`;
  link.href = s.allowanceUrl;

  $("#balance").textContent = fmt(s.balanceSui);
  $("#per-tx").textContent = fmt(s.perTxLimitSui);
  $("#daily").textContent = fmt(s.dailyLimitSui);
  const pct = s.dailyLimitSui > 0 ? Math.min(100, (s.spentInWindowSui / s.dailyLimitSui) * 100) : 0;
  $("#meter-fill").style.width = `${pct}%`;
  $("#meter-text").textContent = `이번 주기 사용액 ${fmt(s.spentInWindowSui)} / 남은 한도 ${fmt(s.remainingInWindowSui)}`;
  $("#window-reset").textContent = s.windowExpired
    ? "이전 주기가 끝났습니다. 다음 결제 시도부터 새 24시간 주기가 시작됩니다."
    : `주기 종료: ${new Date(s.windowResetsAt).toLocaleString("ko-KR")} · 직전 24시간 누적과 다릅니다.`;

  const badge = $("#paused-badge");
  badge.textContent = s.paused ? "정지됨" : "활성";
  badge.className = `badge ${s.paused ? "bad" : "ok"}`;
  $("#pause-btn").textContent = s.paused ? "▶ 에이전트 결제 재개" : "⏸ 에이전트 결제 정지";

  const list = $("#merchants");
  list.replaceChildren(...s.merchants.map((m) =>
    el("li", m.allowed ? "allowed" : "denied", `${m.allowed ? "✓" : "✕"} ${m.name}`)));

  if (document.activeElement?.tagName !== "INPUT") {
    $("#limit-per-tx").value = s.perTxLimitSui;
    $("#limit-daily").value = s.dailyLimitSui;
  }
}

function renderActivity(items) {
  const list = $("#activity");
  if (items.length === 0) {
    list.replaceChildren(el("li", "muted", "아직 결제 시도가 없습니다."));
    return;
  }
  list.replaceChildren(...items.map((a) => {
    const li = el("li", a.status);
    const who = a.recipientName ?? short(a.recipient);
    const source = a.source === "attack-sim" ? " · 🔓 탈취 시뮬레이션" : "";
    const head = el("div", "head");
    head.append(el("span", "", `${paymentLabel(a.status)} · ${who} · ${a.memo}`), el("span", "", fmt(a.amountSui)));
    li.append(head);
    const detail = `${new Date(a.timestamp).toLocaleTimeString("ko-KR")}${source}${a.reason ? ` · ${a.reason}` : ""}`;
    li.append(el("div", "muted small", detail), paymentLinks(a));
    return li;
  }));
}

async function refresh() {
  const [s, activity] = await Promise.allSettled([api("/api/status"), api("/api/activity")]);
  const issues = [];
  if (s.status === "fulfilled") renderStatus(s.value);
  else { status = null; $("#paused-badge").textContent = "상태 미확인"; issues.push("온체인 정책을 조회하지 못했습니다. 표시된 금액은 최신 상태가 아닐 수 있습니다."); }
  if (activity.status === "fulfilled") renderActivity(activity.value);
  else issues.push("결제 기록을 조회하지 못했습니다.");
  $("#status-error").hidden = issues.length === 0;
  $("#status-error").textContent = issues.join(" ");
}

async function send(text) {
  if (busy || !chatAvailable) return;
  const provider = providers.find((p) => p.id === $("#ai-provider").value);
  if (!provider?.available) return;
  busy = true;
  updateControls();
  const input = $("#chat-input");
  const button = $("#send");
  addMessage("user", text);
  input.value = "";
  button.disabled = true;
  const pending = addMessage("assistant thinking", "요청을 처리하는 중…", provider.label);
  try {
    const result = await api("/api/chat", { requestId: crypto.randomUUID(), provider: provider.id, message: text, history: history.slice(-30) });
    pending.remove();
    if (result.toolCalls.length > 0) {
      $("#messages").append(el("div", "tools", `🔧 ${result.toolCalls.map((t) => t.name).join(" → ")}`));
    }
    result.payments.forEach(addPaymentCard);
    addMessage("assistant", result.reply || "(응답 없음)", provider.label);
    // The server rejects history entries over 8000 characters.
    history.push({ role: "user", content: text }, { role: "assistant", content: result.reply.slice(0, 8000) });
  } catch (err) {
    pending.remove();
    addMessage("assistant", `요청 결과를 받지 못했습니다: ${err.message} 결제 기록을 확인한 뒤 다시 요청하세요.`, provider.label);
  } finally {
    busy = false;
    updateControls();
    refresh();
  }
}

async function runAction(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
    refresh();
  }
}

$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#chat-input").value.trim();
  if (text) send(text);
});

document.querySelectorAll("[data-prompt]").forEach((b) =>
  b.addEventListener("click", () => send(b.dataset.prompt)));

document.querySelectorAll("[data-attack]").forEach((b) =>
  b.addEventListener("click", () => runAction(b, async () => {
    if (busy || !configured) return;
    busy = true; updateControls();
    try {
      const result = await api(`/api/attack/${b.dataset.attack}`, { requestId: crypto.randomUUID() });
      addPaymentCard(result);
    } finally { busy = false; updateControls(); }
  })));

$("#pause-btn").addEventListener("click", (e) =>
  runAction(e.currentTarget, async () => {
    if (!status) throw new Error("현재 정책 상태를 확인한 뒤 변경하세요.");
    await ownerAction({ kind: "pause", paused: !status.paused });
  }));

$("#limits-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runAction(e.submitter, () => ownerAction({
    kind: "limits",
    perTxSui: $("#limit-per-tx").value,
    dailySui: $("#limit-daily").value,
  }));
});

function selectProvider() {
  const provider = providers.find((p) => p.id === $("#ai-provider").value);
  chatAvailable = Boolean(provider?.available);
  $("#model-info").textContent = provider ? `모델: ${provider.model} · 선택을 바꿔도 대화는 유지됩니다.` : "";
  $("#chat-notice").hidden = chatAvailable;
  $("#chat-notice").textContent = provider
    ? `${provider.label} API 키가 설정되지 않았습니다. 해당 API를 설정하거나 사용 가능한 다른 AI를 선택하세요.`
    : "사용할 AI를 선택하세요.";
  updateControls();
}
$("#ai-provider").addEventListener("change", () => {
  if (busy) return;
  try { localStorage.setItem("agent-allowance-provider", $("#ai-provider").value); } catch { /* Storage is optional. */ }
  selectProvider();
});

// ?present=1 enlarges text and highlights payment results for projectors and screen recordings.
if (new URLSearchParams(location.search).has("present")) document.body.classList.add("present");

updateControls();
api("/api/config").then((config) => {
  configured = true;
  providers = config.providers;
  const select = $("#ai-provider");
  select.replaceChildren(...providers.map((provider) => {
    const option = el("option", "", `${provider.label}${provider.available ? "" : " · 키 미설정"}`);
    option.value = provider.id;
    return option;
  }));
  let saved;
  try { saved = localStorage.getItem("agent-allowance-provider"); } catch { /* Storage is optional. */ }
  select.value = providers.some((p) => p.id === saved) ? saved : config.defaultProvider;
  selectProvider();
  void initializeWallet(config);
}).catch(() => {
  $("#chat-notice").hidden = false;
  $("#chat-notice").textContent = "앱 설정을 불러오지 못했습니다. 서버 설정을 확인하세요.";
});
refresh();
setInterval(refresh, 5000);
