const state = { role: null, questions: [], query: "" };
const $ = (selector) => document.querySelector(selector);

const gateView = $("#gateView");
const libraryView = $("#libraryView");
const ownerDialog = $("#ownerDialog");

function setTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  $("meta[name='theme-color']").content = next === "dark" ? "#1c211d" : "#f7f5ef";
  document.querySelectorAll(".theme-toggle").forEach((button) => {
    const label = next === "dark" ? "Switch to light theme" : "Switch to dark theme";
    button.setAttribute("aria-label", label);
    button.title = label;
  });
  try { localStorage.setItem("answer-room-theme", next); } catch { /* Theme still works for this visit. */ }
}

function initializeTheme() {
  let saved;
  try { saved = localStorage.getItem("answer-room-theme"); } catch { /* Use the system theme when storage is unavailable. */ }
  setTheme(saved || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`/api/${path}`, { ...options, headers, credentials: "same-origin", cache: "no-store" });
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) {
    const error = new Error(result.error || "Something went wrong. Please try again.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function setView(view) {
  const inLibrary = view === "library";
  gateView.hidden = inLibrary;
  libraryView.hidden = !inLibrary;
  if (!inLibrary) setTimeout(() => $("#visitorPassword")?.focus(), 80);
}

function showError(element, message) {
  element.textContent = message || "";
  element.hidden = !message;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function setBusy(button, busy, busyLabel) {
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.querySelector("span")?.textContent || button.textContent.trim();
  button.disabled = busy;
  const label = button.querySelector("span");
  if (label) label.textContent = busy ? busyLabel : button.dataset.defaultLabel;
}

function enterLibrary(role) {
  state.role = role;
  setView("library");
  configureOwnerPanel();
  loadQuestions();
}

function configureOwnerPanel() {
  const isOwner = state.role === "main-owner" || state.role === "content-owner";
  const isMainOwner = state.role === "main-owner";
  $("#ownerPanel").hidden = !isOwner;
  $("#visitorPasswordControl").hidden = !isMainOwner;
  $("#ownerRoleLabel").textContent = isMainOwner ? "MAIN OWNER SPACE" : "CONTENT OWNER SPACE";
  $("#ownerPanelTitle").textContent = isMainOwner ? "Add to the library" : "Add a new answer";
  $("#ownerHint").textContent = isMainOwner
    ? "Write an answer for the library, add a code example, or update visitor access below."
    : "Add a question and answer for visitors. You can include a code example too.";
  $("#footerAccess").textContent = isOwner ? (isMainOwner ? "Main owner" : "Content owner") : "Private library";
}

function appendTextParagraphs(container, text) {
  const parts = text.split(/\n\s*\n/);
  for (const part of parts) {
    const paragraph = document.createElement("p");
    paragraph.textContent = part;
    container.append(paragraph);
  }
}

function makeQuestionCard(item, index) {
  const details = document.createElement("details");
  details.className = "answer-card";
  details.dataset.search = `${item.question} ${item.answer} ${item.code || ""}`.toLocaleLowerCase();

  const summary = document.createElement("summary");
  const number = document.createElement("span");
  number.className = "question-index";
  number.textContent = String(index + 1).padStart(2, "0");
  const title = document.createElement("span");
  title.className = "question-title";
  title.textContent = item.question;
  const expand = document.createElement("span");
  expand.className = "expand-icon";
  expand.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-7-7h14"/></svg>';
  summary.append(number, title, expand);

  const content = document.createElement("div");
  content.className = "answer-content";
  appendTextParagraphs(content, item.answer);

  if (item.code) {
    const sample = document.createElement("div");
    sample.className = "code-sample";
    const sampleHead = document.createElement("div");
    sampleHead.className = "code-sample-head";
    const language = document.createElement("span");
    language.textContent = item.language || "text";
    const copy = document.createElement("button");
    copy.className = "copy-code";
    copy.type = "button";
    copy.setAttribute("aria-label", "Copy code example");
    copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>Copy</span>';
    copy.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(item.code);
        copy.querySelector("span").textContent = "Copied";
        setTimeout(() => { if (copy.isConnected) copy.querySelector("span").textContent = "Copy"; }, 1600);
      } catch {
        showToast("Clipboard access is unavailable in this browser.");
      }
    });
    sampleHead.append(language, copy);
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = item.code;
    pre.append(code);
    sample.append(sampleHead, pre);
    content.append(sample);
  }

  details.append(summary, content);
  return details;
}

function renderQuestions() {
  const list = $("#questionList");
  list.replaceChildren();
  const query = state.query.trim().toLocaleLowerCase();
  const visible = state.questions.filter((item) => !query || `${item.question} ${item.answer} ${item.code || ""}`.toLocaleLowerCase().includes(query));
  $("#questionCount").textContent = query ? `${visible.length}/${state.questions.length}` : String(state.questions.length);
  $("#emptyState").hidden = visible.length > 0;
  if (visible.length === 0) {
    $("#emptyTitle").textContent = state.questions.length ? "No matches just yet" : "A fresh page";
    $("#emptyCopy").textContent = state.questions.length
      ? "Try a different word or phrase to find what you need."
      : state.role === "main-owner" || state.role === "content-owner"
        ? "Your library is ready. Add the first question and answer above."
        : "There are no answers here yet. Check back soon.";
  }
  visible.forEach((item, index) => list.append(makeQuestionCard(item, index)));
}

async function loadQuestions() {
  try {
    const response = await api("questions");
    state.questions = Array.isArray(response.questions) ? response.questions : [];
    renderQuestions();
  } catch (error) {
    if (error.status === 401) {
      state.role = null;
      setView("gate");
      return;
    }
    $("#emptyTitle").textContent = "Answers are taking a moment";
    $("#emptyCopy").textContent = error.message;
    $("#emptyState").hidden = false;
    $("#questionCount").textContent = "—";
  }
}

async function signIn(form, type, passwordInput, errorNode, button) {
  button ||= form.querySelector("button[type='submit']");
  showError(errorNode, "");
  setBusy(button, true, "Checking…");
  try {
    const response = await api("login", {
      method: "POST",
      body: JSON.stringify({ type, password: passwordInput.value }),
    });
    form.reset();
    if (type === "owner") ownerDialog.close();
    enterLibrary(response.role);
  } catch (error) {
    showError(errorNode, error.message);
    passwordInput.focus();
  } finally {
    setBusy(button, false);
  }
}

$(".theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
initializeTheme();

$("#visitorLogin").addEventListener("submit", (event) => {
  event.preventDefault();
  signIn(event.currentTarget, "visitor", $("#visitorPassword"), $("#visitorError"), event.submitter);
});

$("#ownerAccess").addEventListener("click", () => {
  showError($("#ownerError"), "");
  if (!ownerDialog.open) ownerDialog.showModal();
  setTimeout(() => $("#ownerPassword").focus(), 60);
});

$("#ownerLogin").addEventListener("submit", (event) => {
  event.preventDefault();
  signIn(event.currentTarget, "owner", $("#ownerPassword"), $("#ownerError"), event.submitter);
});

document.querySelectorAll("[data-reveal]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.reveal);
    input.type = input.type === "password" ? "text" : "password";
    button.setAttribute("aria-label", input.type === "password" ? "Show password" : "Hide password");
  });
});

$("#questionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorNode = $("#questionError");
  const button = form.querySelector("button[type='submit']");
  showError(errorNode, "");
  setBusy(button, true, "Saving…");
  const values = new FormData(form);
  try {
    const response = await api("questions", {
      method: "POST",
      body: JSON.stringify({
        question: values.get("question"),
        answer: values.get("answer"),
        code: values.get("code"),
        language: values.get("language"),
      }),
    });
    state.questions = [response.question, ...state.questions];
    state.query = "";
    $("#searchInput").value = "";
    form.reset();
    renderQuestions();
    showToast("Your answer is now in the library.");
    $("#libraryHeading").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    showError(errorNode, error.message);
  } finally {
    setBusy(button, false);
  }
});

$("#changeVisitorPassword").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorNode = $("#passwordError");
  const input = $("#newVisitorPassword");
  const button = form.querySelector("button[type='submit']");
  showError(errorNode, "");
  setBusy(button, true, "Updating…");
  try {
    await api("admin/visitor-password", { method: "POST", body: JSON.stringify({ password: input.value }) });
    form.reset();
    showToast("Visitor password updated. Existing visitor sessions have been closed.");
  } catch (error) {
    showError(errorNode, error.message);
  } finally {
    setBusy(button, false);
  }
});

$("#signOut").addEventListener("click", async () => {
  try { await api("logout", { method: "POST", body: "{}" }); } catch { /* Clear the local view even if the network is unavailable. */ }
  state.role = null;
  state.questions = [];
  state.query = "";
  $("#searchInput").value = "";
  configureOwnerPanel();
  setView("gate");
  showToast("You have been signed out.");
});

$("#searchInput").addEventListener("input", (event) => {
  state.query = event.currentTarget.value;
  renderQuestions();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && state.role && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    $("#searchInput").focus();
  }
  if (event.key === "Escape" && ownerDialog.open) ownerDialog.close();
});

async function restoreSession() {
  try {
    const response = await api("session");
    if (response.authenticated) enterLibrary(response.role);
    else setView("gate");
  } catch {
    setView("gate");
  }
}

restoreSession();
