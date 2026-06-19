const els = {
  loginView: document.querySelector("#loginView"),
  appView: document.querySelector("#appView"),
  loginForm: document.querySelector("#loginForm"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  loginError: document.querySelector("#loginError"),
  siteTitle: document.querySelector("#siteTitle"),
  chapterMeta: document.querySelector("#chapterMeta"),
  chapterSelect: document.querySelector("#chapterSelect"),
  reader: document.querySelector("#reader"),
  emptyState: document.querySelector("#emptyState"),
  fitBtn: document.querySelector("#fitBtn"),
  themeBtn: document.querySelector("#themeBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  topBtn: document.querySelector("#topBtn"),
  progressBar: document.querySelector("#progressBar"),
};

const AUTH_USER = "matteosofia";
const AUTH_PASSWORD_HASH = "3feca854cebffee523348dc87773f7aee2abbe1ad54834f237b24102dab2e988";
const AUTH_SESSION_KEY = "manga-auth-ok";

let manifest = null;

init();

async function init() {
  restorePreferences();
  bindEvents();
  if (sessionStorage.getItem(AUTH_SESSION_KEY) !== "1") {
    els.loginView.hidden = false;
    els.appView.hidden = true;
    return;
  }
  await unlockReader();
}

async function unlockReader() {
  els.loginView.hidden = true;
  els.appView.hidden = false;
  try {
    const response = await fetch(`./manifest.json?cache=${Date.now()}`);
    if (!response.ok) throw new Error("Manifest non trovato");
    manifest = await response.json();
    render();
  } catch {
    showEmpty("Manifest non trovato");
  }
}

function bindEvents() {
  els.loginForm.addEventListener("submit", handleLogin);

  els.logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    window.location.reload();
  });

  els.chapterSelect.addEventListener("change", () => {
    const chapterId = els.chapterSelect.value;
    const url = new URL(window.location.href);
    url.searchParams.set("chapter", chapterId);
    window.history.replaceState(null, "", url);
    renderChapter(chapterId);
  });

  els.fitBtn.addEventListener("click", () => {
    els.reader.classList.toggle("wide");
    localStorage.setItem("manga-fit", els.reader.classList.contains("wide") ? "wide" : "normal");
  });

  els.themeBtn.addEventListener("click", () => {
    document.documentElement.classList.toggle("light");
    localStorage.setItem("manga-theme", document.documentElement.classList.contains("light") ? "light" : "dark");
  });

  els.topBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  window.addEventListener("scroll", updateProgress, { passive: true });
}

async function handleLogin(event) {
  event.preventDefault();
  const username = els.usernameInput.value.trim();
  const passwordHash = await sha256(els.passwordInput.value);

  if (username === AUTH_USER && passwordHash === AUTH_PASSWORD_HASH) {
    sessionStorage.setItem(AUTH_SESSION_KEY, "1");
    els.passwordInput.value = "";
    els.loginError.hidden = true;
    await unlockReader();
    return;
  }

  els.loginError.hidden = false;
  els.passwordInput.select();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function restorePreferences() {
  if (localStorage.getItem("manga-theme") === "light") {
    document.documentElement.classList.add("light");
  }
  if (localStorage.getItem("manga-fit") === "wide") {
    els.reader.classList.add("wide");
  }
}

function render() {
  els.siteTitle.textContent = manifest.title || "MANGA Reader";
  const chapters = Array.isArray(manifest.chapters) ? manifest.chapters : [];

  if (!chapters.length) {
    showEmpty("Nessun capitolo configurato");
    return;
  }

  els.chapterSelect.innerHTML = "";
  chapters.forEach((chapter) => {
    const option = document.createElement("option");
    option.value = chapter.id;
    option.textContent = chapter.title;
    els.chapterSelect.append(option);
  });

  const params = new URLSearchParams(window.location.search);
  const requested = params.get("chapter");
  const selected = chapters.some((chapter) => chapter.id === requested) ? requested : chapters[0].id;
  els.chapterSelect.value = selected;
  renderChapter(selected);
}

function renderChapter(chapterId) {
  const chapter = manifest.chapters.find((item) => item.id === chapterId);
  if (!chapter || !Array.isArray(chapter.pages) || !chapter.pages.length) {
    showEmpty("Nessuna immagine trovata");
    return;
  }

  els.emptyState.hidden = true;
  els.reader.hidden = false;
  els.reader.innerHTML = "";
  els.chapterMeta.textContent = `${chapter.title} - ${chapter.pages.length} pagine`;

  chapter.pages.forEach((src, index) => {
    const img = document.createElement("img");
    img.className = "page";
    img.src = src;
    img.alt = `${chapter.title} - pagina ${index + 1}`;
    img.loading = index < 2 ? "eager" : "lazy";
    img.decoding = "async";
    els.reader.append(img);
  });

  window.scrollTo({ top: 0 });
  updateProgress();
}

function showEmpty(message) {
  els.reader.hidden = true;
  els.emptyState.hidden = false;
  els.chapterMeta.textContent = message;
}

function updateProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable <= 0 ? 0 : (window.scrollY / scrollable) * 100;
  els.progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}
