(function GeniusProducers() {
    if (!Spicetify.Player || !Spicetify.Platform || !Spicetify.Topbar || !Spicetify.showNotification) {
        setTimeout(GeniusProducers, 100);
        return;
    }

    const GENIUS_ACCESS_TOKEN = "5q1S3r0M-fg_RlFko0bAPK6VH-bVt8mxelHXcZnJvkT_poiQy7V-hAQvftTMdSQY";
    
    let currentSongUri = null;
    let currentProducersText = "";
    
    function getCurrentTrack() {
        if (Spicetify.Player.data) {
            if (Spicetify.Player.data.item) return Spicetify.Player.data.item;
            if (Spicetify.Player.data.track) return Spicetify.Player.data.track;
        }
        if (typeof Spicetify.Player.getTrack === 'function') return Spicetify.Player.getTrack();
        return null;
    }
    
    async function fetchProducers(title, artist) {
        if (!title || !artist) return { text: "", error: "Нет названия или артиста" };
        
        let cleanTitle = title.replace(/\s-\s.+$/, "").replace(/\s\(.+$/, "").trim();
        const query = encodeURIComponent(`${cleanTitle} ${artist}`);
        
        try {
            // Убираем прокси. 403 выдавал Cloudflare, потому что он блокирует публичные прокси.
            // Вместо отправки токена в Headers (что вызывает сложный CORS OPTIONS-запрос, 
            // на котором всё и ломалось с "failed to fetch"), мы передаем токен прямо в URL!
            // Это делает запрос простым GET-запросом, который проходит напрямую.
            const searchUrl = `https://api.genius.com/search?q=${query}&access_token=${GENIUS_ACCESS_TOKEN}`;
            const searchRes = await fetch(searchUrl);
            
            if (!searchRes.ok) return { text: "", error: `Ошибка поиска: ${searchRes.status}` };
            
            const searchData = await searchRes.json();
            if (searchData.response.hits.length === 0) {
                return { text: "", error: `Трек не найден на Genius: ${cleanTitle} ${artist}` };
            }
            
            const songId = searchData.response.hits[0].result.id;
            const songUrl = `https://api.genius.com/songs/${songId}?access_token=${GENIUS_ACCESS_TOKEN}`;
            const songRes = await fetch(songUrl);
            
            if (!songRes.ok) return { text: "", error: `Ошибка деталей трека: ${songRes.status}` };
            
            const songData = await songRes.json();
            const producers = songData.response.song.producer_artists;

            if (producers && producers.length > 0) {
                const names = producers.map(p => p.name).join(', ');
                return { text: `(prod. by ${names})`, error: "" };
            } else {
                return { text: "", error: "На Genius у этого трека не указаны продюсеры" };
            }
        } catch (e) {
            console.error("GeniusProducers API Error:", e);
            return { text: "", error: `Сетевая ошибка: ${e.message}` };
        }
    }

    function injectDOM() {
        const titleEl = document.querySelector('.main-trackInfo-name') 
                     || document.querySelector('[data-testid="context-item-info-title"]') 
                     || document.querySelector('[data-testid="nowplaying-track-link"]');
                     
        if (!titleEl) return;
        
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

    async function update(showToast = false) {
        const item = getCurrentTrack();
        if (!item) {
            if (showToast) Spicetify.showNotification("Трек не играет или данные не найдены.");
            return;
        }
        
        let title = item.metadata?.title || item.name;
        let artist = item.metadata?.artist_name || (item.artists && item.artists[0]?.name);
        
        if (!title || !artist) {
            if (showToast) Spicetify.showNotification("Не удалось получить название или исполнителя.");
            return;
        }

        if (showToast) {
            Spicetify.showNotification(`Ищем продюсеров для ${title}...`);
        }

        const uri = item.uri || title;
        
        if (uri === currentSongUri && currentProducersText) {
            injectDOM();
            if (showToast) Spicetify.showNotification(currentProducersText);
            return;
        }

        currentSongUri = uri;
        currentProducersText = ""; 
        injectDOM(); 

        const res = await fetchProducers(title, artist);
        
        if (currentSongUri === uri) {
            currentProducersText = res.text;
            injectDOM();
            if (showToast) {
                if (res.text) {
                    Spicetify.showNotification(res.text);
                } else {
                    Spicetify.showNotification(res.error);
                }
            }
        }
    }

    new Spicetify.Topbar.Button(
        "Show Producers",
        `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
        () => {
            update(true);
        }
    );

    const observer = new MutationObserver(() => {
        const titleEl = document.querySelector('.main-trackInfo-name') 
                     || document.querySelector('[data-testid="context-item-info-title"]');
        if (titleEl) {
            const hasOurEl = document.getElementById("genius-producer-info");
            if (!hasOurEl && currentProducersText) {
                injectDOM();
            }
        }
    });

    function startObserver() {
        const playbar = document.querySelector('.main-nowPlayingBar-container') || document.body;
        observer.observe(playbar, { childList: true, subtree: true });
    }

    const initInterval = setInterval(() => {
        if (document.querySelector('.main-nowPlayingBar-container')) {
            clearInterval(initInterval);
            startObserver();
            update(false);
        }
    }, 500);

    Spicetify.Player.addEventListener("songchange", () => {
        update(false);
    });

})();
