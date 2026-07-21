(function GeniusProducers() {
    if (!Spicetify.Player || !Spicetify.Platform || !Spicetify.Menu || !Spicetify.PopupModal || !Spicetify.showNotification || !Spicetify.LocalStorage) {
        setTimeout(GeniusProducers, 100);
        return;
    }

    function getToken() {
        return Spicetify.LocalStorage.get("genius_producers_token") || "";
    }
    
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
        const accessToken = getToken();
        if (!accessToken) {
            return { text: "", error: "Пожалуйста, укажите ваш Genius Access Token в настройках профиля (Genius Producers Settings)." };
        }
        
        try {
            const searchUrl = `https://api.genius.com/search?q=${query}&access_token=${accessToken}`;
            const searchRes = await fetch(searchUrl);
            
            if (!searchRes.ok) return { text: "", error: `Ошибка поиска: ${searchRes.status}` };
            
            const searchData = await searchRes.json();
            if (searchData.response.hits.length === 0) {
                return { text: "", error: `Трек не найден на Genius: ${cleanTitle} ${artist}` };
            }
            
            const songId = searchData.response.hits[0].result.id;
            const songUrl = `https://api.genius.com/songs/${songId}?access_token=${accessToken}`;
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

    // --- НАСТРОЙКИ (ПОПАП И МЕНЮ) ---
    function openSettings() {
        const container = document.createElement("div");
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "15px";

        const label = document.createElement("label");
        label.innerText = "Genius API Access Token";
        label.style.fontWeight = "bold";
        label.style.color = "var(--spice-text)";

        const input = document.createElement("input");
        input.type = "text";
        input.value = Spicetify.LocalStorage.get("genius_producers_token") || "";
        input.placeholder = "Введите ваш Genius API Access Token...";
        input.style.width = "100%";
        input.style.padding = "10px";
        input.style.borderRadius = "4px";
        input.style.border = "1px solid var(--spice-button-disabled)";
        input.style.background = "var(--spice-main-elevated)";
        input.style.color = "var(--spice-text)";

        const buttonsDiv = document.createElement("div");
        buttonsDiv.style.display = "flex";
        buttonsDiv.style.justifyContent = "flex-end";
        buttonsDiv.style.gap = "10px";
        buttonsDiv.style.marginTop = "10px";

        const testBtn = document.createElement("button");
        testBtn.innerText = "Test Search (Manual)";
        testBtn.style.padding = "8px 16px";
        testBtn.style.borderRadius = "20px";
        testBtn.style.background = "var(--spice-button-disabled)";
        testBtn.style.color = "var(--spice-text)";
        testBtn.style.border = "none";
        testBtn.style.cursor = "pointer";

        testBtn.onclick = () => {
            if (input.value.trim()) {
                Spicetify.LocalStorage.set("genius_producers_token", input.value.trim());
            } else {
                Spicetify.LocalStorage.remove("genius_producers_token");
            }
            update(true);
        };

        const saveBtn = document.createElement("button");
        saveBtn.innerText = "Save";
        saveBtn.style.padding = "8px 16px";
        saveBtn.style.borderRadius = "20px";
        saveBtn.style.background = "var(--spice-button)";
        saveBtn.style.color = "var(--spice-text)";
        saveBtn.style.border = "none";
        saveBtn.style.cursor = "pointer";

        saveBtn.onclick = () => {
            if (input.value.trim()) {
                Spicetify.LocalStorage.set("genius_producers_token", input.value.trim());
            } else {
                Spicetify.LocalStorage.remove("genius_producers_token");
            }
            Spicetify.PopupModal.hide();
            Spicetify.showNotification("Settings saved!");
            update(false);
        };

        container.appendChild(label);
        container.appendChild(input);
        buttonsDiv.appendChild(testBtn);
        buttonsDiv.appendChild(saveBtn);
        container.appendChild(buttonsDiv);

        Spicetify.PopupModal.display({
            title: "Genius Producers Settings",
            content: container,
            isLarge: false
        });
    }

    new Spicetify.Menu.Item(
        "Genius Producers Settings",
        false,
        openSettings,
        `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`
    ).register();

    // ---------------------------------

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
