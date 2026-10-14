/* ==========================================================================
   Aliança do Bem Campinas - script principal
   Script clássico (sem ES modules) para funcionar abrindo o index.html direto
   no navegador (file://). Todos os recursos usados são nativos do navegador.
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    /* ==========================================================================
       0. UTILITÁRIOS
       ========================================================================== */
    const $ = (selector, context = document) => context.querySelector(selector);
    const $$ = (selector, context = document) => Array.from(context.querySelectorAll(selector));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Escapa texto digitado pelo usuário antes de inserir no HTML (evita XSS)
    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[char]);
    }

    function createId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    // Gera protocolos no formato PREFIXO-ANO-XXXX (ex.: ADB-2026-7K2F)
    function createProtocol(prefix) {
        const code = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
        return `${prefix}-${new Date().getFullYear()}-${code}`;
    }

    // Data/hora local no formato aceito por <input type="datetime-local">
    function nowLocalDateTime() {
        const now = new Date();
        return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const relativeFormat = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
    const numberFormat = new Intl.NumberFormat("pt-BR");

    function timeAgo(isoDate) {
        const seconds = Math.round((new Date(isoDate).getTime() - Date.now()) / 1000);
        const units = [
            ["year", 31536000], ["month", 2592000], ["week", 604800],
            ["day", 86400], ["hour", 3600], ["minute", 60]
        ];
        for (const [unit, size] of units) {
            if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
        }
        return "agora mesmo";
    }

    function formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : dateTimeFormat.format(date);
    }

    /* ==========================================================================
       1. ARMAZENAMENTO LOCAL (localStorage com proteção contra erros)
       ========================================================================== */
    const storage = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch {
                return fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch {
                return false; // cota cheia, modo privado ou armazenamento bloqueado
            }
        }
    };

    // Coleção salva no navegador; se a cota estourar, descarta os registros mais antigos
    function createCollection(key, maxItems) {
        return {
            all() {
                const list = storage.get(key, []);
                return Array.isArray(list) ? list : [];
            },
            save(list) {
                let items = list.slice(0, maxItems);
                while (!storage.set(key, items)) {
                    if (items.length <= 1) return false;
                    items = items.slice(0, -1);
                }
                return true;
            },
            add(item) {
                return this.save([item, ...this.all()]);
            },
            update(id, changes) {
                return this.save(this.all().map((item) => (item.id === id ? { ...item, ...changes } : item)));
            }
        };
    }

    const alertsStore = createCollection("adb:alertas", 30);
    const reportsStore = createCollection("adb:denuncias", 20);

    /* ==========================================================================
       2. NOTIFICAÇÕES (TOASTS)
       ========================================================================== */
    const toastRegion = $(".toast-region");
    const TOAST_ICONS = { success: "✅", error: "⚠️", info: "ℹ️" };
    const MAX_TOASTS = 2;

    function toast(message, { type = "success", title = "", duration = 6000 } = {}) {
        if (!toastRegion) return;
        const item = document.createElement("div");
        item.className = `toast toast-${type}`;
        item.innerHTML = `
            <span class="toast-icon" aria-hidden="true">${TOAST_ICONS[type] || ""}</span>
            <div>
                ${title ? `<strong class="toast-title">${escapeHTML(title)}</strong>` : ""}
                <p class="toast-message">${escapeHTML(message)}</p>
            </div>
            <button type="button" class="toast-close" aria-label="Fechar notificação">&times;</button>`;

        const remove = () => {
            if (item.classList.contains("is-leaving")) return;
            item.classList.add("is-leaving");
            item.addEventListener("animationend", () => item.remove(), { once: true });
            setTimeout(() => item.remove(), 400); // garantia caso a animação esteja desativada
        };

        $(".toast-close", item).addEventListener("click", remove);

        // Mantém no máximo 2 notificações empilhadas (remove a mais antiga)
        const visible = $$(".toast:not(.is-leaving)", toastRegion);
        if (visible.length >= MAX_TOASTS) visible[0].remove();

        toastRegion.appendChild(item);
        setTimeout(remove, duration);
    }

    function setButtonLoading(button, isLoading) {
        if (!button) return;
        button.classList.toggle("is-loading", isLoading);
        button.disabled = isLoading;
        button.setAttribute("aria-busy", String(isLoading));
    }

    /* ==========================================================================
       3. CABEÇALHO: MENU MOBILE, HEADER AO ROLAR, SCROLL-SPY E VOLTAR AO TOPO
       ========================================================================== */
    const header = $(".main-header");
    const navToggle = $(".nav-toggle");
    const navMenu = $(".nav-menu");
    const backToTop = $(".back-to-top");

    function setMenu(open) {
        if (!navToggle || !navMenu) return;
        navMenu.classList.toggle("is-open", open);
        navToggle.setAttribute("aria-expanded", String(open));
        navToggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
        document.body.classList.toggle("nav-open", open);
    }

    if (navToggle && navMenu) {
        navToggle.addEventListener("click", () => setMenu(!navMenu.classList.contains("is-open")));
        $$("a", navMenu).forEach((link) => link.addEventListener("click", () => setMenu(false)));
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && navMenu.classList.contains("is-open")) {
                setMenu(false);
                navToggle.focus();
            }
        });
        window.matchMedia("(min-width: 1101px)").addEventListener("change", (event) => {
            if (event.matches) setMenu(false);
        });
    }

    let scrollTicking = false;
    function onScroll() {
        if (scrollTicking) return;
        scrollTicking = true;
        requestAnimationFrame(() => {
            const y = window.scrollY;
            if (header) header.classList.toggle("is-scrolled", y > 40);
            if (backToTop) backToTop.classList.toggle("is-visible", y > 700);
            scrollTicking = false;
        });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (backToTop) {
        backToTop.addEventListener("click", () => {
            window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
        });
    }

    // Destaca no menu a seção que está visível na tela
    const navLinks = $$(".nav-menu a[href^='#']");
    if (navLinks.length && "IntersectionObserver" in window) {
        const spy = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                navLinks.forEach((link) => {
                    const isCurrent = link.getAttribute("href") === `#${entry.target.id}`;
                    link.classList.toggle("is-active", isCurrent);
                    if (isCurrent) link.setAttribute("aria-current", "true");
                    else link.removeAttribute("aria-current");
                });
            });
        }, { rootMargin: "-45% 0px -50% 0px" });

        navLinks.forEach((link) => {
            const section = document.getElementById(link.getAttribute("href").slice(1));
            if (section) spy.observe(section);
        });
        // O hero não tem link no menu: ao voltar para ele, nenhum item fica destacado
        const hero = $("#destaque");
        if (hero) spy.observe(hero);
    }

    const yearEl = $("#ano-atual");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    /* ==========================================================================
       4. CARROSSEL DE IMAGENS DO HERO
       ========================================================================== */
    (function initHeroCarousel() {
        const root = $(".hero-carousel");
        if (!root) return;

        const slides = $$(".carousel-slide", root);
        const dotsWrap = $(".carousel-dots", root);
        if (slides.length < 2) return;

        const INTERVAL = 5000;
        let current = 0;
        let timer = null;

        const dots = slides.map((_, index) => {
            const dot = document.createElement("button");
            dot.type = "button";
            dot.className = "carousel-dot";
            dot.setAttribute("aria-label", `Mostrar imagem ${index + 1}`);
            dot.addEventListener("click", () => { show(index); restart(); });
            dotsWrap.appendChild(dot);
            return dot;
        });

        function show(index) {
            slides[current].classList.remove("active");
            slides[current].setAttribute("aria-hidden", "true");
            dots[current].removeAttribute("aria-current");

            current = (index + slides.length) % slides.length;

            slides[current].classList.add("active");
            slides[current].removeAttribute("aria-hidden");
            dots[current].setAttribute("aria-current", "true");
        }

        function start() {
            if (timer || reducedMotion.matches || document.hidden) return;
            timer = setInterval(() => show(current + 1), INTERVAL);
        }

        function stop() {
            clearInterval(timer);
            timer = null;
        }

        // Reinicia a contagem após navegação manual (evita trocar logo em seguida)
        function restart() {
            stop();
            start();
        }

        $(".btn-next", root).addEventListener("click", () => { show(current + 1); restart(); });
        $(".btn-prev", root).addEventListener("click", () => { show(current - 1); restart(); });
        root.addEventListener("mouseenter", stop);
        root.addEventListener("mouseleave", start);
        root.addEventListener("focusin", stop);
        root.addEventListener("focusout", start);
        document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

        show(0);
        start();
    })();

    /* ==========================================================================
       5. CONTADORES DE IMPACTO E ANIMAÇÃO DE ENTRADA (INTERSECTION OBSERVER)
       ========================================================================== */
    function runCounters() {
        $$(".counter-number").forEach((counter) => {
            const target = Number(counter.dataset.target) || 0;
            const finalText = `${numberFormat.format(target)}+`;

            if (reducedMotion.matches) {
                counter.textContent = finalText;
                return;
            }

            const duration = 1800;
            const startTime = performance.now();
            const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

            function frame(now) {
                const progress = Math.min((now - startTime) / duration, 1);
                counter.textContent = numberFormat.format(Math.round(target * easeOutCubic(progress)));
                if (progress < 1) requestAnimationFrame(frame);
                else counter.textContent = finalText;
            }
            requestAnimationFrame(frame);
        });
    }

    const revealElements = $$(".scroll-reveal");
    if ("IntersectionObserver" in window) {
        const revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("active");
                if (entry.target.id === "impacto") runCounters();
                observer.unobserve(entry.target); // anima apenas uma vez
            });
        }, { threshold: 0.12 });

        revealElements.forEach((element) => revealObserver.observe(element));
    } else {
        revealElements.forEach((element) => element.classList.add("active"));
        runCounters();
    }

    /* ==========================================================================
       6. VALIDAÇÃO DE FORMULÁRIOS (CONSTRAINT VALIDATION API)
       ========================================================================== */
    function getFieldMessage(input) {
        const { validity } = input;
        if (validity.valueMissing) {
            if (input.type === "file") return "Adicione uma foto do animal.";
            if (input.type === "radio") return "Selecione uma das opções.";
            if (input.type === "checkbox") return "Marque esta opção para continuar.";
            if (input.tagName === "SELECT") return "Selecione uma opção.";
            return "Este campo é obrigatório.";
        }
        if (validity.tooShort) return `Digite pelo menos ${input.minLength} caracteres.`;
        if (validity.typeMismatch && input.type === "email") return "Informe um e-mail válido.";
        if (validity.patternMismatch) return input.dataset.patternMessage || "Formato inválido.";
        if (validity.rangeOverflow) return input.dataset.maxMessage || "Valor acima do permitido.";
        if (validity.customError) return input.validationMessage;
        return "Verifique este campo.";
    }

    function setFieldError(input, message) {
        const field = input.closest(".field");
        if (!field) return;
        field.classList.add("is-invalid");
        const error = $(".field-error", field);
        if (error) error.textContent = message;
        const group = input.type === "radio" ? $$(`input[name="${input.name}"]`, input.form) : [input];
        group.forEach((el) => el.setAttribute("aria-invalid", "true"));
    }

    function clearFieldError(input) {
        const field = input.closest(".field");
        if (!field) return;
        field.classList.remove("is-invalid");
        const error = $(".field-error", field);
        if (error) error.textContent = "";
        const group = input.type === "radio" ? $$(`input[name="${input.name}"]`, input.form) : [input];
        group.forEach((el) => el.removeAttribute("aria-invalid"));
    }

    function validateForm(form) {
        let firstInvalid = null;
        const checkedGroups = new Set();

        Array.from(form.elements).forEach((input) => {
            if (!input.willValidate) return;
            if (input.type === "radio") {
                if (checkedGroups.has(input.name)) return;
                checkedGroups.add(input.name);
            }
            if (input.checkValidity()) {
                clearFieldError(input);
            } else {
                setFieldError(input, getFieldMessage(input));
                if (!firstInvalid) firstInvalid = input;
            }
        });

        if (firstInvalid) {
            const field = firstInvalid.closest(".field") || firstInvalid;
            field.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "center" });
            firstInvalid.focus({ preventScroll: true });
        }
        return !firstInvalid;
    }

    // Validação em tempo real: limpa o erro assim que o campo fica válido
    $$("form[novalidate]").forEach((form) => {
        const revalidate = (event) => {
            const input = event.target;
            const field = input.closest && input.closest(".field");
            if (field && field.classList.contains("is-invalid") && input.checkValidity()) {
                clearFieldError(input);
            }
        };
        form.addEventListener("input", revalidate);
        form.addEventListener("change", revalidate);
    });

    // Contador de caracteres para textareas com limite
    $$("textarea[maxlength]").forEach((textarea) => {
        const counter = document.getElementById(`${textarea.id}-contador`);
        if (!counter) return;
        const max = textarea.maxLength;
        const update = () => {
            const length = textarea.value.length;
            counter.textContent = `${length}/${max}`;
            counter.classList.toggle("is-near-limit", length >= max * 0.9);
        };
        textarea.addEventListener("input", update);
        textarea.form && textarea.form.addEventListener("reset", () => setTimeout(update));
        update();
    });

    // Máscara de telefone: (19) 99999-9999 ou (19) 3333-3333
    $$("[data-phone-mask]").forEach((input) => {
        input.addEventListener("input", () => {
            const digits = input.value.replace(/\D/g, "").slice(0, 11);
            let masked = digits;
            if (digits.length > 2) masked = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
            if (digits.length > 6) {
                const split = digits.length === 11 ? 7 : 6;
                masked = `(${digits.slice(0, 2)}) ${digits.slice(2, split)}-${digits.slice(split)}`;
            }
            input.value = masked;
        });
    });

    /* ==========================================================================
       7. UPLOAD DE FOTO: ARRASTAR E SOLTAR, PRÉ-VISUALIZAÇÃO E COMPRESSÃO
       ========================================================================== */
    // Reduz a foto (máx. 800px, JPEG) para caber no localStorage (~100 KB por foto)
    function compressImage(file, maxSize = 800, quality = 0.72) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.naturalWidth * scale);
                canvas.height = Math.round(img.naturalHeight * scale);
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#FFFFFF"; // fundo branco para PNGs transparentes
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL("image/jpeg", quality));
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("Imagem inválida"));
            };
            img.src = url;
        });
    }

    function initDropzone(root, { maxMB = 10 } = {}) {
        const input = $("input[type='file']", root);
        const previewImg = $(".dropzone-preview img", root);
        const fileName = $(".dropzone-filename", root);
        const removeBtn = $(".dropzone-remove", root);
        let imageData = null;
        let pending = null;

        function clear() {
            input.value = "";
            imageData = null;
            pending = null;
            root.classList.remove("has-file");
            previewImg.removeAttribute("src");
            fileName.textContent = "";
        }

        function handleFile(file) {
            if (!file) {
                clear();
                return;
            }
            if (!file.type.startsWith("image/")) {
                clear();
                setFieldError(input, "Envie um arquivo de imagem (JPG, PNG ou WEBP).");
                return;
            }
            if (file.size > maxMB * 1024 * 1024) {
                clear();
                setFieldError(input, `A imagem deve ter no máximo ${maxMB} MB.`);
                return;
            }

            clearFieldError(input);
            root.classList.add("is-loading");
            pending = compressImage(file)
                .then((dataUrl) => {
                    imageData = dataUrl;
                    previewImg.src = dataUrl;
                    fileName.textContent = file.name;
                    root.classList.add("has-file");
                    return dataUrl;
                })
                .catch(() => {
                    clear();
                    setFieldError(input, "Não foi possível ler esta imagem. Tente outro arquivo.");
                    return null;
                })
                .finally(() => root.classList.remove("is-loading"));
        }

        input.addEventListener("change", () => handleFile(input.files[0]));

        ["dragenter", "dragover"].forEach((type) => root.addEventListener(type, (event) => {
            event.preventDefault();
            root.classList.add("is-dragover");
        }));
        ["dragleave", "drop"].forEach((type) => root.addEventListener(type, (event) => {
            event.preventDefault();
            root.classList.remove("is-dragover");
        }));
        root.addEventListener("drop", (event) => {
            const file = event.dataTransfer && event.dataTransfer.files[0];
            if (!file) return;
            try {
                // Coloca o arquivo solto dentro do input, para a validação "required" funcionar
                const transfer = new DataTransfer();
                transfer.items.add(file);
                input.files = transfer.files;
            } catch { /* navegadores antigos: segue só com a pré-visualização */ }
            handleFile(file);
        });

        removeBtn.addEventListener("click", () => {
            clear();
            input.focus();
        });

        return {
            async getImage() {
                if (pending) await pending;
                return imageData;
            },
            clear
        };
    }

    /* ==========================================================================
       8. MURAL DE ALERTAS (CARROSSEL INTERATIVO E AUTOMÁTICO)
       ========================================================================== */
    const SPECIES = { cao: { label: "Cão", icon: "🐶" }, gato: { label: "Gato", icon: "🐱" }, outro: { label: "Outro", icon: "🐾" } };
    const URGENCY = { alta: "Urgência alta", media: "Urgência média", baixa: "Urgência baixa" };

    function mapsUrl(alerta) {
        const query = alerta.coords
            ? `${alerta.coords.lat},${alerta.coords.lng}`
            : `${alerta.localizacao}, Campinas - SP`;
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    }

    const isSafeImage = (src) => typeof src === "string" && src.startsWith("data:image/");

    const mural = (function initMural() {
        const section = $("#alertas");
        const track = $("#mural-track");
        if (!section || !track) return { render() {} };

        const muralBox = $(".mural", section);
        const dotsWrap = $(".mural-dots", section);
        const emptyBox = $(".mural-empty", section);
        const filterButtons = $$(".filter-chip", section);
        const dialog = $("#alerta-dialog");

        const AUTOPLAY_MS = 4000;
        let filter = "todos";
        let timer = null;
        let isPaused = false;
        let isVisible = false;
        let openAlertId = null;

        /* ---------- Renderização ---------- */
        function cardHTML(alerta) {
            const species = SPECIES[alerta.especie] || SPECIES.outro;
            const rescued = alerta.status === "resgatado";
            const media = isSafeImage(alerta.foto)
                ? `<img src="${alerta.foto}" alt="Foto do animal: ${escapeHTML(species.label)} em ${escapeHTML(alerta.localizacao)}" loading="lazy">`
                : `<span class="alert-card-placeholder" aria-hidden="true">${species.icon}</span>`;

            return `
                <li class="alert-card${rescued ? " is-rescued" : ""}" data-id="${escapeHTML(alerta.id)}">
                    <button type="button" class="alert-card-btn" aria-label="Ver detalhes do alerta ${escapeHTML(alerta.protocolo)}: ${escapeHTML(alerta.localizacao)}">
                        <span class="alert-card-media">
                            ${media}
                            <span class="alert-card-badges">
                                <span class="badge badge-${escapeHTML(alerta.urgencia)}">${URGENCY[alerta.urgencia] || "Urgência"}</span>
                                <span class="badge badge-status">${rescued ? "✔ Resgatado" : "Aguardando"}</span>
                            </span>
                        </span>
                        <span class="alert-card-body">
                            <span class="alert-card-meta">
                                <span>${species.icon} ${species.label}</span>
                                <time datetime="${escapeHTML(alerta.criadoEm)}" data-relative>${timeAgo(alerta.criadoEm)}</time>
                            </span>
                            <span class="alert-card-title">📍 ${escapeHTML(alerta.localizacao)}</span>
                            <span class="alert-card-desc">${escapeHTML(alerta.descricao)}</span>
                            <span class="alert-card-proto">${escapeHTML(alerta.protocolo)}</span>
                        </span>
                    </button>
                </li>`;
        }

        function filtered(list) {
            if (filter === "todos") return list;
            if (filter === "resgatado") return list.filter((a) => a.status === "resgatado");
            return list.filter((a) => a.urgencia === filter);
        }

        function updateStats(list) {
            const rescued = list.filter((a) => a.status === "resgatado").length;
            const stats = { total: list.length, ativos: list.length - rescued, resgatados: rescued };
            $$("[data-stat]", section).forEach((el) => { el.textContent = stats[el.dataset.stat]; });
        }

        function render({ highlightId = null } = {}) {
            const all = alertsStore.all();
            const items = filtered(all);
            updateStats(all);

            track.innerHTML = items.map(cardHTML).join("");
            const isEmpty = items.length === 0;
            emptyBox.hidden = !isEmpty;
            muralBox.hidden = isEmpty;
            dotsWrap.hidden = isEmpty;

            if (isEmpty) {
                const noAlerts = all.length === 0;
                $(".mural-empty-title", emptyBox).textContent = noAlerts
                    ? "Nenhum alerta por aqui ainda"
                    : "Nenhum alerta neste filtro";
                $(".mural-empty-text", emptyBox).textContent = noAlerts
                    ? "Viu um animal precisando de ajuda? Seu alerta aparecerá neste mural."
                    : "Tente outro filtro para ver os demais alertas.";
            }

            track.scrollTo({ left: 0, behavior: "auto" });
            buildDots();

            if (highlightId) {
                const card = track.querySelector(`[data-id="${CSS.escape(highlightId)}"]`);
                if (card) {
                    card.classList.add("is-new");
                    setTimeout(() => card.classList.remove("is-new"), 2600);
                }
            }
            restartAutoplay();
        }

        /* ---------- Paginação (scroll-snap) ---------- */
        function metrics() {
            const first = track.firstElementChild;
            if (!first) return null;
            const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
            const step = first.getBoundingClientRect().width + gap;
            const perView = Math.max(1, Math.round((track.clientWidth + gap) / step));
            const pages = Math.max(1, Math.ceil(track.children.length / perView));
            return { step, perView, pages };
        }

        function currentPage(m) {
            const maxScroll = track.scrollWidth - track.clientWidth;
            if (track.scrollLeft >= maxScroll - 4) return m.pages - 1;
            return Math.round(track.scrollLeft / (m.step * m.perView));
        }

        function goToPage(page) {
            const m = metrics();
            if (!m) return;
            const target = (page + m.pages) % m.pages; // volta ao início depois do último
            track.scrollTo({
                left: target * m.perView * m.step,
                behavior: reducedMotion.matches ? "auto" : "smooth"
            });
        }

        const next = () => { const m = metrics(); if (m) goToPage(currentPage(m) + 1); };
        const prev = () => { const m = metrics(); if (m) goToPage(currentPage(m) - 1); };

        function buildDots() {
            const m = metrics();
            dotsWrap.innerHTML = "";
            const single = !m || m.pages <= 1;
            muralBox.classList.toggle("is-static", single);
            dotsWrap.classList.toggle("is-static", single);
            if (single) return;

            for (let i = 0; i < m.pages; i++) {
                const dot = document.createElement("button");
                dot.type = "button";
                dot.className = "mural-dot";
                dot.setAttribute("aria-label", `Página ${i + 1} de ${m.pages}`);
                dot.addEventListener("click", () => { goToPage(i); restartAutoplay(); });
                dotsWrap.appendChild(dot);
            }
            updateDots();
        }

        function updateDots() {
            const m = metrics();
            if (!m) return;
            const page = currentPage(m);
            Array.from(dotsWrap.children).forEach((dot, i) => {
                if (i === page) dot.setAttribute("aria-current", "true");
                else dot.removeAttribute("aria-current");
            });
        }

        let dotsTicking = false;
        track.addEventListener("scroll", () => {
            if (dotsTicking) return;
            dotsTicking = true;
            requestAnimationFrame(() => { updateDots(); dotsTicking = false; });
        }, { passive: true });

        if ("ResizeObserver" in window) {
            let lastWidth = 0;
            new ResizeObserver(() => {
                if (track.clientWidth === lastWidth) return;
                lastWidth = track.clientWidth;
                buildDots();
            }).observe(track);
        }

        /* ---------- Autoplay ---------- */
        function stopAutoplay() {
            clearInterval(timer);
            timer = null;
        }

        function startAutoplay() {
            const m = metrics();
            if (timer || isPaused || !isVisible || document.hidden || reducedMotion.matches || !m || m.pages <= 1) return;
            timer = setInterval(next, AUTOPLAY_MS);
        }

        function restartAutoplay() {
            stopAutoplay();
            startAutoplay();
        }

        const pause = () => { isPaused = true; stopAutoplay(); };
        const resume = () => { isPaused = false; startAutoplay(); };

        muralBox.addEventListener("mouseenter", pause);
        muralBox.addEventListener("mouseleave", resume);
        muralBox.addEventListener("focusin", pause);
        muralBox.addEventListener("focusout", (event) => {
            if (!muralBox.contains(event.relatedTarget)) resume();
        });
        track.addEventListener("pointerdown", (event) => {
            if (event.pointerType === "touch") { stopAutoplay(); setTimeout(startAutoplay, AUTOPLAY_MS * 2); }
        });
        document.addEventListener("visibilitychange", () => (document.hidden ? stopAutoplay() : startAutoplay()));

        // Só roda o autoplay quando o mural estiver visível na tela
        if ("IntersectionObserver" in window) {
            new IntersectionObserver(([entry]) => {
                isVisible = entry.isIntersecting;
                if (isVisible) startAutoplay();
                else stopAutoplay();
            }, { threshold: 0.3 }).observe(muralBox);
        } else {
            isVisible = true;
        }

        /* ---------- Navegação ---------- */
        $(".mural-next", muralBox).addEventListener("click", () => { next(); restartAutoplay(); });
        $(".mural-prev", muralBox).addEventListener("click", () => { prev(); restartAutoplay(); });

        track.addEventListener("keydown", (event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); next(); }
            if (event.key === "ArrowLeft") { event.preventDefault(); prev(); }
        });

        filterButtons.forEach((button) => {
            button.addEventListener("click", () => {
                filter = button.dataset.filter;
                filterButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
                render();
            });
        });

        /* ---------- Janela de detalhes ---------- */
        function fillDialog(alerta) {
            const species = SPECIES[alerta.especie] || SPECIES.outro;
            const rescued = alerta.status === "resgatado";
            const img = $(".dialog-img", dialog);

            if (isSafeImage(alerta.foto)) {
                img.src = alerta.foto;
                img.alt = `Foto do animal: ${species.label} em ${alerta.localizacao}`;
                img.hidden = false;
            } else {
                img.removeAttribute("src");
                img.hidden = true;
            }

            $(".dialog-badges", dialog).innerHTML = `
                <span class="badge badge-${escapeHTML(alerta.urgencia)}">${URGENCY[alerta.urgencia] || "Urgência"}</span>
                <span class="badge ${rescued ? "badge-resgatado" : "badge-aguardando"}">${rescued ? "✔ Resgatado" : "Aguardando resgate"}</span>`;
            $(".dialog-title", dialog).textContent = `📍 ${alerta.localizacao}`;
            $(".dialog-desc", dialog).textContent = alerta.descricao;

            const rows = [
                ["Espécie", `${species.icon} ${species.label}`],
                ["Avistado em", formatDate(alerta.dataHora)],
                ["Enviado", `${formatDate(alerta.criadoEm)} (${timeAgo(alerta.criadoEm)})`],
                ["Protocolo", alerta.protocolo]
            ];
            if (alerta.coords) {
                rows.splice(2, 0, ["Coordenadas", `${alerta.coords.lat.toFixed(5)}, ${alerta.coords.lng.toFixed(5)}`]);
            }
            $(".dialog-info", dialog).innerHTML = rows
                .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHTML(value)}</dd>`)
                .join("");

            $(".dialog-map", dialog).href = mapsUrl(alerta);
            $(".dialog-status", dialog).textContent = rescued ? "Reabrir alerta" : "✔ Marcar como resgatado";
        }

        function openDialog(id) {
            const alerta = alertsStore.all().find((a) => a.id === id);
            if (!alerta || !dialog) return;
            openAlertId = id;
            fillDialog(alerta);
            pause();
            if (typeof dialog.showModal === "function") dialog.showModal();
            else dialog.setAttribute("open", "");
        }

        function closeDialog() {
            if (!dialog) return;
            if (typeof dialog.close === "function") dialog.close();
            else dialog.removeAttribute("open");
        }

        track.addEventListener("click", (event) => {
            const card = event.target.closest(".alert-card");
            if (card) openDialog(card.dataset.id);
        });

        if (dialog) {
            $(".dialog-close", dialog).addEventListener("click", closeDialog);
            // Fecha ao clicar fora do conteúdo (no fundo escurecido)
            dialog.addEventListener("click", (event) => {
                if (event.target === dialog) closeDialog();
            });
            dialog.addEventListener("close", () => {
                openAlertId = null;
                resume();
            });

            $(".dialog-status", dialog).addEventListener("click", () => {
                const alerta = alertsStore.all().find((a) => a.id === openAlertId);
                if (!alerta) return;
                const newStatus = alerta.status === "resgatado" ? "aguardando" : "resgatado";
                if (!alertsStore.update(alerta.id, { status: newStatus })) {
                    toast("Não foi possível atualizar o alerta neste navegador.", { type: "error" });
                    return;
                }
                fillDialog({ ...alerta, status: newStatus });
                render();
                toast(newStatus === "resgatado"
                    ? `Alerta ${alerta.protocolo} marcado como resgatado. Obrigado!`
                    : `Alerta ${alerta.protocolo} reaberto.`, { type: newStatus === "resgatado" ? "success" : "info" });
            });
        }

        // Atualiza os tempos relativos ("há 5 minutos") a cada minuto
        setInterval(() => {
            $$("time[data-relative]", track).forEach((el) => { el.textContent = timeAgo(el.getAttribute("datetime")); });
        }, 60000);

        // Sincroniza se outro separador/aba do navegador enviar um alerta
        window.addEventListener("storage", (event) => {
            if (event.key === "adb:alertas") render();
        });

        render();
        return { render };
    })();

    /* ==========================================================================
       9. FORMULÁRIO DE ALERTA DE RESGATE
       ========================================================================== */
    (function initRescueForm() {
        const form = $("#form-reportar-animal");
        if (!form) return;

        const dropzone = initDropzone($("[data-dropzone]", form));
        const dateInput = $("#datahora", form);
        const locationInput = $("#localizacao", form);
        const geoButton = $("#btn-geo", form);
        const geoStatus = $("#geo-status", form);
        const submitButton = $(".btn-submit", form);
        let coords = null;

        function resetDate() {
            dateInput.value = nowLocalDateTime();
            dateInput.max = nowLocalDateTime();
        }
        resetDate();

        function setGeoStatus(message, success = false) {
            geoStatus.textContent = message;
            geoStatus.classList.toggle("is-success", success);
        }

        // Geolocalização do navegador (pede permissão ao usuário)
        if (!("geolocation" in navigator)) {
            geoButton.hidden = true;
        } else {
            geoButton.addEventListener("click", () => {
                geoButton.classList.add("is-loading");
                setGeoStatus("Obtendo sua localização...");

                navigator.geolocation.getCurrentPosition((position) => {
                    geoButton.classList.remove("is-loading");
                    coords = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        precisao: Math.round(position.coords.accuracy)
                    };
                    if (!locationInput.value.trim()) {
                        locationInput.value = `Coordenadas ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
                        clearFieldError(locationInput);
                    }
                    setGeoStatus(`✔ Localização capturada (precisão de ~${coords.precisao} m). Adicione um ponto de referência se puder.`, true);
                }, (error) => {
                    geoButton.classList.remove("is-loading");
                    const messages = {
                        1: "Permissão de localização negada. Digite o endereço manualmente.",
                        2: "Não foi possível determinar sua localização agora.",
                        3: "A localização demorou demais para responder. Tente novamente."
                    };
                    setGeoStatus("");
                    toast(messages[error.code] || "Erro ao obter localização.", { type: "error" });
                }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
            });
        }

        form.addEventListener("submit", async (event) => {
            event.preventDefault(); // landing page: nada é enviado a um servidor
            dateInput.max = nowLocalDateTime();

            if (!validateForm(form)) {
                toast("Revise os campos destacados antes de enviar.", { type: "error", title: "Quase lá!" });
                return;
            }

            setButtonLoading(submitButton, true);
            const foto = await dropzone.getImage();
            await wait(700); // simula o tempo de envio

            const data = new FormData(form);
            const alerta = {
                id: createId(),
                protocolo: createProtocol("ADB"),
                especie: data.get("especie"),
                urgencia: data.get("urgencia"),
                localizacao: String(data.get("localizacao")).trim(),
                coords,
                dataHora: data.get("datahora"),
                descricao: String(data.get("descricao")).trim(),
                contato: {
                    nome: String(data.get("contatoNome") || "").trim(),
                    telefone: String(data.get("contatoTelefone") || "").trim()
                },
                foto,
                status: "aguardando",
                criadoEm: new Date().toISOString()
            };

            const saved = alertsStore.add(alerta);
            setButtonLoading(submitButton, false);

            if (!saved) {
                toast("Não foi possível salvar o alerta neste navegador (armazenamento cheio ou bloqueado).", { type: "error", title: "Erro ao salvar" });
                return;
            }

            form.reset();
            dropzone.clear();
            coords = null;
            setGeoStatus("");
            resetDate();

            mural.render({ highlightId: alerta.id });
            $("#alertas").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth" });

            toast(`Protocolo ${alerta.protocolo}. A rede de voluntários poderá ver seu alerta no mural.`, {
                title: "Alerta de resgate enviado!",
                duration: 8000
            });
        });
    })();

    /* ==========================================================================
       10. FORMULÁRIO DE DENÚNCIA DE MAUS-TRATOS
       ========================================================================== */
    (function initAbuseForm() {
        const form = $("#form-denuncia");
        if (!form) return;

        const dropzone = initDropzone($("[data-dropzone]", form));
        const dateInput = $("#data-ocorrencia", form);
        const anonymous = $("#denuncia-anonima", form);
        const contactFields = $("#denuncia-contato", form);
        const submitButton = $(".btn-submit", form);
        const receipt = $("#denuncia-recibo", form);
        const protocolEl = $("#denuncia-protocolo", form);
        const copyButton = $("#btn-copiar-protocolo", form);

        const today = () => nowLocalDateTime().slice(0, 10);
        dateInput.max = today();

        // Denúncia anônima: esconde e desativa os campos de contato (não são validados)
        function syncAnonymous() {
            contactFields.disabled = anonymous.checked;
            contactFields.hidden = anonymous.checked;
            if (anonymous.checked) $$("input", contactFields).forEach(clearFieldError);
        }
        anonymous.addEventListener("change", syncAnonymous);
        syncAnonymous();

        copyButton.addEventListener("click", async () => {
            const text = protocolEl.textContent;
            try {
                await navigator.clipboard.writeText(text);
                copyButton.textContent = "Copiado!";
            } catch {
                // Sem permissão de área de transferência: seleciona o texto para copiar manualmente
                const range = document.createRange();
                range.selectNodeContents(protocolEl);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                copyButton.textContent = "Selecionado — use Ctrl+C";
            }
            setTimeout(() => { copyButton.textContent = "Copiar"; }, 2500);
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            dateInput.max = today();

            if (!validateForm(form)) {
                toast("Revise os campos destacados antes de registrar a denúncia.", { type: "error", title: "Quase lá!" });
                return;
            }

            setButtonLoading(submitButton, true);
            const foto = await dropzone.getImage();
            await wait(700);

            const data = new FormData(form);
            const isAnonymous = anonymous.checked;
            const denuncia = {
                id: createId(),
                protocolo: createProtocol("DMT"),
                tipo: data.get("tipo"),
                data: data.get("data"),
                endereco: String(data.get("endereco")).trim(),
                descricao: String(data.get("descricao")).trim(),
                foto,
                anonima: isAnonymous,
                denunciante: isAnonymous ? null : {
                    nome: String(data.get("nome") || "").trim(),
                    telefone: String(data.get("telefone") || "").trim()
                },
                criadoEm: new Date().toISOString()
            };

            // Salva só localmente e NÃO exibe publicamente, para proteger quem denuncia
            const saved = reportsStore.add(denuncia);
            setButtonLoading(submitButton, false);

            if (!saved) {
                toast("Não foi possível registrar a denúncia neste navegador.", { type: "error", title: "Erro ao salvar" });
                return;
            }

            form.reset();
            dropzone.clear();
            syncAnonymous();

            protocolEl.textContent = denuncia.protocolo;
            receipt.hidden = false;
            receipt.focus();

            toast(`Protocolo ${denuncia.protocolo}. ${isAnonymous ? "Sua identidade foi preservada." : "Entraremos em contato se necessário."}`, {
                title: "Denúncia registrada",
                duration: 8000
            });
        });
    })();

    /* ==========================================================================
       11. FORMULÁRIO DE CONTATO
       ========================================================================== */
    (function initContactForm() {
        const form = $("#form-contato");
        if (!form) return;
        const submitButton = $(".btn-submit", form);

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!validateForm(form)) return;

            setButtonLoading(submitButton, true);
            await wait(600);
            setButtonLoading(submitButton, false);

            const firstName = String(new FormData(form).get("nome")).trim().split(" ")[0];
            form.reset();
            toast(`Obrigado, ${firstName}! Responderemos pelo e-mail informado em breve.`, { title: "Mensagem enviada" });
        });
    })();
});
