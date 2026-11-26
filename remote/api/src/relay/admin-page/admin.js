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

function notice(message) {
  const element = byId("notice");
  element.textContent = message;
  element.hidden = message === "";
}

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
  if (className) element.className = className;
  element.addEventListener("click", onClick);
  return element;
}

function emptyRow(body, columns, text) {
  const row = document.createElement("tr");
  const element = cell(row, text, "empty");
  element.colSpan = columns;
  body.replaceChildren(row);
}

function showSignedOut(message) {
  state.csrf = "";
  byId("signed-in").hidden = true;
  byId("sign-out").hidden = true;
  byId("refresh").hidden = true;
  byId("signed-out").hidden = false;
  if (message) notice(message);
}

function showSignedIn() {
  byId("signed-out").hidden = true;
  byId("signed-in").hidden = false;
  byId("sign-out").hidden = false;
  byId("refresh").hidden = false;
}

function renderOverview(overview) {
  const list = byId("overview");
  const identity = overview.serverIdentity;
  const facts = [
    ["Relay address", overview.relayUrl ?? "not set"],
    [
      "Join codes",
      overview.joinServer ? `enroll at https://${overview.joinServer}/v1/enroll` : "off (no wss: address)",
    ],
    ["Root fingerprint (SHA-256)", overview.rootFingerprint],
    ["Root in join codes", overview.joinRootFingerprint],
    ["Root expires", time(overview.rootExpiresAt)],
    [
      "Server identity",
      identity.problem ? identity.problem : `${identity.names || "-"}, expires ${time(identity.expiresAt)}`,
    ],
    [
      "TLS certificate expires",
      overview.tlsExpiresAt === null ? "no TLS in this process" : time(overview.tlsExpiresAt),
    ],
    ["Members online", overview.membersOnline],
    ["Teams", overview.teams ?? "-"],
    ["Open join codes", overview.openCodes ?? "-"],
  ];
  list.replaceChildren(
    ...facts.flatMap(([term, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = String(value);
      if (term.includes("fingerprint") || term.includes("Root in")) dd.className = "mono";
      return [dt, dd];
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
        cell(row, team.name);
        cell(row, team.status, `status-${team.status}`);
        cell(row, time(team.expiresAt));
        cell(row, team.members);
        cell(row, team.membersOnline);
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
    emptyRow(body, 7, "No open join code.");
    return;
  }
  body.replaceChildren(
    ...codes.map((code) => {
      const row = document.createElement("tr");
      cell(row, code.id, "mono");
      cell(row, code.team);
      cell(row, code.user);
      cell(row, code.device);
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
          notice(`The certificate of ${member.user} is revoked. Its connections are closed.`);
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
    emptyRow(body, 9, "No member in this team.");
    return;
  }
  body.replaceChildren(
    ...members.map((member) => {
      const row = document.createElement("tr");
      cell(row, member.user);
      cell(row, member.device);
      cell(row, member.label);
      cell(row, short(member.keyId), "mono").title = member.keyId;
      cell(row, short(member.serial), "mono").title = member.serial;
      cell(row, time(member.expiresAt));
      cell(row, member.status, `status-${member.status}`);
      cell(
        row,
        member.online ? (member.hosting ? "online, hosting" : "online") : "offline",
        member.online ? "online" : "offline",
      );
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
    emptyRow(byId("member-rows"), 9, "No team yet.");
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
    else notice(error instanceof Error ? error.message : "The action failed.");
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
  if (token === "") {
    showSignedOut("The sign-in link has no token. Run admin login again.");
    return;
  }
  try {
    const session = await api("/admin/api/session", { token });
    state.csrf = session.csrf;
    location.replace("/admin");
  } catch (error) {
    showSignedOut(error instanceof Error ? error.message : "The sign-in failed.");
  }
}

async function start() {
  bindForms();
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
    else notice(error instanceof Error ? error.message : "The page cannot load.");
  }
}

void start();
