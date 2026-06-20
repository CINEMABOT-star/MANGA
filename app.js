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
  bookmarkBtn: document.querySelector("#bookmarkBtn"),
  translateBtn: document.querySelector("#translateBtn"),
  fitBtn: document.querySelector("#fitBtn"),
  themeBtn: document.querySelector("#themeBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  libraryView: document.querySelector("#libraryView"),
  reader: document.querySelector("#reader"),
  emptyState: document.querySelector("#emptyState"),
  topBtn: document.querySelector("#topBtn"),
  progressBar: document.querySelector("#progressBar"),
  translateStatus: document.querySelector("#translateStatus"),
};

const AUTH_USER = "matteosofia";
const AUTH_PASSWORD_HASH = "3feca854cebffee523348dc87773f7aee2abbe1ad54834f237b24102dab2e988";
const AUTH_SESSION_KEY = "manga-auth-ok";
const BOOKMARKS_KEY = "manga-bookmarks-v2";
const TRANSLATION_DB = "manga-translations-v1";
const TRANSLATION_STORE = "pages";
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

let manifest = null;
let currentManga = null;
let currentChapter = null;
let translationDb = null;
let ocrReadyPromise = null;
let translatorPromise = null;
let translationQueue = [];
let queueRunning = false;
let renderedPageFrames = new Map();

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
    ensureDefaultBookmarks();
    render();
    primeBookmarkedTranslations();
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
    saveBookmark(currentManga.id, chapterId);
    setRoute(currentManga.id, chapterId);
    renderChapter(chapterId);
  });

  els.bookmarkBtn.addEventListener("click", () => {
    if (!currentManga || !currentChapter) return;
    saveBookmark(currentManga.id, currentChapter.id);
    setStatus(`Segnalibro salvato: ${currentManga.title} - ${currentChapter.title}`);
    enqueueChapterTranslation(currentManga, currentChapter, "bookmark");
    enqueueNextChapterTranslation(currentManga, currentChapter);
  });

  els.translateBtn.addEventListener("click", () => {
    if (!currentManga || !currentChapter) return;
    enqueueChapterTranslation(currentManga, currentChapter, "manual", true);
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
    openManga(selectedManga.id, params.get("chapter") || getBookmark(selectedManga.id));
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
  currentChapter = null;
  renderedPageFrames.clear();
  els.reader.hidden = true;
  els.emptyState.hidden = true;
  els.libraryView.hidden = false;
  els.chapterSelect.hidden = true;
  els.libraryBtn.hidden = true;
  els.bookmarkBtn.hidden = true;
  els.translateBtn.hidden = true;
  els.chapterMeta.textContent = `${mangaList.length} manga disponibili`;
  els.libraryView.innerHTML = "";

  mangaList.forEach((manga) => {
    const bookmark = getBookmark(manga.id);
    const bookmarkChapter = manga.chapters.find((chapter) => chapter.id === bookmark) || manga.chapters[0];
    const button = document.createElement("button");
    button.className = "mangaCard";
    button.type = "button";
    button.addEventListener("click", () => {
      const chapterId = getBookmark(manga.id) || manga.chapters[0].id;
      setRoute(manga.id, chapterId);
      openManga(manga.id, chapterId);
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

    const mark = document.createElement("span");
    mark.className = "bookmarkMeta";
    mark.textContent = `Segnalibro: ${bookmarkChapter.title}`;

    button.append(cover, title, meta, mark);
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
  els.translateBtn.hidden = false;
  els.chapterSelect.innerHTML = "";
  manga.chapters.forEach((chapter) => {
    const option = document.createElement("option");
    option.value = chapter.id;
    option.textContent = chapter.title;
    els.chapterSelect.append(option);
  });

  const bookmark = getBookmark(manga.id);
  const selected = manga.chapters.some((chapter) => chapter.id === requestedChapter)
    ? requestedChapter
    : bookmark || manga.chapters[0].id;
  saveBookmark(manga.id, selected);
  setRoute(manga.id, selected);
  els.chapterSelect.value = selected;
  renderChapter(selected);
}

function renderChapter(chapterId) {
  const chapter = currentManga?.chapters.find((item) => item.id === chapterId);
  if (!chapter || !Array.isArray(chapter.pages) || !chapter.pages.length) {
    showEmpty("Nessuna immagine trovata");
    return;
  }

  currentChapter = chapter;
  saveBookmark(currentManga.id, chapter.id);
  renderedPageFrames.clear();
  els.emptyState.hidden = true;
  els.reader.hidden = false;
  els.reader.innerHTML = "";
  els.chapterMeta.textContent = `${chapter.title} - ${chapter.pages.length} pagine`;

  chapter.pages.forEach((src, index) => {
    const frame = document.createElement("div");
    frame.className = "pageFrame";
    frame.dataset.translation = "pending";
    frame.dataset.label = "Traduzione in cache...";

    const img = document.createElement("img");
    img.className = "page";
    img.src = src;
    img.alt = `${chapter.title} - pagina ${index + 1}`;
    img.loading = index < 2 ? "eager" : "lazy";
    img.decoding = "async";

    const layer = document.createElement("div");
    layer.className = "translationLayer";

    frame.append(img, layer);
    els.reader.append(frame);
    renderedPageFrames.set(pageKey(currentManga.id, chapter.id, index), frame);
    renderCachedTranslation(currentManga, chapter, index);
  });

  window.scrollTo({ top: 0 });
  updateProgress();
  enqueueChapterTranslation(currentManga, chapter, "bookmark");
  enqueueNextChapterTranslation(currentManga, chapter);
}

function showEmpty(message) {
  els.libraryView.hidden = true;
  els.reader.hidden = true;
  els.emptyState.hidden = false;
  els.chapterMeta.textContent = message;
}

function setRoute(mangaId, chapterId) {
  const url = new URL(window.location.href);
  url.searchParams.set("manga", mangaId);
  url.searchParams.set("chapter", chapterId);
  window.history.replaceState(null, "", url);
}

function getBookmarks() {
  try {
    return JSON.parse(localStorage.getItem(BOOKMARKS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveBookmarks(bookmarks) {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
}

function getBookmark(mangaId) {
  return getBookmarks()[mangaId];
}

function saveBookmark(mangaId, chapterId) {
  const bookmarks = getBookmarks();
  bookmarks[mangaId] = chapterId;
  saveBookmarks(bookmarks);
}

function ensureDefaultBookmarks() {
  const bookmarks = getBookmarks();
  let changed = false;
  getMangaList().forEach((manga) => {
    if (!bookmarks[manga.id] && manga.chapters?.[0]) {
      bookmarks[manga.id] = manga.chapters[0].id;
      changed = true;
    }
  });
  if (changed) saveBookmarks(bookmarks);
}

function primeBookmarkedTranslations() {
  getMangaList().forEach((manga) => {
    const chapterId = getBookmark(manga.id) || manga.chapters?.[0]?.id;
    const chapter = manga.chapters.find((item) => item.id === chapterId);
    if (chapter) enqueueChapterTranslation(manga, chapter, "bookmark");
  });
}

function enqueueNextChapterTranslation(manga, chapter) {
  const index = manga.chapters.findIndex((item) => item.id === chapter.id);
  const next = manga.chapters[index + 1];
  if (next) enqueueChapterTranslation(manga, next, "next");
}

function enqueueChapterTranslation(manga, chapter, reason, urgent = false) {
  if (!manga || !chapter) return;
  const exists = translationQueue.some((item) => item.manga.id === manga.id && item.chapter.id === chapter.id);
  if (exists) return;
  const task = { manga, chapter, reason };
  if (urgent) translationQueue.unshift(task);
  else translationQueue.push(task);
  runTranslationQueue();
}

async function runTranslationQueue() {
  if (queueRunning) return;
  queueRunning = true;

  while (translationQueue.length) {
    const { manga, chapter, reason } = translationQueue.shift();
    setStatus(`Traduzione ${reasonLabel(reason)}: ${manga.title} - ${chapter.title}`);
    await translateChapter(manga, chapter);
  }

  queueRunning = false;
  setStatus("Traduzioni in pausa. I capitoli pronti restano salvati su questo dispositivo.");
}

async function translateChapter(manga, chapter) {
  for (let index = 0; index < chapter.pages.length; index++) {
    const key = pageKey(manga.id, chapter.id, index);
    const cached = await getCachedTranslation(key);
    if (cached) {
      applyTranslationToRenderedFrame(key, cached);
      continue;
    }

    const frame = renderedPageFrames.get(key);
    if (frame) {
      frame.dataset.translation = "working";
      frame.dataset.label = "Traduzione...";
    }

    try {
      const translation = await translatePage(chapter.pages[index], key);
      await setCachedTranslation(key, translation);
      applyTranslationToRenderedFrame(key, translation);
    } catch (error) {
      if (frame) {
        frame.dataset.translation = "";
        frame.dataset.label = "";
      }
      console.warn("Traduzione fallita", key, error);
    }

    await idlePause();
  }
}

async function translatePage(src, key) {
  await ensureOcrReady();
  const imageSize = await loadImageSize(src);
  const result = await window.Tesseract.recognize(src, "eng", {
    logger: (event) => {
      if (event.status === "recognizing text") {
        setStatus(`OCR pagina ${key.split("/").pop()}: ${Math.round((event.progress || 0) * 100)}%`);
      }
    },
  });

  const lines = extractLines(result.data, imageSize);
  const blocks = [];
  for (const line of lines) {
    if (!line.text || line.text.length < 2) continue;
    const translated = await translateText(line.text);
    blocks.push({
      text: translated,
      box: line.box,
    });
  }

  return { blocks, createdAt: Date.now() };
}

function loadImageSize(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    image.onerror = () => resolve({ width: 1, height: 1 });
    image.src = src;
  });
}

function extractLines(data, imageSize) {
  const source = Array.isArray(data.lines) && data.lines.length ? data.lines : data.words || [];
  const width = data.width || imageSize.width || 1;
  const height = data.height || imageSize.height || 1;

  return source
    .map((item) => {
      const box = item.bbox || item.box || {};
      const x0 = Number(box.x0 ?? box.left ?? 0);
      const y0 = Number(box.y0 ?? box.top ?? 0);
      const x1 = Number(box.x1 ?? box.right ?? x0);
      const y1 = Number(box.y1 ?? box.bottom ?? y0);
      return {
        text: cleanOcrText(item.text || ""),
        box: {
          left: (x0 / width) * 100,
          top: (y0 / height) * 100,
          width: Math.max(6, ((x1 - x0) / width) * 100),
          height: Math.max(2.8, ((y1 - y0) / height) * 100),
        },
      };
    })
    .filter((item) => item.text);
}

function cleanOcrText(text) {
  return text.replace(/\s+/g, " ").replace(/[|_~`]/g, "").trim();
}

async function translateText(text) {
  const nativeTranslator = await getNativeTranslator();
  if (nativeTranslator) return nativeTranslator.translate(text);

  const translator = await getTransformersTranslator();
  const output = await translator(text, { max_new_tokens: 96 });
  return Array.isArray(output) ? output[0]?.translation_text || text : output?.translation_text || text;
}

async function getNativeTranslator() {
  if (!("Translator" in window)) return null;
  try {
    if (!window.__nativeTranslator) {
      window.__nativeTranslator = await window.Translator.create({
        sourceLanguage: "en",
        targetLanguage: "it",
      });
    }
    return window.__nativeTranslator;
  } catch {
    return null;
  }
}

async function getTransformersTranslator() {
  if (!translatorPromise) {
    translatorPromise = import(TRANSFORMERS_URL).then(async ({ pipeline, env }) => {
      env.allowLocalModels = false;
      setStatus("Scarico modello traduzione EN->IT sul dispositivo...");
      return pipeline("translation", "Xenova/opus-mt-en-it");
    });
  }
  return translatorPromise;
}

async function ensureOcrReady() {
  if (!ocrReadyPromise) {
    ocrReadyPromise = new Promise((resolve, reject) => {
      if (window.Tesseract) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = TESSERACT_URL;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }
  return ocrReadyPromise;
}

async function renderCachedTranslation(manga, chapter, index) {
  const key = pageKey(manga.id, chapter.id, index);
  const cached = await getCachedTranslation(key);
  if (cached) applyTranslationToRenderedFrame(key, cached);
}

function applyTranslationToRenderedFrame(key, translation) {
  const frame = renderedPageFrames.get(key);
  if (!frame || !translation?.blocks) return;
  const layer = frame.querySelector(".translationLayer");
  layer.innerHTML = "";
  translation.blocks.forEach((block) => {
    const bubble = document.createElement("span");
    bubble.className = "bubbleText";
    bubble.textContent = block.text;
    bubble.style.left = `${clamp(block.box.left, 0, 98)}%`;
    bubble.style.top = `${clamp(block.box.top, 0, 98)}%`;
    bubble.style.width = `${clamp(block.box.width, 8, 72)}%`;
    bubble.style.height = `${clamp(block.box.height, 3, 18)}%`;
    bubble.style.fontSize = `${clamp(block.box.height * 0.62, 9, 18)}px`;
    layer.append(bubble);
  });
  frame.dataset.translation = "";
  frame.dataset.label = "";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function pageKey(mangaId, chapterId, pageIndex) {
  return `${mangaId}/${chapterId}/${String(pageIndex).padStart(4, "0")}`;
}

function openTranslationDb() {
  if (translationDb) return Promise.resolve(translationDb);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TRANSLATION_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(TRANSLATION_STORE);
    };
    request.onsuccess = () => {
      translationDb = request.result;
      resolve(translationDb);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getCachedTranslation(key) {
  const db = await openTranslationDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRANSLATION_STORE, "readonly");
    const request = tx.objectStore(TRANSLATION_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function setCachedTranslation(key, value) {
  const db = await openTranslationDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRANSLATION_STORE, "readwrite");
    tx.objectStore(TRANSLATION_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function reasonLabel(reason) {
  if (reason === "bookmark") return "segnalibro";
  if (reason === "next") return "capitolo successivo";
  if (reason === "manual") return "manuale";
  return "background";
}

function setStatus(message) {
  els.translateStatus.hidden = false;
  els.translateStatus.textContent = message;
}

function idlePause() {
  return new Promise((resolve) => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(resolve, { timeout: 500 });
    } else {
      setTimeout(resolve, 80);
    }
  });
}

function updateProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable <= 0 ? 0 : (window.scrollY / scrollable) * 100;
  els.progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}
