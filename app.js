const els = {
  loginView: document.querySelector("#loginView"),
  appView: document.querySelector("#appView"),
  loginForm: document.querySelector("#loginForm"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  loginError: document.querySelector("#loginError"),
  siteTitle: document.querySelector("#siteTitle"),
  chapterMeta: document.querySelector("#chapterMeta"),
  libraryBtn: document.querySelector("#libraryBtn"),
  chapterSelect: document.querySelector("#chapterSelect"),
  libraryView: document.querySelector("#libraryView"),
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
let currentManga = null;

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

  els.libraryBtn.addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("manga");
    url.searchParams.delete("chapter");
    window.history.replaceState(null, "", url);
    renderLibrary();
  });

  els.chapterSelect.addEventListener("change", () => {
    const chapterId = els.chapterSelect.value;
    const url = new URL(window.location.href);
    if (currentManga) url.searchParams.set("manga", currentManga.id);
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
  const mangaList = getMangaList();

  if (!mangaList.length) {
    showEmpty("Nessun manga configurato");
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const requestedManga = params.get("manga");
  const selectedManga = mangaList.find((item) => item.id === requestedManga);

  if (selectedManga) {
    openManga(selectedManga.id, params.get("chapter"));
  } else {
    renderLibrary();
  }
}

function getMangaList() {
  if (Array.isArray(manifest.manga)) return manifest.manga;
  if (Array.isArray(manifest.chapters)) {
    return [{ id: "default", title: manifest.title || "Manga", cover: "", chapters: manifest.chapters }];
  }
  return [];
}

function renderLibrary() {
  const mangaList = getMangaList();
  currentManga = null;
  els.reader.hidden = true;
  els.emptyState.hidden = true;
  els.libraryView.hidden = false;
  els.chapterSelect.hidden = true;
  els.libraryBtn.hidden = true;
  els.chapterMeta.textContent = `${mangaList.length} manga disponibili`;
  els.libraryView.innerHTML = "";

  mangaList.forEach((manga) => {
    const button = document.createElement("button");
    button.className = "mangaCard";
    button.type = "button";
    button.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("manga", manga.id);
      url.searchParams.delete("chapter");
      window.history.replaceState(null, "", url);
      openManga(manga.id);
    });

    const cover = document.createElement("img");
    cover.src = manga.cover || "";
    cover.alt = `${manga.title} cover`;
    cover.loading = "lazy";

    const title = document.createElement("strong");
    title.textContent = manga.title;

    const meta = document.createElement("span");
    const pages = manga.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0);
    meta.textContent = `${manga.chapters.length} capitoli - ${pages} pagine`;

    button.append(cover, title, meta);
    els.libraryView.append(button);
  });
}

function openManga(mangaId, requestedChapter) {
  const manga = getMangaList().find((item) => item.id === mangaId);
  if (!manga || !Array.isArray(manga.chapters) || !manga.chapters.length) {
    showEmpty("Nessun capitolo configurato");
    return;
  }

  currentManga = manga;
  els.siteTitle.textContent = manga.title;
  els.libraryView.hidden = true;
  els.chapterSelect.hidden = false;
  els.libraryBtn.hidden = false;
  els.chapterSelect.innerHTML = "";
  manga.chapters.forEach((chapter) => {
    const option = document.createElement("option");
    option.value = chapter.id;
    option.textContent = chapter.title;
    els.chapterSelect.append(option);
  });

  const selected = manga.chapters.some((chapter) => chapter.id === requestedChapter)
    ? requestedChapter
    : manga.chapters[0].id;
  els.chapterSelect.value = selected;
  renderChapter(selected);
}

function renderChapter(chapterId) {
  const chapter = currentManga?.chapters.find((item) => item.id === chapterId);
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
  els.libraryView.hidden = true;
  els.reader.hidden = true;
  els.emptyState.hidden = false;
  els.chapterMeta.textContent = message;
}

function updateProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable <= 0 ? 0 : (window.scrollY / scrollable) * 100;
  els.progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}
