const participantScreen = document.querySelector("#participant-screen");
const hostScreen = document.querySelector("#host-screen");
const scenarioSelect = document.querySelector("#scenario-select");
const resetButton = document.querySelector("#reset-button");

const event = {
  name: "はじめての交流会",
  date: "9月12日（土）18:00開始",
  time: "17:50",
  place: "正面入口",
  sign: "青いノート",
  revision: 2,
};

const scopeLabels = {
  entrance: "入口だけ一緒",
  reception: "受付まで一緒",
  first10: "最初の10分まで一緒",
};

let state = { phase: "open", scope: null };
let pendingTimer;

const appHead = (role) => `
  <div class="app-head">
    <span class="app-name">まちあわせQR</span>
    <span class="role-badge">${role}</span>
  </div>`;

const eventCard = () => `
  <section class="event-card">
    <p class="kicker">お誘いが届いています</p>
    <h2>${event.name}</h2>
    <p>${event.date}</p>
  </section>`;

const statusPanel = (icon, title, copy, warning = false) => `
  <section class="status-panel">
    <div>
      <div class="status-icon${warning ? " warning" : ""}">${icon}</div>
      <h2>${title}</h2>
      <p>${copy}</p>
    </div>
  </section>`;

const pass = (role) => `
  <p class="celebrate">✓ ${role === "Nさん" ? "一人で入らなくて大丈夫" : "待ち合わせを約束しました"}</p>
  <section class="pass" aria-label="確定した待ち合わせパス">
    <div class="pass-head"><p>CONFIRMED PASS</p><h2>${event.name}</h2></div>
    <div class="pass-body">
      <div class="pass-row"><span>🕐</span><div><small>時刻</small><strong>${event.time}</strong></div></div>
      <div class="pass-row"><span>📍</span><div><small>場所</small><strong>${event.place}</strong></div></div>
      <div class="pass-row"><span>📘</span><div><small>合図</small><strong>${event.sign}</strong></div></div>
      <div class="pass-row"><span>🤝</span><div><small>一緒に行く範囲</small><strong>${scopeLabels[state.scope]}</strong></div></div>
    </div>
    <div class="pass-foot">両方の画面で同じ内容です ・ revision ${event.revision}</div>
  </section>`;

function renderNormal() {
  if (state.phase === "open") {
    participantScreen.innerHTML = `
      ${appHead("Nさん側")}${eventCard()}
      <h2 class="lead">どこまで一緒だと、行けそうですか？</h2>
      <p class="sublead">名前や理由の入力はいりません。選ぶと、誘った人が待ち合わせを確定します。</p>
      <div class="scope-list">
        ${scopeButton("entrance", "🚪", "入口だけ一緒", "会場に入るまで")}
        ${scopeButton("reception", "🎫", "受付まで一緒", "手続きを終えるまで")}
        ${scopeButton("first10", "💬", "最初の10分まで一緒", "場に慣れるまで")}
      </div>
      <button class="decline-button" type="button" data-decline>今回は見送る（理由は不要）</button>`;

    hostScreen.innerHTML = `
      ${appHead("誘い手側")}${eventCard()}
      <div class="qr-placeholder" aria-label="読み取れないQRプレースホルダー"><span>QR PLACEHOLDER<br>NOT SCANNABLE</span></div>
      <p class="safe-caption">実トークンを含まない表示用ダミー</p>
      ${statusPanel("…", "回答を待っています", "「一緒に参加しませんか？」とこの画面を見せてください。")}`;
  }

  if (state.phase === "requesting") {
    participantScreen.innerHTML = `${appHead("Nさん側")}${statusPanel("✓", "希望を伝えました", `「${scopeLabels[state.scope]}」で待ち合わせを確認してもらっています。`)}`;
    hostScreen.innerHTML = `${appHead("誘い手側")}${statusPanel("…", "回答を受信中", "まもなく表示します。")}`;
  }

  if (state.phase === "requested") {
    participantScreen.innerHTML = `${appHead("Nさん側")}${statusPanel("🕐", "誘った人の確定待ち", `「${scopeLabels[state.scope]}」を依頼しました。このまま待ってください。`)}`;
    hostScreen.innerHTML = `
      ${appHead("誘い手側")}${eventCard()}
      <section class="request-card">
        <p class="kicker">Nさん側からの希望</p>
        <h3>${scopeLabels[state.scope]}</h3>
        <p>あなたがすること：${event.time}に${event.place}で待つ</p>
        <button class="primary-button" type="button" data-confirm>${event.time}・${event.place}で待つ</button>
      </section>`;
  }

  if (state.phase === "confirming") {
    participantScreen.innerHTML = `${appHead("Nさん側")}${statusPanel("🕐", "最終確認中", "待ち合わせの約束を同期しています。")}`;
    hostScreen.innerHTML = `${appHead("誘い手側")}${statusPanel("✓", "約束を確定中", "Nさん側と同じ内容を表示します。")}`;
  }

  if (state.phase === "confirmed") {
    participantScreen.innerHTML = `${appHead("Nさん側")}${pass("Nさん")}`;
    hostScreen.innerHTML = `${appHead("誘い手側")}${pass("誘い手")}`;
  }

  if (state.phase === "declined") {
    participantScreen.innerHTML = `${appHead("Nさん側")}${statusPanel("✓", "今回は見送ります", "理由は伝えません。このまま閉じて大丈夫です。")}`;
    hostScreen.innerHTML = `${appHead("誘い手側")}${statusPanel("—", "今回は見送り", "回答はこれで完了です。理由の表示や再勧誘はありません。")}`;
  }

  bindFlowActions();
}

function scopeButton(value, icon, title, detail) {
  return `<button class="scope-button" type="button" data-scope="${value}">
    <span class="scope-icon">${icon}</span>
    <span class="scope-copy"><strong>${title}</strong><small>${detail}</small></span>
    <span class="scope-arrow">›</span>
  </button>`;
}

function bindFlowActions() {
  document.querySelectorAll("[data-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      state = { phase: "requesting", scope: button.dataset.scope };
      renderNormal();
      pendingTimer = window.setTimeout(() => {
        state.phase = "requested";
        renderNormal();
        activatePhone("host");
      }, 650);
    });
  });

  document.querySelector("[data-decline]")?.addEventListener("click", () => {
    state.phase = "declined";
    renderNormal();
  });

  document.querySelector("[data-confirm]")?.addEventListener("click", () => {
    state.phase = "confirming";
    renderNormal();
    pendingTimer = window.setTimeout(() => {
      state.phase = "confirmed";
      renderNormal();
      activatePhone("participant");
    }, 650);
  });
}

function renderScenario(name) {
  window.clearTimeout(pendingTimer);
  if (name === "normal") {
    state = { phase: "open", scope: null };
    renderNormal();
    return;
  }

  const scenarios = {
    loading: ["", "読み込んでいます", "招待の有効性を確認しています。"],
    empty: ["…", "まだ回答はありません", "招待相手が選ぶとここに表示されます。"],
    invalid: ["!", "この招待は開けません", "URLが無効です。誘った人に新しいQRを見せてもらってください。"],
    expired: ["⌛", "この招待は期限切れです", "内容の確認や回答はできません。詳細情報は表示しません。"],
    offline: ["↻", "通信できません", "オフラインか通信が不安定です。接続後に再読み込みしてください。"],
  };

  const [icon, title, copy] = scenarios[name];
  const content = name === "loading"
    ? `<section class="status-panel"><div><div class="spinner"></div><h2>${title}</h2><p>${copy}</p></div></section>`
    : statusPanel(icon, title, copy, ["invalid", "expired", "offline"].includes(name));
  participantScreen.innerHTML = `${appHead("Nさん側")}${content}`;
  hostScreen.innerHTML = `${appHead("誘い手側")}${name === "empty" ? content.replace("招待相手", "Nさん側") : content}`;
}

function activatePhone(role) {
  document.querySelectorAll("[data-phone]").forEach((phone) => {
    phone.classList.toggle("is-mobile-active", phone.dataset.phone === role);
  });
  document.querySelectorAll("[data-role]").forEach((tab) => {
    const active = tab.dataset.role === role;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-pressed", String(active));
  });
}

scenarioSelect.addEventListener("change", () => renderScenario(scenarioSelect.value));
resetButton.addEventListener("click", () => {
  scenarioSelect.value = "normal";
  state = { phase: "open", scope: null };
  activatePhone("participant");
  renderNormal();
});

document.querySelectorAll("[data-role]").forEach((tab) => {
  tab.addEventListener("click", () => activatePhone(tab.dataset.role));
});

document.querySelector("#feedback-form").addEventListener("submit", (eventObject) => {
  eventObject.preventDefault();
  const input = document.querySelector("#feedback-input");
  const status = document.querySelector("#feedback-status");
  if (!input.value.trim()) {
    status.textContent = "メモを入力してください";
    input.focus();
    return;
  }
  status.textContent = "画面上にメモしました（未送信）";
  input.value = "";
});

renderNormal();
