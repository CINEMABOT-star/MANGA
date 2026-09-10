const els = {
  loginView: document.querySelector("#loginView"),
  appView: document.querySelector("#appView"),
  loginForm: document.querySelector("#loginForm"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  registerBtn: document.querySelector("#registerBtn"),
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
  bookmarkBtn: document.querySelector("#bookmarkBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  topBtn: document.querySelector("#topBtn"),
  progressBar: document.querySelector("#progressBar"),
};

const config = window.MANGA_SUPABASE_CONFIG;
const supabase = config && window.supabase
  && typeof config.url === "string" && typeof config.anonKey === "string"
  && config.url.includes(".supabase.co")
  && !config.url.includes("TUO-PROGETTO") && !config.anonKey.includes("LA-TUA")
  ? window.supabase.createClient(config.url, config.anonKey)
  : null;

let manifest = null;
let currentManga = null;
let currentUser = null;

init();

async function init() {
  restorePreferences();
  bindEvents();
  if (!supabase) {
    showLoginError("Configura Supabase prima di usare l'accesso online.");
    return;
  }
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user || null;
  if (!currentUser) {
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
  els.registerBtn.addEventListener("click", handleRegister);
  els.logoutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
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
  els.bookmarkBtn.addEventListener("click", saveBookmark);
  els.topBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  window.addEventListener("scroll", updateProgress, { passive: true });
}

async function handleLogin(event) {
  event.preventDefault();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: els.usernameInput.value.trim(),
    password: els.passwordInput.value,
  });
  if (error) {
    showLoginError("Email o password non validi.");
    els.passwordInput.select();
    return;
  }
  currentUser = data.user;
  els.passwordInput.value = "";
  els.loginError.hidden = true;
  await unlockReader();
}

async function handleRegister() {
  const { data, error } = await supabase.auth.signUp({
    email: els.usernameInput.value.trim(),
    password: els.passwordInput.value,
  });
  if (error) {
    showLoginError(error.message);
    return;
  }
  if (!data.session) {
    showLoginError("Controlla la tua email per confermare l'account.");
    return;
  }
  currentUser = data.user;
  els.loginError.hidden = true;
  await unlockReader();
}

function showLoginError(message) {
  els.loginError.textContent = message;
  els.loginError.hidden = false;
}

function restorePreferences() {
  if (localStorage.getItem("manga-theme") === "light") document.documentElement.classList.add("light");
  if (localStorage.getItem("manga-fit") === "wide") els.reader.classList.add("wide");
}

function render() {
  els.siteTitle.textContent = manifest.title || "MANGA Reader";
  const mangaList = getMangaList();
  if (!mangaList.length) {
    showEmpty("Nessun manga configurato");
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const selectedManga = mangaList.find((item) => item.id === params.get("manga"));
  selectedManga ? openManga(selectedManga.id, params.get("chapter")) : renderLibrary();
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
  els.bookmarkBtn.hidden = true;
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
  els.bookmarkBtn.hidden = false;
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
  loadBookmark(chapterId);
}

async function loadBookmark(chapterId) {
  const { data, error } = await supabase
    .from("bookmarks")
    .select("chapter_id,page_index")
    .eq("user_id", currentUser.id)
    .eq("manga_id", currentManga.id)
    .maybeSingle();
  if (error) {
    console.error("Impossibile caricare il segnalibro", error);
    return;
  }
  if (data?.chapter_id === chapterId && Number.isInteger(data.page_index)) {
    els.reader.children[data.page_index]?.scrollIntoView({ block: "start" });
  }
}

async function saveBookmark() {
  const pages = [...els.reader.children];
  const pageIndex = pages.reduce((nearest, page, index) => {
    const distance = Math.abs(page.getBoundingClientRect().top);
    return distance < nearest.distance ? { index, distance } : nearest;
  }, { index: 0, distance: Infinity }).index;
  const { error } = await supabase.from("bookmarks").upsert({
    user_id: currentUser.id,
    manga_id: currentManga.id,
    chapter_id: els.chapterSelect.value,
    page_index: pageIndex,
  });
  if (error) {
    console.error("Impossibile salvare il segnalibro", error);
    return;
  }
  els.bookmarkBtn.textContent = "Salvato";
  window.setTimeout(() => { els.bookmarkBtn.textContent = "Segnalibro"; }, 1400);
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
