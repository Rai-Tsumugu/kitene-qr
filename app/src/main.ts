import QRCode from "qrcode";
import "./styles.css";
import { confirmAttemptFor } from "./client-state";
import { pollingDecision } from "./polling";

type InviteState = "open" | "requested" | "confirmed" | "declined" | "expired";
type Scope = "entrance" | "reception" | "first10" | "decline";

type InviteView = {
  id: string;
  eventTitle: string;
  eventStartsAt: string;
  meetingTime: string;
  meetingPlace: string;
  signal: string;
  state: InviteState;
  selectedScope: Scope | null;
  revision: number;
  expiresAt: string;
  updatedAt: string;
};

const app = document.querySelector<HTMLElement>("#app")!;

const scopeLabels: Record<Exclude<Scope, "decline">, string> = {
  entrance: "入口だけ一緒",
  reception: "受付まで一緒",
  first10: "最初の10分まで一緒",
};

let inviteUrlInMemory: string | null = null;
let pollTimer: number | null = null;
let pollCount = 0;
let participantIdempotencyKey: string | null = null;
let hostConfirmAttempt: { inviteId: string; revision: number; key: string } | null = null;

function shell(role: string, body: string, note = "ONE PERSON, ONE STEP") {
  return `
    <header class="topbar">
      <div><p class="eyebrow">${note}</p><h1>まちあわせQR</h1></div>
      <nav class="topnav">
        ${location.pathname === "/" ? "" : `<a href="/">ホーム</a>`}
        ${location.pathname === "/mine" ? "" : `<a href="/mine">約束一覧</a>`}
        <span class="role-badge">${escapeHtml(role)}</span>
      </nav>
    </header>
    <section class="page">${body}</section>`;
}

function eventCard(invite: InviteView) {
  return `<section class="event-card">
    <p class="kicker">一緒に参加しませんか？</p>
    <h2>${escapeHtml(invite.eventTitle)}</h2>
    <p>${formatDate(invite.eventStartsAt)}</p>
  </section>`;
}

function confirmedPass(invite: InviteView, role: "participant" | "host") {
  const scope = invite.selectedScope && invite.selectedScope !== "decline"
    ? scopeLabels[invite.selectedScope]
    : "入口だけ一緒";
  return `<p class="success-lead">✓ ${role === "participant" ? "一人で入らなくて大丈夫" : "待ち合わせを約束しました"}</p>
    <section class="pass">
      <div class="pass-head"><small>CONFIRMED PASS</small><h2>${escapeHtml(invite.eventTitle)}</h2></div>
      <dl>
        <div><dt>時刻</dt><dd>${escapeHtml(invite.meetingTime)}</dd></div>
        <div><dt>場所</dt><dd>${escapeHtml(invite.meetingPlace)}</dd></div>
        <div><dt>合図</dt><dd>${escapeHtml(invite.signal)}</dd></div>
        <div><dt>一緒に行く範囲</dt><dd>${escapeHtml(scope)}</dd></div>
      </dl>
      <p class="revision">両方の画面で同じ内容です · revision ${invite.revision}</p>
    </section>`;
}

type PromiseRecord = {
  inviteId: string;
  eventTitle: string;
  role: "host" | "participant";
  url: string;
  createdAt: string;
  meetingTime: string;
  meetingPlace: string;
  companionName: string;
  template?: { meetingTime: string; meetingPlace: string; signal: string };
};

function loadPromises(): PromiseRecord[] {
  try {
    const raw = localStorage.getItem("meetqr_promises");
    return raw ? (JSON.parse(raw) as PromiseRecord[]) : [];
  } catch {
    return [];
  }
}

function savePromise(record: PromiseRecord) {
  try {
    const list = loadPromises().filter(
      (item) => !(item.inviteId === record.inviteId && item.role === record.role),
    );
    list.unshift(record);
    localStorage.setItem("meetqr_promises", JSON.stringify(list.slice(0, 50)));
  } catch {
    // localStorageが使えない環境（プライベートブラウジング等）でも作成・参加自体は継続する
  }
}

function updateCompanionName(inviteId: string, role: PromiseRecord["role"], companionName: string) {
  try {
    const list = loadPromises();
    const target = list.find((item) => item.inviteId === inviteId && item.role === role);
    if (!target) return;
    target.companionName = companionName;
    localStorage.setItem("meetqr_promises", JSON.stringify(list));
  } catch {
    // localStorageが使えない環境では相手の名前の保存だけ諦める
  }
}

async function renderMine() {
  stopPolling();
  const promises = loadPromises();
  const items = promises.length
    ? `<div class="stack">${promises
        .map((item, index) => {
          const label = `${item.role === "host" ? "誘った：" : "参加を約束した："}${escapeHtml(item.eventTitle)}`;
          const templateButton = item.template
            ? `<button class="secondary" type="button" data-use-template="${index}">このイベントをテンプレートにする</button>`
            : "";
          return `<div class="promise-item">
            <a class="secondary link-button" href="${escapeHtml(item.url)}">${label}</a>
            <dl class="promise-meta">
              <div><dt>いつ</dt><dd>${escapeHtml(item.meetingTime || "未設定")}</dd></div>
              <div><dt>どこで</dt><dd>${escapeHtml(item.meetingPlace || "未設定")}</dd></div>
            </dl>
            <label class="companion-field">誰と（任意）
              <input type="text" maxlength="40" placeholder="相手の呼び名" value="${escapeHtml(item.companionName ?? "")}" data-companion-input="${index}" />
            </label>
            ${templateButton}
          </div>`;
        })
        .join("")}</div>`
    : `<p class="muted">この端末に保存された約束はまだありません。</p>`;
  app.innerHTML = shell(
    "約束一覧",
    `<section class="panel narrow">
      <p class="kicker">MY PROMISES</p>
      <h2>約束一覧</h2>
      <p class="muted">この一覧はこの端末のブラウザだけに保存されています。他の端末やサーバーには共有されません。</p>
      ${items}
    </section>`,
  );
  document.querySelectorAll<HTMLButtonElement>("[data-use-template]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = promises[Number(button.dataset.useTemplate)];
      if (!item?.template) return;
      try {
        sessionStorage.setItem(
          "meetqr_template",
          JSON.stringify({ eventTitle: item.eventTitle, ...item.template }),
        );
      } catch {
        // sessionStorageが使えない環境ではテンプレート引き継ぎだけ諦める
      }
      history.pushState({}, "", "/create");
      void route();
    });
  });
  document.querySelectorAll<HTMLInputElement>("[data-companion-input]").forEach((input) => {
    input.addEventListener("change", () => {
      const item = promises[Number(input.dataset.companionInput)];
      if (!item) return;
      updateCompanionName(item.inviteId, item.role, input.value);
    });
  });
}

async function renderCreate() {
  stopPolling();
  let template: { eventTitle: string; meetingTime: string; meetingPlace: string; signal: string } | null = null;
  try {
    const raw = sessionStorage.getItem("meetqr_template");
    if (raw) template = JSON.parse(raw);
  } catch {
    template = null;
  }
  app.innerHTML = shell("誘い手", `
    <section class="panel narrow">
      <p class="kicker">CREATE INVITE</p>
      <h2>自分のイベントを作る</h2>
      <p class="muted">${template ? "前回のイベントをテンプレートに使っています。日時だけ変えれば使い回せます。" : "入力した内容はNさん役への招待画面に表示されます。"}</p>
      <form id="create-invite" class="stack">
        <label>イベント名<input name="eventTitle" type="text" maxlength="80" required value="${escapeHtml(template?.eventTitle ?? "")}" /></label>
        <label>開催日時<input name="eventStartsAt" type="datetime-local" required /></label>
        <label>待ち合わせ時刻<input name="meetingTime" type="text" maxlength="40" placeholder="17:50" required value="${escapeHtml(template?.meetingTime ?? "")}" /></label>
        <label>待ち合わせ場所<input name="meetingPlace" type="text" maxlength="80" required value="${escapeHtml(template?.meetingPlace ?? "")}" /></label>
        <label>合図<input name="signal" type="text" maxlength="40" placeholder="青い丸 ●" required value="${escapeHtml(template?.signal ?? "")}" /></label>
        <button class="primary" type="submit">イベントを作る</button>
        <p class="form-status" role="status"></p>
      </form>
    </section>`);
  try {
    sessionStorage.removeItem("meetqr_template");
  } catch {
    // 読み取れた場合のみ消せればよい
  }
  document.querySelector<HTMLFormElement>("#create-invite")?.addEventListener("submit", createInvite);
}

async function createInvite(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>("button");
  const status = form.querySelector<HTMLElement>(".form-status");
  const data = new FormData(form);
  const eventTitle = String(data.get("eventTitle") ?? "");
  const meetingTime = String(data.get("meetingTime") ?? "");
  const meetingPlace = String(data.get("meetingPlace") ?? "");
  const signal = String(data.get("signal") ?? "");
  const eventStartsAtRaw = String(data.get("eventStartsAt") ?? "");
  if (button) button.disabled = true;
  if (status) status.textContent = "作成しています…";
  const response = await api("/api/invites", {
    method: "POST",
    body: {
      eventTitle,
      eventStartsAt: new Date(eventStartsAtRaw).toISOString(),
      meetingTime,
      meetingPlace,
      signal,
    },
    idempotencyKey: createIdempotencyKey(),
    allowError: true,
  });
  if (!response.ok) {
    if (button) button.disabled = false;
    if (status) status.textContent = errorMessage(response.status, response.data?.error);
    return;
  }
  savePromise({
    inviteId: String(response.data.inviteId),
    eventTitle,
    role: "host",
    url: String(response.data.manageUrl),
    createdAt: new Date().toISOString(),
    meetingTime,
    meetingPlace,
    companionName: "",
    template: { meetingTime, meetingPlace, signal },
  });
  inviteUrlInMemory = String(response.data.participantJoinUrl);
  history.replaceState({}, "", String(response.data.hostPath));
  await renderHost();
}

async function renderHost() {
  const response = await api("/api/host/demo", { allowError: true });
  if (!response.ok) {
    app.innerHTML = shell("誘い手", errorPanel(response.status, response.data?.error, "/create", "新しく作る"));
    return;
  }
  const invite = response.data.invite as InviteView;
  let body = eventCard(invite);

  if (invite.state === "open") {
    body += `<section class="panel centered">
      <h2>「一緒に参加しませんか？」</h2>
      <p class="muted">このQRをNさん役のスマホへ、その場で見せてください。</p>
      <div id="qr-slot" class="qr-slot">${inviteUrlInMemory ? "QRを生成中…" : "QRは再読込後に表示されません。約束一覧から管理linkを開いてください。"}</div>
      ${inviteUrlInMemory ? `<button id="copy-link" class="secondary" type="button">fallback URLをコピー</button>` : `<a class="secondary link-button" href="/mine">約束一覧へ戻る</a>`}
      <div class="waiting"><span class="pulse"></span><strong>回答を待っています</strong><small>2秒ごとに更新</small></div>
    </section>`;
  } else if (invite.state === "requested") {
    const label = invite.selectedScope && invite.selectedScope !== "decline"
      ? scopeLabels[invite.selectedScope]
      : "希望を確認";
    body += `<section class="request-card">
      <p class="kicker">Nさん側からの希望</p><h2>${escapeHtml(label)}</h2>
      <p>あなたがすること：${escapeHtml(invite.meetingTime)}に${escapeHtml(invite.meetingPlace)}で待つ</p>
      <button id="confirm-meet" class="primary" type="button">${escapeHtml(invite.meetingTime)}・${escapeHtml(invite.meetingPlace)}で待つ</button>
      <p class="form-status" role="status"></p>
    </section>`;
  } else if (invite.state === "confirmed") {
    body += confirmedPass(invite, "host");
  } else if (invite.state === "declined") {
    body += statusPanel("—", "今回は見送り", "理由の表示や再勧誘はありません。この回答で完了です。");
  } else {
    body += statusPanel("⌛", "この招待は終了しました", "新しい招待を発行してください。");
  }

  app.innerHTML = shell("誘い手", body);
  if (invite.state === "open" && inviteUrlInMemory) await drawQr(inviteUrlInMemory);
  document.querySelector<HTMLButtonElement>("#copy-link")?.addEventListener("click", copyInviteUrl);
  document.querySelector<HTMLButtonElement>("#confirm-meet")?.addEventListener("click", () => confirmMeet(invite));
  if (["open", "requested"].includes(invite.state)) schedulePoll(renderHost);
}

async function drawQr(url: string) {
  const slot = document.querySelector<HTMLElement>("#qr-slot");
  if (!slot) return;
  slot.textContent = "";
  const image = document.createElement("img");
  image.alt = "参加者用QRコード。有効中は撮影・保存しないでください";
  image.width = 224;
  image.height = 224;
  image.src = await QRCode.toDataURL(url, { width: 224, margin: 2, errorCorrectionLevel: "M" });
  slot.appendChild(image);
}

async function copyInviteUrl() {
  if (!inviteUrlInMemory) return;
  await navigator.clipboard.writeText(inviteUrlInMemory);
  const button = document.querySelector<HTMLButtonElement>("#copy-link");
  if (button) button.textContent = "コピーしました（取扱注意）";
}

async function confirmMeet(invite: InviteView) {
  const button = document.querySelector<HTMLButtonElement>("#confirm-meet");
  const status = document.querySelector<HTMLElement>(".form-status");
  if (button) button.disabled = true;
  hostConfirmAttempt = confirmAttemptFor(
    hostConfirmAttempt,
    invite.id,
    invite.revision,
    createIdempotencyKey,
  );
  const response = await api("/api/host/confirm", {
    method: "POST",
    body: { revision: invite.revision },
    idempotencyKey: hostConfirmAttempt.key,
    allowError: true,
  });
  if (!response.ok) {
    if (button) button.disabled = false;
    if (status) status.textContent = errorMessage(response.status, response.data?.error);
    return;
  }
  hostConfirmAttempt = null;
  await renderHost();
}

async function renderParticipant() {
  const response = await api("/api/participant/invite", { allowError: true });
  if (!response.ok) {
    app.innerHTML = shell("Nさん側", errorPanel(response.status, response.data?.error));
    return;
  }
  const invite = response.data.invite as InviteView;
  let body = eventCard(invite);
  if (invite.state === "open") {
    body += `<section class="choice-panel">
      <h2>どこまで一緒だと、行けそうですか？</h2>
      <p class="muted">一緒に行ってほしい範囲を選ぶと、誘い手が待ち合わせを確定します。名前や理由の入力は不要です。</p>
      <div class="choices">
        ${choiceButton("entrance", "🚪", "入口だけ一緒", "会場に入るまで")}
        ${choiceButton("reception", "🎫", "受付まで一緒", "手続きを終えるまで")}
        ${choiceButton("first10", "💬", "最初の10分まで一緒", "場に慣れるまで")}
        ${choiceButton("decline", "—", "今回は見送る", "理由は伝えません")}
      </div><p class="form-status" role="status"></p>
    </section>`;
  } else if (invite.state === "requested") {
    const scope = invite.selectedScope && invite.selectedScope !== "decline"
      ? scopeLabels[invite.selectedScope]
      : "希望";
    body += statusPanel("🕐", "誘った人の確定待ち", `「${scope}」を依頼しました。このまま待ってください。`);
  } else if (invite.state === "confirmed") {
    body += confirmedPass(invite, "participant");
  } else if (invite.state === "declined") {
    body += statusPanel("✓", "今回は見送ります", "理由は伝えません。このまま閉じて大丈夫です。");
  } else {
    body += statusPanel("⌛", "この招待は開けません", "誘った人に新しいQRを見せてもらってください。");
  }
  app.innerHTML = shell("Nさん側", body);
  document.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((button) => {
    button.addEventListener("click", () => respondToInvite(invite, button.dataset.choice as Scope));
  });
  if (invite.state === "requested") schedulePoll(renderParticipant);
}

function choiceButton(value: Scope, icon: string, title: string, detail: string) {
  return `<button class="choice" type="button" data-choice="${value}">
    <span class="choice-icon">${icon}</span><span><strong>${title}</strong><small>${detail}</small></span><b>›</b>
  </button>`;
}

async function respondToInvite(invite: InviteView, selection: Scope) {
  document.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((button) => (button.disabled = true));
  const status = document.querySelector<HTMLElement>(".form-status");
  if (status) status.textContent = "希望を伝えています…";
  participantIdempotencyKey ??= createIdempotencyKey();
  const response = await api("/api/participant/respond", {
    method: "POST",
    body: { selection, revision: invite.revision },
    idempotencyKey: participantIdempotencyKey,
    allowError: true,
  });
  if (!response.ok) {
    document.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((button) => (button.disabled = false));
    if (status) status.textContent = errorMessage(response.status, response.data?.error);
    return;
  }
  if (selection !== "decline") {
    savePromise({
      inviteId: invite.id,
      eventTitle: invite.eventTitle,
      role: "participant",
      url: location.pathname,
      createdAt: new Date().toISOString(),
      meetingTime: invite.meetingTime,
      meetingPlace: invite.meetingPlace,
      companionName: "",
    });
  }
  participantIdempotencyKey = null;
  await renderParticipant();
}

function statusPanel(icon: string, title: string, copy: string) {
  return `<section class="status-panel"><div class="status-icon">${icon}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></section>`;
}

function errorPanel(status: number, code?: string, returnPath?: string, returnLabel = "もう一度確認") {
  const title = status === 410 ? "この招待は終了しました" : status === 401 ? "この画面を開けません" : "通信できません";
  const copy = status === 410
    ? "誘った人に新しいQRを見せてもらってください。"
    : status === 401
      ? "必要なsessionがありません。"
      : "接続を確認して、もう一度お試しください。";
  const href = returnPath ?? location.pathname;
  return `<section class="status-panel error"><div class="status-icon">!</div><h2>${title}</h2><p>${copy}</p>
    <a class="secondary link-button" href="${escapeHtml(href)}">${escapeHtml(returnLabel)}</a>
    <small>status ${status}${code ? ` / ${escapeHtml(code)}` : ""}</small></section>`;
}

type ApiOptions = {
  method?: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  allowError?: boolean;
};

async function api(path: string, options: ApiOptions = {}) {
  try {
    const headers: Record<string, string> = {};
    if (options.body) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    const response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
    });
    const raw = (await response.json().catch(() => ({}))) as Record<string, any>;
    const data = response.ok
      ? (raw.data ?? {})
      : { error: raw.error?.code ?? "UNKNOWN_ERROR", message: raw.error?.message };
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "offline" } };
  }
}

function schedulePoll(callback: () => Promise<void>) {
  stopPolling();
  const configuredLimit = Number(import.meta.env.VITE_POLL_LIMIT);
  const pollLimit = Number.isInteger(configuredLimit) && configuredLimit >= 0
    ? configuredLimit
    : undefined;
  const decision = pollingDecision(pollCount, document.hidden, pollLimit);
  if (decision === "hidden") return;
  if (decision === "paused") {
    showPollingPaused(callback);
    return;
  }
  pollTimer = window.setTimeout(async () => {
    pollCount += 1;
    await callback();
  }, 2_000);
}

function showPollingPaused(callback: () => Promise<void>) {
  if (document.querySelector("[data-polling-paused]")) return;
  const container = document.querySelector<HTMLElement>(".page");
  if (!container) return;
  const notice = document.createElement("section");
  notice.className = "polling-paused";
  notice.dataset.pollingPaused = "true";
  notice.innerHTML = `<strong>自動更新を停止しました</strong>
    <span>5分経過したため通信を休止しています。</span>
    <button class="secondary" type="button">今すぐ更新して再開</button>`;
  container.appendChild(notice);
  notice.querySelector<HTMLButtonElement>("button")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    pollCount = 0;
    await callback();
  });
}

function stopPolling() {
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else route();
});

function createIdempotencyKey() {
  return `${crypto.randomUUID().replaceAll("-", "")}_${Date.now().toString(36)}`;
}

function errorMessage(status: number, code?: string) {
  if (status === 409) return "別の操作が先に反映されました。画面を更新してください。";
  if (status === 410) return "招待の期限が切れました。";
  if (status === 429) return "操作が多すぎます。少し待ってください。";
  if (status === 401) return "secretまたはsessionを確認してください。";
  return code === "offline" ? "通信できません。接続後にもう一度お試しください。" : "処理できませんでした。";
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(value));
  } catch {
    return "日時は招待画面で確認";
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

async function route() {
  stopPolling();
  pollCount = 0;
  if (location.pathname === "/create") return renderCreate();
  if (location.pathname === "/mine") return renderMine();
  if (location.pathname.startsWith("/host/")) return renderHost();
  if (location.pathname.startsWith("/invite/")) return renderParticipant();
  app.innerHTML = shell("ホーム", `<section class="panel narrow centered"><p class="kicker">ONE PERSON, ONE STEP</p><h2>一人で入る、を<br>待ち合わせに変える。</h2><p class="muted">自分でイベントを作り、QRを見せて相手を誘います。</p><div class="stack"><a class="primary link-button" href="/create">自分のイベントを作る</a><a class="secondary link-button" href="/mine">約束一覧</a></div></section>`);
}

void route();
