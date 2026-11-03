(() => {
  "use strict";

  /* ---------- Config ---------- */
  const PAGE = 12;
  const SOURCES = {
    afrikabelo: { name: "Afrikabelo", host: "https://afrikabelo.blogspot.com", cls: "" },
    pulse: { name: "Bolo TV Pulse", host: "https://bolotvpulse.blogspot.com", cls: "pulse" },
  };
  // Category chips per tab. `map` = blog label to request for each source (null = skip that source).
  const CHIPS = {
    home: [
      { id: "all", text: "All" },
      { id: "news", text: "News", map: { afrikabelo: "Breaking News", pulse: "News" } },
      { id: "sport", text: "Sport", map: { afrikabelo: "Sports", pulse: "Sports" } },
      { id: "ent", text: "Entertainment", map: { afrikabelo: "Gossip", pulse: "Entertainment" } },
      { id: "life", text: "Lifestyle", map: { afrikabelo: "Lifestyle", pulse: null } },
    ],
    afrikabelo: [
      { id: "all", text: "All" },
      ...["Breaking News", "Sports", "Gossip", "Lifestyle", "Music Hub", "TV Hub", "Bolo Culture"].map((t) => ({ id: t, text: t, map: { afrikabelo: t } })),
    ],
    pulse: [
      { id: "all", text: "All" },
      ...["News", "Sports", "Entertainment"].map((t) => ({ id: t, text: t, map: { pulse: t } })),
    ],
    saved: [],
  };

  /* ---------- State ---------- */
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let tab = "home";
  let chip = "all";
  let query = "";
  let feed = { posts: [], pos: {}, done: {}, loading: false };
  let saved = store.get("bolo.saved", []);
  let current = null;
  let deferredInstall = null;

  /* ---------- Helpers ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200); };
  const ago = (iso) => {
    const d = new Date(iso); const s = (Date.now() - d) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 86400 * 7) return Math.round(s / 86400) + " d ago";
    return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  };
  const bigImg = (u, w = 640, h = 440) => u ? u.replace(/\/s\d+(-c)?\//, `/w${w}-h${h}-c/`).replace(/=s\d+(-c)?$/, `=w${w}-h${h}-c`) : "";

  /* ---------- Blogger feed access ---------- */
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = "__bl" + Math.random().toString(36).slice(2);
      const s = document.createElement("script");
      const clean = () => { delete window[cb]; s.remove(); };
      window[cb] = (d) => { clean(); resolve(d); };
      s.onerror = () => { clean(); reject(new Error("jsonp")); };
      s.src = url + "&alt=json-in-script&callback=" + cb;
      document.head.appendChild(s);
    });
  }
  async function getJSON(url) {
    try {
      const r = await fetch(url + "&alt=json");
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch {
      return jsonp(url);
    }
  }
  function normalise(entry, key) {
    const link = (entry.link || []).find((l) => l.rel === "alternate");
    const html = entry.content ? entry.content.$t : (entry.summary ? entry.summary.$t : "");
    let img = entry["media$thumbnail"] ? entry["media$thumbnail"].url : "";
    if (!img) { const m = html.match(/<img[^>]+src=["']([^"']+)/i); if (m) img = m[1]; }
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return {
      id: entry.id.$t, src: key, title: entry.title.$t, date: entry.published.$t,
      url: link ? link.href : SOURCES[key].host, img, html, excerpt: text.slice(0, 140),
      cats: (entry.category || []).map((c) => c.term),
    };
  }
  async function fetchSource(key, { label, q, start }) {
    let url = SOURCES[key].host + "/feeds/posts/default";
    if (label) url += "/-/" + encodeURIComponent(label);
    url += `?max-results=${PAGE}&start-index=${start}`;
    if (q) url += "&q=" + encodeURIComponent(q);
    const data = await getJSON(url);
    const f = data.feed || {};
    const entries = (f.entry || []).map((e) => normalise(e, key));
    const total = parseInt((f["openSearch$totalResults"] || {}).$t || "0", 10);
    return { entries, total };
  }

  /* ---------- Loading + rendering ---------- */
  function activeSources() {
    const c = CHIPS[tab].find((x) => x.id === chip) || CHIPS[tab][0];
    const keys = tab === "home" ? ["afrikabelo", "pulse"] : [tab];
    return keys.map((k) => ({ key: k, label: c && c.map ? c.map[k] : undefined, skip: c && c.map && c.map[k] === null }))
               .filter((s) => !s.skip);
  }
  const cacheKey = () => `bolo.cache.${tab}.${chip}.${query}`;

  async function load(reset) {
    if (feed.loading) return;
    if (tab === "saved") return renderSaved();
    if (reset) { feed = { posts: [], pos: {}, done: {}, loading: false }; $("#list").innerHTML = skeletons(5); $("#hero").innerHTML = ""; }
    feed.loading = true; setStatus("");
    const srcs = activeSources();
    try {
      const results = await Promise.allSettled(srcs.map(async (s) => {
        if (feed.done[s.key]) return [];
        const start = feed.pos[s.key] || 1;
        const { entries, total } = await fetchSource(s.key, { label: s.label, q: query, start });
        feed.pos[s.key] = start + entries.length;
        if (!entries.length || feed.pos[s.key] > total) feed.done[s.key] = true;
        return entries;
      }));
      const ok = results.filter((r) => r.status === "fulfilled");
      if (!ok.length) throw new Error("offline");
      const seen = new Set(feed.posts.map((p) => p.id));
      ok.flatMap((r) => r.value).forEach((p) => { if (!seen.has(p.id)) feed.posts.push(p); });
      feed.posts.sort((a, b) => new Date(b.date) - new Date(a.date));
      if (reset) store.set(cacheKey(), feed.posts.slice(0, PAGE).map(({ html, ...rest }) => ({ ...rest, html: "" })));
      render(false);
    } catch (e) {
      const cached = reset ? store.get(cacheKey(), []) : [];
      if (cached.length) { feed.posts = cached; render(true); toast("Offline – showing saved headlines"); }
      else { $("#list").innerHTML = ""; setStatus("Couldn't load stories. Check your connection and <b>pull to retry</b>.", true); }
    } finally {
      feed.loading = false;
    }
  }

  function skeletons(n) { return Array.from({ length: n }, () => '<div class="skeleton"></div>').join(""); }
  function setStatus(html, retry) {
    const el = $("#status"); el.innerHTML = html;
    if (retry) { const b = document.createElement("button"); b.className = "more-btn"; b.textContent = "Try again"; b.onclick = () => load(true); el.appendChild(document.createElement("br")); el.appendChild(b); }
  }

  function render(offline) {
    const posts = feed.posts;
    const showHero = !query && posts.length && tab !== "saved";
    $("#hero").innerHTML = showHero ? heroHTML(posts[0]) : "";
    const rest = showHero ? posts.slice(1) : posts;
    $("#list").innerHTML = rest.map(cardHTML).join("");
    const more = !offline && activeSources().some((s) => !feed.done[s.key]);
    $("#moreBtn").hidden = !more;
    setStatus(!posts.length ? "No stories found." : (!more && !offline ? "You’re all caught up." : ""));
  }

  function heroHTML(p) {
    const s = SOURCES[p.src];
    return `<div class="hero" data-id="${esc(p.id)}">${p.img ? `<img src="${esc(bigImg(p.img, 900, 620))}" alt="" loading="eager">` : ""}
      <div class="hero-text"><span class="tag ${s.cls}">${esc(s.name)}</span><h2>${esc(p.title)}</h2><div class="hero-meta">${ago(p.date)}</div></div></div>`;
  }
  function cardHTML(p) {
    const s = SOURCES[p.src]; const on = saved.some((x) => x.id === p.id);
    const thumb = p.img ? `<div class="thumb" style="background-image:url('${esc(bigImg(p.img, 240, 210))}')"></div>` : `<div class="thumb empty">B</div>`;
    return `<div class="card" data-id="${esc(p.id)}" role="button" tabindex="0">${thumb}
      <div class="card-body"><div><span class="dot ${s.cls}"></span><span class="card-meta" style="display:inline">${esc(s.name)}</span><h3>${esc(p.title)}</h3></div>
      <div class="card-meta"><span>${ago(p.date)}</span><button class="bm ${on ? "on" : ""}" data-bm="${esc(p.id)}" aria-label="Save"><svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z"/></svg></button></div></div></div>`;
  }
  function renderSaved() {
    $("#hero").innerHTML = ""; $("#moreBtn").hidden = true;
    feed.posts = saved.slice();
    $("#list").innerHTML = saved.map(cardHTML).join("");
    setStatus(saved.length ? "" : "Nothing saved yet. Tap the bookmark on any story to read it later, even offline.");
  }

  /* ---------- Chips / tabs ---------- */
  function renderChips() {
    const list = CHIPS[tab];
    $("#chips").hidden = !list.length;
    $("#chips").innerHTML = list.map((c) => `<button class="chip ${c.id === chip ? "active" : ""}" data-chip="${esc(c.id)}" role="tab">${esc(c.text)}</button>`).join("");
  }
  function setTab(t, push) {
    tab = t; chip = "all"; query = "";
    $("#searchInput").value = "";
    document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
    $("#subtitle").textContent = { home: "News · Sport · Culture", afrikabelo: "Afrikabelo", pulse: "Bolo TV Pulse", saved: "Saved stories" }[t];
    renderChips(); load(true);
    window.scrollTo({ top: 0 });
  }

  /* ---------- Reader ---------- */
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script,style,link,form,object,embed,noscript").forEach((n) => n.remove());
    doc.querySelectorAll("iframe").forEach((f) => {
      if (!/^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//i.test(f.getAttribute("src") || "")) f.remove();
      else { f.removeAttribute("width"); f.removeAttribute("height"); f.style.width = "100%"; f.style.aspectRatio = "16/9"; f.setAttribute("loading", "lazy"); f.setAttribute("allowfullscreen", ""); }
    });
    doc.querySelectorAll("*").forEach((el) => {
      [...el.attributes].forEach((a) => {
        if (/^on/i.test(a.name) || (["href", "src"].includes(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      });
      el.removeAttribute("style");
      if (el.tagName === "A") { el.target = "_blank"; el.rel = "noopener noreferrer"; }
      if (el.tagName === "IMG") { el.loading = "lazy"; el.removeAttribute("width"); el.removeAttribute("height"); const s = el.getAttribute("src"); if (s) el.src = s.replace(/\/s\d+(-c)?\//, "/s1000/").replace(/\/w\d+-h\d+(-c)?\//, "/s1000/"); }
    });
    return doc.body.innerHTML;
  }
  function openPost(id, push = true) {
    const p = feed.posts.find((x) => x.id === id) || saved.find((x) => x.id === id);
    if (!p) return;
    current = p;
    const s = SOURCES[p.src];
    const body = p.html ? sanitize(p.html) : `<p>${esc(p.excerpt)}…</p>`;
    const hasImg = /<img/i.test(body);
    $("#readerSrc").textContent = s.name;
    $("#readerBody").innerHTML = `<span class="tag ${s.cls}">${esc(s.name)}</span><h1>${esc(p.title)}</h1>
      <div class="reader-meta">${new Date(p.date).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      ${!hasImg && p.img ? `<img class="reader-cover" src="${esc(bigImg(p.img, 900, 600))}" alt="">` : ""}
      <div class="reader-content">${body}</div>
      <a class="reader-cta" href="${esc(p.url)}" target="_blank" rel="noopener">Open on ${esc(s.name)} website</a>`;
    updateSaveBtn();
    $("#reader").hidden = false; $("#reader").scrollTop = 0;
    document.body.style.overflow = "hidden";
    if (push) history.pushState({ reader: 1 }, "");
  }
  function closeReader(fromPop) {
    if ($("#reader").hidden) return;
    $("#reader").hidden = true; document.body.style.overflow = ""; current = null;
    if (!fromPop && history.state && history.state.reader) history.back();
  }
  function updateSaveBtn() { $("#readerSave").classList.toggle("on", !!current && saved.some((x) => x.id === current.id)); }
  function toggleSave(id) {
    const p = feed.posts.find((x) => x.id === id) || saved.find((x) => x.id === id) || current;
    if (!p) return;
    const i = saved.findIndex((x) => x.id === id);
    if (i >= 0) { saved.splice(i, 1); toast("Removed from Saved"); }
    else { saved.unshift(p); saved = saved.slice(0, 60); toast("Saved for later"); }
    store.set("bolo.saved", saved);
    document.querySelectorAll(`[data-bm="${CSS.escape(id)}"]`).forEach((b) => b.classList.toggle("on", saved.some((x) => x.id === id)));
    updateSaveBtn();
    if (tab === "saved") renderSaved();
  }
  async function share() {
    if (!current) return;
    const data = { title: current.title, text: current.title + " – Bolo TV", url: current.url };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(current.url); toast("Link copied"); } } catch {}
  }

  /* ---------- Events ---------- */
  document.addEventListener("click", (e) => {
    const bm = e.target.closest("[data-bm]"); if (bm) { e.stopPropagation(); return toggleSave(bm.dataset.bm); }
    const card = e.target.closest("[data-id]"); if (card) return openPost(card.dataset.id);
    const c = e.target.closest("[data-chip]"); if (c) { chip = c.dataset.chip; renderChips(); load(true); return; }
    const t = e.target.closest(".tabbar button"); if (t) return setTab(t.dataset.tab);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList.contains("card")) openPost(e.target.dataset.id); });
  $("#moreBtn").onclick = () => load(false);
  $("#readerBack").onclick = () => closeReader(false);
  $("#readerSave").onclick = () => current && toggleSave(current.id);
  $("#readerShare").onclick = share;
  window.addEventListener("popstate", () => closeReader(true));

  $("#infoBtn").onclick = () => ($("#sheet").hidden = false);
  $("#sheetClose").onclick = () => ($("#sheet").hidden = true);
  $("#sheet").onclick = (e) => { if (e.target.id === "sheet") $("#sheet").hidden = true; };

  $("#searchBtn").onclick = () => { $("#searchbar").hidden = false; $("#searchInput").focus(); };
  $("#searchClose").onclick = () => { $("#searchbar").hidden = true; if (query) { query = ""; $("#searchInput").value = ""; load(true); } };
  let st;
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(st);
    st = setTimeout(() => { query = e.target.value.trim(); if (tab === "saved") setTab("home"); load(true); }, 450);
  });

  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#F5F6FB" : "#0B1020";
  };
  applyTheme(store.get("bolo.theme", "dark"));
  $("#themeBtn").onclick = () => {
    const t = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(t); store.set("bolo.theme", t);
  };

  /* ---------- Install prompt ---------- */
  const standalone = matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(ua);
  const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|; wv\)/i.test(ua);
  const LATER_MS = 24 * 3600 * 1000; // ask again after one day

  function manualSteps() {
    if (isIOS) return ["Tap the <b>Share</b> button at the bottom of Safari", "Scroll down and tap <b>Add to Home Screen</b>", "Tap <b>Add</b>"];
    if (inAppBrowser) return ["Tap the <b>⋮</b> or <b>…</b> menu", "Choose <b>Open in Chrome</b>", "Then tap <b>Install app</b> in Chrome’s menu"];
    return ["Tap the <b>⋮</b> menu in the top corner of Chrome", "Tap <b>Install app</b> (or <b>Add to Home screen</b>)", "Tap <b>Install</b>"];
  }
  function showInstall() {
    if (standalone) return;
    const steps = $("#installSteps");
    if (deferredInstall) { steps.classList.remove("show"); $("#installNow").textContent = "Install app"; }
    else { steps.innerHTML = manualSteps().map((t) => "<li>" + t + "</li>").join(""); steps.classList.add("show"); $("#installNow").textContent = "Got it"; }
    $("#install").hidden = false;
  }
  function hideInstall(snooze) {
    $("#install").hidden = true;
    if (snooze) store.set("bolo.installLater", Date.now());
  }
  async function doInstall() {
    if (deferredInstall) {
      deferredInstall.prompt();
      const choice = await deferredInstall.userChoice.catch(() => ({}));
      deferredInstall = null;
      hideInstall(choice.outcome !== "accepted");
      if (choice.outcome === "accepted") $("#installFab").classList.remove("show");
    } else hideInstall(true);
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferredInstall = e;
    if (!$("#install").hidden) showInstall(); // refresh popup if already open
  });
  window.addEventListener("appinstalled", () => { deferredInstall = null; hideInstall(false); $("#installFab").classList.remove("show"); store.set("bolo.installed", true); toast("Bolo TV installed"); });
  $("#installNow").onclick = doInstall;
  $("#installLater").onclick = () => hideInstall(true);
  $("#install").onclick = (e) => { if (e.target.id === "install") hideInstall(true); };
  $("#installFab").onclick = showInstall;

  if (!standalone && (isIOS || isAndroid || matchMedia("(pointer:coarse)").matches || true)) {
    $("#installFab").classList.add("show");
    const last = store.get("bolo.installLater", 0);
    if (Date.now() - last > LATER_MS) setTimeout(showInstall, 2500);
  }

  /* ---------- Boot ---------- */
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const params = new URLSearchParams(location.search);
  const startTab = ["home", "afrikabelo", "pulse", "saved"].includes(params.get("tab")) ? params.get("tab") : "home";
  setTab(startTab);
})();
