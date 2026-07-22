// NAME: Genius Producers
// AUTHOR: pirkov
// DESCRIPTION: Shows track producers above the song title, using the Genius API
// VERSION: 1.0.1

(function GeniusProducers() {
    if (!Spicetify.Player || !Spicetify.Platform || !Spicetify.Menu || !Spicetify.PopupModal || !Spicetify.showNotification || !Spicetify.LocalStorage) {
        setTimeout(GeniusProducers, 100);
        return;
    }

    if (window.__geniusProducersLoaded) {
        console.log("[GeniusProducers] Already loaded, skipping re-init");
        return;
    }
    window.__geniusProducersLoaded = true;

    // --- STRINGS (i18n) ---
    const STRINGS = {
        en: {
            noTitleOrArtist: "Missing track title or artist",
            needToken: "Please set your Genius Access Token in the extension settings (Genius Producers Settings).",
            searchError: (code) => `Search error: ${code}`,
            trackNotFound: (q) => `Track not found on Genius: ${q}`,
            noProducers: "Genius has no producer credits for this track",
            networkError: (msg) => `Network error: ${msg}`,
            settingsTitle: "Genius Producers Settings",
            tokenLabel: "Genius API Access Token",
            tokenPlaceholder: "Enter your Genius API Access Token...",
            proxyLabel: "Proxy URL (Optional)",
            proxyPlaceholder: "https://your-proxy.com",
            enableLabel: "Enable Extension",
            disableLocalLabel: "Disable on local files",
            langLabel: "Language",
            testButton: "Test Search (Manual)",
            saveButton: "Save",
            settingsSaved: "Settings saved!",
            searching: (title) => `Searching producers for ${title}...`,
            noTrackPlaying: "No track playing or data not found.",
            tokenInvalid: "Invalid Token (spaces or empty)",
            tokenValid: "Token seems ok",
            testNoMatch: "Genius has no exact match for this track",
            songDetailsError: (code) => `Song details error: ${code}`
        },
        ru: {
            noTitleOrArtist: "Нет названия или артиста",
            needToken: "Пожалуйста, укажите ваш Genius Access Token в настройках расширения (Genius Producers Settings).",
            searchError: (code) => `Ошибка поиска: ${code}`,
            trackNotFound: (q) => `Трек не найден на Genius: ${q}`,
            noProducers: "На Genius у этого трека не указаны продюсеры",
            networkError: (msg) => `Сетевая ошибка: ${msg}`,
            settingsTitle: "Настройки Genius Producers",
            tokenLabel: "Genius API Access Token",
            tokenPlaceholder: "Введите ваш Genius API Access Token...",
            proxyLabel: "URL Прокси (Опционально)",
            proxyPlaceholder: "https://your-proxy.com",
            enableLabel: "Включить расширение",
            disableLocalLabel: "Отключить для локальных файлов",
            langLabel: "Язык",
            testButton: "Тестовый поиск (вручную)",
            saveButton: "Сохранить",
            settingsSaved: "Настройки сохранены!",
            searching: (title) => `Ищем продюсеров для ${title}...`,
            noTrackPlaying: "Трек не играет или данные не найдены.",
            tokenInvalid: "Неверный токен (пустой или с пробелами)",
            tokenValid: "Токен выглядит нормально",
            testNoMatch: "На Genius нет точного совпадения для этого трека",
            songDetailsError: (code) => `Ошибка деталей трека: ${code}`
        }
    };

    function getLang() {
        let lang = Spicetify.LocalStorage.get("genius_producers_lang") || "auto";
        if (lang === "auto") {
            const sysLang = (Spicetify.Locale?.getLocale?.() || navigator.language).substring(0, 2).toLowerCase();
            return STRINGS[sysLang] ? sysLang : "en";
        }
        return STRINGS[lang] ? lang : "en";
    }

    function _(key, ...args) {
        const lang = getLang();
        const val = STRINGS[lang][key] || STRINGS["en"][key];
        return typeof val === "function" ? val(...args) : val;
    }

    // --- CONFIG & STATE ---
    const TITLE_SELECTORS = [
        '.main-trackInfo-name',
        '[data-testid="context-item-info-title"]',
        '[data-testid="nowplaying-track-link"]'
    ];

    let currentSongUri = null;
    let currentProducersText = "";
    let activeAbortController = null;
    let lastRequestTime = 0;

    // --- CACHING ---
    const CACHE_KEY = "genius_producers_cache";
    const MAX_CACHE_SIZE = 300;
    const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
    const NEGATIVE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

    function getCache() {
        try {
            return JSON.parse(Spicetify.LocalStorage.get(CACHE_KEY) || "{}");
        } catch {
            return {};
        }
    }

    function saveCache(cache) {
        Spicetify.LocalStorage.set(CACHE_KEY, JSON.stringify(cache));
    }

    function getFromCache(uri) {
        const cache = getCache();
        const entry = cache[uri];
        if (entry) {
            const ttl = entry.negative ? NEGATIVE_CACHE_TTL : CACHE_TTL;
            if ((Date.now() - entry.ts) < ttl) {
                return entry.text;
            } else {
                delete cache[uri];
                saveCache(cache);
            }
        }
        return null;
    }

    function setToCache(uri, text) {
        const cache = getCache();
        cache[uri] = { text, ts: Date.now(), negative: !text };
        
        const keys = Object.keys(cache);
        if (keys.length > MAX_CACHE_SIZE) {
            keys.sort((a, b) => cache[a].ts - cache[b].ts);
            for (let i = 0; i < keys.length - MAX_CACHE_SIZE; i++) {
                delete cache[keys[i]];
            }
        }
        saveCache(cache);
    }

    // --- LEVENSHTEIN DISTANCE ---
    function levenshtein(a, b) {
        if(a.length === 0) return b.length; 
        if(b.length === 0) return a.length; 
        var matrix = [];
        for(let i = 0; i <= b.length; i++){ matrix[i] = [i]; }
        for(let j = 0; j <= a.length; j++){ matrix[0][j] = j; }
        for(let i = 1; i <= b.length; i++){
            for(let j = 1; j <= a.length; j++){
                if(b.charAt(i-1) == a.charAt(j-1)){
                    matrix[i][j] = matrix[i-1][j-1];
                } else {
                    matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, Math.min(matrix[i][j-1] + 1, matrix[i-1][j] + 1));
                }
            }
        }
        return matrix[b.length][a.length];
    }

    function normalizeString(str) {
        return str.toLowerCase().replace(/[^\w\sа-яё]/gi, '').replace(/\s+/g, ' ').trim();
    }

    function cleanBrackets(str) {
        if (!str) return "";
        return str.replace(/\s-\s.+$/, "").replace(/\s\(.+$/, "").replace(/\s\[.+\]$/, "").trim();
    }

    function isMatchingResult(candidate, title, artist) {
        const normTitle = normalizeString(cleanBrackets(title));
        const normArtist = normalizeString(cleanBrackets(artist));
        
        const candTitle = normalizeString(cleanBrackets(candidate.title));
        const candArtist = normalizeString(cleanBrackets(candidate.primary_artist?.name));

        // Allow some difference based on string length
        const titleDist = levenshtein(normTitle, candTitle);
        const artistDist = levenshtein(normArtist, candArtist);
        
        const titleThreshold = Math.max(2, normTitle.length * 0.2);
        const artistThreshold = Math.max(2, normArtist.length * 0.3);

        return titleDist <= titleThreshold && artistDist <= artistThreshold;
    }

    // --- FETCHING ---
    async function fetchProducers(title, artist, isManual = false) {
        if (!title || !artist) return { text: "", error: _("noTitleOrArtist") };

        const token = (Spicetify.LocalStorage.get("genius_producers_token") || "").trim();
        if (!token) return { text: "", error: _("needToken") };

        const proxyUrl = (Spicetify.LocalStorage.get("genius_producers_proxy") || "").trim();

        // Throttling: min 1 sec between requests
        const now = Date.now();
        if (!isManual && now - lastRequestTime < 1000) {
            await new Promise(resolve => setTimeout(resolve, 1000 - (now - lastRequestTime)));
        }
        lastRequestTime = Date.now();

        if (activeAbortController) {
            activeAbortController.abort();
        }
        activeAbortController = new AbortController();
        const signal = activeAbortController.signal;

        let cleanTitle = cleanBrackets(title);
        const query = encodeURIComponent(`${cleanTitle} ${artist}`);

        try {
            const timeoutId = setTimeout(() => activeAbortController.abort(), 10000); // 10s timeout
            
            let searchReqUrl = `https://api.genius.com/search?q=${query}&access_token=${token}`;
            let fetchOpts = { signal };

            if (proxyUrl) {
                // If using proxy, proxy handles CORS. Pass token in header.
                searchReqUrl = `${proxyUrl}/search?q=${query}`;
                fetchOpts.headers = { "Authorization": `Bearer ${token}` };
            }

            const searchRes = await fetch(searchReqUrl, fetchOpts);
            if (!searchRes.ok) {
                clearTimeout(timeoutId);
                return { text: "", error: _("searchError", searchRes.status) };
            }

            const searchData = await searchRes.json();
            
            let matchedHit = null;
            if (searchData.response?.hits) {
                for (let i = 0; i < Math.min(5, searchData.response.hits.length); i++) {
                    const hit = searchData.response.hits[i].result;
                    if (isMatchingResult(hit, title, artist)) {
                        matchedHit = hit;
                        break;
                    }
                }
            }

            if (!matchedHit) {
                clearTimeout(timeoutId);
                return { text: "", error: isManual ? _("testNoMatch") : "" }; // Silent if not manual
            }

            const songId = matchedHit.id;
            let songReqUrl = `https://api.genius.com/songs/${songId}?access_token=${token}`;
            if (proxyUrl) {
                songReqUrl = `${proxyUrl}/songs/${songId}`;
            }

            const songRes = await fetch(songReqUrl, fetchOpts);
            clearTimeout(timeoutId);

            if (!songRes.ok) return { text: "", error: _("songDetailsError", songRes.status) };

            const songData = await songRes.json();
            const producers = songData.response?.song?.producer_artists;

            if (producers && producers.length > 0) {
                const names = producers.map(p => p.name).join(', ');
                return { text: `(prod. by ${names})`, error: "" };
            } else {
                return { text: "", error: _("noProducers") };
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                return { text: "", error: "Aborted", aborted: true };
            }
            return { text: "", error: _("networkError", proxyUrl ? "Proxy unavailable or " + e.message : "CORS or " + e.message) };
        }
    }

    // --- DOM LOGIC ---
    function findTitleElement() {
        for (const selector of TITLE_SELECTORS) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
        return null;
    }

    let searchAttempts = 0;

    function injectDOM() {
        const titleEl = findTitleElement();
        if (!titleEl) {
            if (searchAttempts < 10) {
                searchAttempts++;
                setTimeout(injectDOM, 500);
            } else if (searchAttempts === 10) {
                console.warn("[GeniusProducers] Could not find track title element, DOM may have changed");
                searchAttempts++; // stop warning
            }
            return;
        }
        searchAttempts = 0;

        let producerEl = document.getElementById("genius-producer-info");
        
        if (!currentProducersText) {
            if (producerEl) producerEl.remove();
            return;
        }

        if (!producerEl) {
            producerEl = document.createElement("div");
            producerEl.id = "genius-producer-info";
            producerEl.style.fontSize = "0.75rem";
            producerEl.style.color = "var(--text-subdued, #b3b3b3)";
            producerEl.style.marginTop = "2px";
            producerEl.style.marginBottom = "2px";
            producerEl.style.lineHeight = "1.2";
            producerEl.style.width = "100%"; 
            producerEl.style.display = "block";
            
            titleEl.parentNode.insertBefore(producerEl, titleEl.nextSibling);
        }
        producerEl.innerText = currentProducersText;
    }

    function getCurrentTrack() {
        if (Spicetify.Player.data) {
            if (Spicetify.Player.data.item) return Spicetify.Player.data.item;
            if (Spicetify.Player.data.track) return Spicetify.Player.data.track;
        }
        if (typeof Spicetify.Player.getTrack === 'function') return Spicetify.Player.getTrack();
        return null;
    }

    async function update(showToast = false, forceRefresh = false) {
        const isEnabled = Spicetify.LocalStorage.get("genius_producers_enabled") !== "false";
        if (!isEnabled) {
            currentProducersText = "";
            injectDOM();
            return;
        }

        const item = getCurrentTrack();
        if (!item) {
            if (showToast) Spicetify.showNotification(_("noTrackPlaying"));
            return;
        }

        const type = item.type || item.track_type;
        const uri = item.uri || "";
        const isLocal = uri.startsWith("spotify:local:") || item.is_local;
        const isAd = uri.startsWith("spotify:ad:") || type === "ad";

        if (isAd) return;

        if (type && type !== "track" && type !== "local" && type !== "song") { // exclude podcast, ad
            console.info("[GeniusProducers] Skipped unknown content type:", type, uri);
            return;
        }

        const disableLocal = Spicetify.LocalStorage.get("genius_producers_disable_local") !== "false";
        if (isLocal && disableLocal) {
            currentProducersText = "";
            injectDOM();
            return;
        }

        let title = item.metadata?.title || item.name;
        let artist = item.metadata?.artist_name || (item.artists && item.artists[0]?.name);

        if (!title || !artist) {
            if (showToast) Spicetify.showNotification(_("noTitleOrArtist"));
            return;
        }

        if (!forceRefresh && uri === currentSongUri && currentProducersText) {
            injectDOM();
            if (showToast) Spicetify.showNotification(currentProducersText);
            return;
        }

        if (forceRefresh) {
            const cache = getCache();
            delete cache[uri];
            saveCache(cache);
        }

        currentSongUri = uri;
        
        const cached = getFromCache(uri);
        if (!forceRefresh && cached !== null) {
            currentProducersText = cached;
            injectDOM();
            if (showToast && cached) Spicetify.showNotification(cached);
            return;
        }

        if (showToast) {
            Spicetify.showNotification(_("searching", title));
        }

        currentProducersText = ""; 
        injectDOM(); 

        const res = await fetchProducers(title, artist, showToast);
        if (res.aborted) return;
        
        if (currentSongUri === uri) {
            currentProducersText = res.text;
            setToCache(uri, res.text);
            injectDOM();
            if (showToast) {
                if (res.text) {
                    Spicetify.showNotification(res.text);
                } else if (res.error) {
                    Spicetify.showNotification(res.error);
                }
            }
        }
    }

    // --- SETTINGS UI ---
    function injectSettingsCSS() {
        if (document.getElementById("genius-settings-css")) return;
        const style = document.createElement("style");
        style.id = "genius-settings-css";
        style.innerHTML = `
            .genius-settings-container { display: flex; flex-direction: column; gap: 15px; }
            .genius-settings-label { font-weight: bold; color: var(--spice-text); display: flex; flex-direction: column; gap: 5px; }
            .genius-settings-input, .genius-settings-select { width: 100%; padding: 10px; border-radius: 4px; border: 1px solid var(--spice-button-disabled); background: var(--spice-main-elevated); color: var(--spice-text); box-sizing: border-box; }
            .genius-settings-btn { padding: 8px 16px; border-radius: 20px; border: none; cursor: pointer; color: var(--spice-text); }
            .genius-settings-btn-primary { background: var(--spice-button); }
            .genius-settings-btn-secondary { background: var(--spice-button-disabled); }
            .genius-settings-row { display: flex; align-items: center; justify-content: space-between; }
            .genius-settings-hint { font-size: 0.8em; color: var(--spice-subtext); margin-top: -5px; }
            .genius-settings-link { color: var(--spice-button); text-decoration: none; }
        `;
        document.head.appendChild(style);
    }

    function openSettings() {
        injectSettingsCSS();
        const container = document.createElement("div");
        container.className = "genius-settings-container";

        // Enable Toggle
        const enableRow = document.createElement("div");
        enableRow.className = "genius-settings-row";
        enableRow.innerHTML = `<span style="color: var(--spice-text); font-weight: bold;">${_("enableLabel")}</span>`;
        const enableCheck = document.createElement("input");
        enableCheck.type = "checkbox";
        enableCheck.checked = Spicetify.LocalStorage.get("genius_producers_enabled") !== "false";
        enableRow.appendChild(enableCheck);
        container.appendChild(enableRow);

        // Disable on Local Toggle
        const localRow = document.createElement("div");
        localRow.className = "genius-settings-row";
        localRow.innerHTML = `<span style="color: var(--spice-text); font-weight: bold;">${_("disableLocalLabel")}</span>`;
        const localCheck = document.createElement("input");
        localCheck.type = "checkbox";
        localCheck.checked = Spicetify.LocalStorage.get("genius_producers_disable_local") !== "false";
        localRow.appendChild(localCheck);
        container.appendChild(localRow);

        // Language Select
        const langLabel = document.createElement("label");
        langLabel.className = "genius-settings-label";
        langLabel.innerText = _("langLabel");
        const langSelect = document.createElement("select");
        langSelect.className = "genius-settings-select";
        const langs = [
            {v: "auto", t: "Auto"},
            {v: "en", t: "English"},
            {v: "ru", t: "Русский"}
        ];
        const currentLang = Spicetify.LocalStorage.get("genius_producers_lang") || "auto";
        langs.forEach(l => {
            const opt = document.createElement("option");
            opt.value = l.v;
            opt.innerText = l.t;
            if (l.v === currentLang) opt.selected = true;
            langSelect.appendChild(opt);
        });
        langLabel.appendChild(langSelect);
        container.appendChild(langLabel);

        // Token Input
        const tokenLabel = document.createElement("label");
        tokenLabel.className = "genius-settings-label";
        tokenLabel.innerHTML = `<span>${_("tokenLabel")}</span><span class="genius-settings-hint"><a href="https://genius.com/api-clients" target="_blank" class="genius-settings-link">How to get a Genius API token</a></span>`;
        const tokenInput = document.createElement("input");
        tokenInput.className = "genius-settings-input";
        tokenInput.type = "text";
        tokenInput.value = Spicetify.LocalStorage.get("genius_producers_token") || "";
        tokenInput.placeholder = _("tokenPlaceholder");
        tokenLabel.appendChild(tokenInput);
        
        const tokenStatus = document.createElement("div");
        tokenStatus.style.fontSize = "0.8em";
        tokenStatus.style.marginTop = "5px";
        tokenLabel.appendChild(tokenStatus);
        
        tokenInput.addEventListener('input', () => {
            const val = tokenInput.value;
            if (!val.trim() || val.includes(' ')) {
                tokenStatus.innerText = _("tokenInvalid");
                tokenStatus.style.color = "#E22134";
            } else {
                tokenStatus.innerText = _("tokenValid");
                tokenStatus.style.color = "#1DB954";
            }
        });
        container.appendChild(tokenLabel);

        // Proxy Input
        const proxyLabel = document.createElement("label");
        proxyLabel.className = "genius-settings-label";
        proxyLabel.innerHTML = `<span>${_("proxyLabel")}</span><span class="genius-settings-hint">Required unless CORS works. E.g. Cloudflare Worker</span>`;
        const proxyInput = document.createElement("input");
        proxyInput.className = "genius-settings-input";
        proxyInput.type = "text";
        proxyInput.value = Spicetify.LocalStorage.get("genius_producers_proxy") || "";
        proxyInput.placeholder = _("proxyPlaceholder");
        proxyLabel.appendChild(proxyInput);
        container.appendChild(proxyLabel);

        // Buttons
        const buttonsDiv = document.createElement("div");
        buttonsDiv.style.display = "flex";
        buttonsDiv.style.justifyContent = "flex-end";
        buttonsDiv.style.gap = "10px";
        buttonsDiv.style.marginTop = "10px";

        const testBtn = document.createElement("button");
        testBtn.className = "genius-settings-btn genius-settings-btn-secondary";
        testBtn.innerText = _("testButton");
        testBtn.onclick = () => {
            Spicetify.LocalStorage.set("genius_producers_token", tokenInput.value.trim());
            Spicetify.LocalStorage.set("genius_producers_proxy", proxyInput.value.trim());
            Spicetify.LocalStorage.set("genius_producers_lang", langSelect.value);
            Spicetify.LocalStorage.set("genius_producers_enabled", enableCheck.checked ? "true" : "false");
            Spicetify.LocalStorage.set("genius_producers_disable_local", localCheck.checked ? "true" : "false");
            update(true, true);
        };

        const saveBtn = document.createElement("button");
        saveBtn.className = "genius-settings-btn genius-settings-btn-primary";
        saveBtn.innerText = _("saveButton");
        saveBtn.onclick = () => {
            Spicetify.LocalStorage.set("genius_producers_token", tokenInput.value.trim());
            Spicetify.LocalStorage.set("genius_producers_proxy", proxyInput.value.trim());
            Spicetify.LocalStorage.set("genius_producers_lang", langSelect.value);
            Spicetify.LocalStorage.set("genius_producers_enabled", enableCheck.checked ? "true" : "false");
            Spicetify.LocalStorage.set("genius_producers_disable_local", localCheck.checked ? "true" : "false");
            Spicetify.PopupModal.hide();
            Spicetify.showNotification(_("settingsSaved"));
            update(false);
        };

        buttonsDiv.appendChild(testBtn);
        buttonsDiv.appendChild(saveBtn);
        container.appendChild(buttonsDiv);

        Spicetify.PopupModal.display({
            title: _("settingsTitle"),
            content: container,
            isLarge: false
        });
    }

    const menuItem = new Spicetify.Menu.Item(
        "Genius Producers Settings",
        false,
        openSettings,
        `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`
    );
    menuItem.register();

    // --- LIFECYCLE ---
    let debounceTimer;
    const observer = new MutationObserver((mutations) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const titleEl = findTitleElement();
            if (titleEl) {
                const hasOurEl = document.getElementById("genius-producer-info");
                if (!hasOurEl && currentProducersText) {
                    injectDOM();
                }
            }
        }, 200);
    });

    function startObserver() {
        const playbar = document.querySelector('.main-nowPlayingBar-container') || document.body;
        observer.observe(playbar, { childList: true, subtree: true, attributes: true, characterData: true });
    }

    const initInterval = setInterval(() => {
        if (document.querySelector('.main-nowPlayingBar-container')) {
            clearInterval(initInterval);
            startObserver();
            update(false);
        }
    }, 500);

    function onSongChange() {
        update(false);
    }
    Spicetify.Player.addEventListener("songchange", onSongChange);

    // CLEANUP EXPORT (for hot-reload testing)
    window.__geniusProducersCleanup = () => {
        try { observer.disconnect(); } catch (e) {}
        try { clearInterval(initInterval); } catch (e) {}
        try { clearTimeout(debounceTimer); } catch (e) {}
        try { Spicetify.Player.removeEventListener("songchange", onSongChange); } catch (e) {}
        try { menuItem.deregister?.(); } catch (e) { console.warn("[GeniusProducers] menu cleanup failed", e); }
        try {
            const el = document.getElementById("genius-producer-info");
            if (el) el.remove();
        } catch (e) {}
        delete window.__geniusProducersLoaded;
    };

})();
