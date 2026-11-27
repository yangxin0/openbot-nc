const state = { csrf: "", teams: [] };

function byId(id) {
  return document.getElementById(id);
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, body) {
  const init =
    body === undefined
      ? { credentials: "same-origin" }
      : {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-OpenBot-CSRF": state.csrf },
          body: JSON.stringify(body),
        };
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.message === "string" ? data.message : `The server answered ${response.status}.`;
    throw new ApiError(message, response.status);
  }
  return data;
}

function notice(message, tone = "info") {
  const element = byId("notice");
  byId("notice-text").textContent = message;
  element.dataset.tone = tone;
  element.hidden = message === "";
}

const THEME_KEY = "openbot.admin.theme";

function currentTheme() {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "system";
}

function showTheme() {
  const theme = currentTheme();
  for (const control of document.querySelectorAll("[data-theme-choice]")) {
    control.setAttribute("aria-pressed", String(control.dataset.themeChoice === theme));
  }
}

function chooseTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  showTheme();
  try {
    if (theme === "light" || theme === "dark") localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    notice("This browser cannot keep the theme. It applies to this page until you close it.", "error");
  }
}

const STATUS_TONES = { valid: "success", revoked: "danger", expired: "warning" };
const STATUS_LABELS = { valid: "Valid", revoked: "Revoked", expired: "Expired" };

function time(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function short(text) {
  return typeof text === "string" ? text.slice(0, 12) : "-";
}

function cell(row, text, className) {
  const element = document.createElement("td");
  element.textContent = text === null || text === undefined || text === "" ? "-" : String(text);
  if (className) element.className = className;
  row.append(element);
  return element;
}

function actionCell(row, ...controls) {
  const element = document.createElement("td");
  const holder = document.createElement("div");
  holder.className = "actions";
  holder.replaceChildren(...controls);
  element.append(holder);
  row.append(element);
  return holder;
}

function button(text, className, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.className = className ? `button ${className}` : "button";
  element.addEventListener("click", onClick);
  return element;
}

function pill(text, tone, dot) {
  const element = document.createElement("span");
  element.className = "pill";
  element.dataset.tone = tone;
  if (dot) {
    const mark = document.createElement("span");
    mark.className = "pill-dot";
    mark.setAttribute("aria-hidden", "true");
    element.append(mark);
  }
  element.append(text);
  return element;
}

function pillCell(row, className, ...pills) {
  const element = document.createElement("td");
  if (className) element.className = className;
  const holder = document.createElement("div");
  holder.className = "pills";
  holder.replaceChildren(...pills);
  element.append(holder);
  row.append(element);
  return element;
}

function statusPill(status) {
  return pill(STATUS_LABELS[status] ?? status, STATUS_TONES[status] ?? "muted", false);
}

function stackCell(row, main, sub, subClassName) {
  const element = document.createElement("td");
  const first = document.createElement("div");
  first.className = "cell-main";
  first.textContent = main === null || main === undefined || main === "" ? "-" : String(main);
  element.append(first);
  if (sub) {
    const second = document.createElement("div");
    second.className = subClassName ? `cell-sub ${subClassName}` : "cell-sub";
    second.textContent = sub;
    element.append(second);
  }
  row.append(element);
  return element;
}

function emptyRow(body, columns, text) {
  const row = document.createElement("tr");
  const element = cell(row, text, "empty");
  element.colSpan = columns;
  body.replaceChildren(row);
}

function showSignedOut(message, tone = "info") {
  state.csrf = "";
  notice("");
  byId("signed-in").hidden = true;
  byId("signed-out").hidden = false;
  const element = byId("signed-out-notice");
  element.textContent = message ?? "";
  element.dataset.tone = tone;
  element.hidden = !message;
}

function showSignedIn() {
  byId("signed-out").hidden = true;
  byId("signed-in").hidden = false;
}

function renderStats(overview) {
  const stats = [
    ["Members online", overview.membersOnline, overview.membersOnline > 0],
    ["Teams", overview.teams ?? "-", false],
    ["Open join codes", overview.openCodes ?? "-", false],
  ];
  byId("stats").replaceChildren(
    ...stats.map(([label, value, live]) => {
      const tile = document.createElement("div");
      tile.className = "stat";
      const name = document.createElement("span");
      name.className = "stat-label";
      name.textContent = label;
      const number = document.createElement("span");
      number.className = "stat-value";
      number.textContent = String(value);
      if (live) {
        const mark = document.createElement("span");
        mark.className = "stat-live";
        mark.setAttribute("aria-hidden", "true");
        number.append(mark);
      }
      tile.append(name, number);
      return tile;
    }),
  );
}

function renderOverview(overview) {
  renderStats(overview);
  const identity = overview.serverIdentity;
  const facts = [
    { term: "Relay address", value: overview.relayUrl ?? "Not set", mono: overview.relayUrl !== null },
    {
      term: "Join codes",
      value: overview.joinServer ? `https://${overview.joinServer}/v1/enroll` : "Off (no wss: address)",
      mono: Boolean(overview.joinServer),
    },
    { term: "Root fingerprint (SHA-256)", value: overview.rootFingerprint, mono: true },
    { term: "Root in join codes", value: overview.joinRootFingerprint, mono: true },
    { term: "Root expires", value: time(overview.rootExpiresAt) },
    {
      term: "Server identity",
      value: identity.problem ? identity.problem : `${identity.names || "-"}, expires ${time(identity.expiresAt)}`,
      warning: Boolean(identity.problem),
    },
    {
      term: "TLS certificate expires",
      value: overview.tlsExpiresAt === null ? "No TLS in this process" : time(overview.tlsExpiresAt),
    },
  ];
  byId("overview").replaceChildren(
    ...facts.map((fact) => {
      const group = document.createElement("div");
      group.className = "fact";
      const dt = document.createElement("dt");
      dt.textContent = fact.term;
      const dd = document.createElement("dd");
      dd.textContent = String(fact.value ?? "-");
      if (fact.mono) dd.className = "mono";
      if (fact.warning) dd.dataset.tone = "warning";
      group.append(dt, dd);
      return group;
    }),
  );
}

function fillTeamSelect(select, teams) {
  const previous = select.value;
  select.replaceChildren(
    ...teams.map((team) => {
      const option = document.createElement("option");
      option.value = team.name;
      option.textContent = team.name;
      return option;
    }),
  );
  if (teams.some((team) => team.name === previous)) select.value = previous;
}

function renderTeams(teams) {
  state.teams = teams;
  const body = byId("team-rows");
  if (teams.length === 0) emptyRow(body, 5, "No team yet. Add one below.");
  else
    body.replaceChildren(
      ...teams.map((team) => {
        const row = document.createElement("tr");
        stackCell(row, team.name);
        pillCell(row, `status-${team.status}`, statusPill(team.status));
        cell(row, time(team.expiresAt));
        cell(row, team.members, "number");
        cell(row, team.membersOnline, "number");
        return row;
      }),
    );
  const valid = teams.filter((team) => team.status === "valid");
  fillTeamSelect(document.querySelector("#code-form select[name=team]"), valid);
  fillTeamSelect(byId("member-team"), teams);
}

function renderCodes(codes) {
  const body = byId("code-rows");
  if (codes.length === 0) {
    emptyRow(body, 5, "No open join code.");
    return;
  }
  body.replaceChildren(
    ...codes.map((code) => {
      const row = document.createElement("tr");
      cell(row, code.id, "mono");
      stackCell(row, code.user, [code.device, code.team].filter(Boolean).join(" · "));
      cell(row, time(code.expiresAt));
      cell(row, code.creator);
      actionCell(
        row,
        button("Cancel", "danger", async (event) => {
          event.currentTarget.disabled = true;
          await run(async () => {
            await api("/admin/api/codes/cancel", { id: code.id });
            await Promise.all([loadCodes(), loadOverview()]);
          });
        }),
      );
      return row;
    }),
  );
}

function revokeControls(holder, member) {
  const ask = button("Revoke", "danger", () => {
    holder.replaceChildren(
      button("Confirm revoke", "danger confirm", async (event) => {
        event.currentTarget.disabled = true;
        await run(async () => {
          await api("/admin/api/revoke", { keyId: member.keyId });
          notice(`The certificate of ${member.user} is revoked. Its connections are closed.`, "success");
          await Promise.all([loadMembers(), loadTeams(), loadOverview()]);
        });
      }),
      button("Keep", "quiet", () => holder.replaceChildren(ask)),
    );
  });
  holder.replaceChildren(ask);
}

function renderMembers(members) {
  const body = byId("member-rows");
  if (members.length === 0) {
    emptyRow(body, 6, "No member in this team.");
    return;
  }
  body.replaceChildren(
    ...members.map((member) => {
      const row = document.createElement("tr");
      stackCell(row, member.user, [member.device, member.label].filter(Boolean).join(" · "));
      const key = stackCell(row, short(member.keyId), `Serial ${short(member.serial)}`, "mono");
      key.firstChild.classList.add("mono");
      key.title = `Key ${member.keyId}\nSerial ${member.serial}`;
      cell(row, time(member.expiresAt));
      pillCell(row, `status-${member.status}`, statusPill(member.status));
      const connection = member.online ? [pill("Online", "success", true)] : [pill("Offline", "muted", false)];
      if (member.online && member.hosting) connection.push(pill("Hosting", "accent", false));
      pillCell(row, member.online ? "online" : "offline", ...connection);
      const actions = actionCell(row);
      if (member.status !== "revoked") revokeControls(actions, member);
      return row;
    }),
  );
}

async function loadOverview() {
  renderOverview(await api("/admin/api/overview"));
}

async function loadTeams() {
  renderTeams((await api("/admin/api/teams")).teams);
}

async function loadCodes() {
  renderCodes((await api("/admin/api/codes")).codes);
}

async function loadMembers() {
  const team = byId("member-team").value;
  if (!team) {
    emptyRow(byId("member-rows"), 6, "No team yet.");
    return;
  }
  renderMembers((await api(`/admin/api/members?team=${encodeURIComponent(team)}`)).members);
}

async function refresh() {
  await Promise.all([loadOverview(), loadTeams(), loadCodes()]);
  await loadMembers();
}

async function run(operation) {
  try {
    notice("");
    await operation();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) showSignedOut("The session ended. Sign in again.");
    else notice(error instanceof Error ? error.message : "The action failed.", "error");
  }
}

function formValue(form, name) {
  const value = form.elements.namedItem(name).value.trim();
  return value === "" ? null : value;
}

function showCode(code) {
  byId("code-qr").src = code.qr;
  byId("code-url").value = code.url;
  const subject = [code.team, code.user, code.device].filter(Boolean).join(" / ");
  byId("code-summary").textContent =
    `Join code ${code.id} for ${subject}. It works once, until ${time(code.expiresAt)}. Give it only to this person.`;
  byId("code-copy-state").textContent = "";
  byId("code-result").hidden = false;
}

async function copyCode() {
  const field = byId("code-url");
  const status = byId("code-copy-state");
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(field.value);
    else {
      field.focus();
      field.select();
      if (!document.execCommand("copy")) throw new Error("copy");
    }
    status.textContent = "Copied.";
  } catch {
    field.focus();
    field.select();
    status.textContent = "Press Ctrl+C or Command+C to copy the selected text.";
  }
}

function bindForms() {
  byId("code-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run(async () => {
      const code = await api("/admin/api/codes", {
        team: formValue(form, "team"),
        user: formValue(form, "user"),
        device: formValue(form, "device"),
        minutes: Number(formValue(form, "minutes")),
        days: Number(formValue(form, "days")),
      });
      showCode(code);
      await Promise.all([loadCodes(), loadOverview()]);
    });
  });
  byId("team-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run(async () => {
      await api("/admin/api/teams", { team: formValue(form, "team"), days: Number(formValue(form, "days")) });
      form.reset();
      await Promise.all([loadTeams(), loadOverview()]);
      await loadMembers();
    });
  });
  byId("member-form").addEventListener("submit", (event) => event.preventDefault());
  byId("member-team").addEventListener("change", () => void run(loadMembers));
  byId("code-copy").addEventListener("click", () => void copyCode());
  byId("notice-close").addEventListener("click", () => notice(""));
  for (const control of document.querySelectorAll("[data-theme-choice]")) {
    control.addEventListener("click", () => chooseTheme(control.dataset.themeChoice));
  }
  byId("refresh").addEventListener("click", () => void run(refresh));
  byId("sign-out").addEventListener("click", () =>
    run(async () => {
      await api("/admin/api/logout", {});
      showSignedOut("You are signed out.");
    }),
  );
}

async function signIn() {
  const token = location.hash.slice(1);
  history.replaceState(null, "", "/admin/login");
  byId("signed-out-notice").hidden = true;
  if (token === "") {
    showSignedOut("The sign-in link has no token. Run admin login again.", "error");
    return;
  }
  try {
    const session = await api("/admin/api/session", { token });
    state.csrf = session.csrf;
    location.replace("/admin");
  } catch (error) {
    showSignedOut(error instanceof Error ? error.message : "The sign-in failed.", "error");
  }
}

function watchSignInLinks() {
  window.addEventListener("hashchange", () => {
    if (location.pathname === "/admin/login" && location.hash.length > 1) void signIn();
  });
}

async function start() {
  bindForms();
  showTheme();
  watchSignInLinks();
  if (location.pathname === "/admin/login") {
    await signIn();
    return;
  }
  try {
    const session = await api("/admin/api/session");
    state.csrf = session.csrf;
    showSignedIn();
    await run(refresh);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) showSignedOut();
    else notice(error instanceof Error ? error.message : "The page cannot load.", "error");
  }
}

void start();
