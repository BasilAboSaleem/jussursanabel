(function StoriesFeedApp() {
    const boot = window.__STORIES_BOOT__ || {};
    const PAGE_SIZE = boot.pageSize || 3;
    const container = document.getElementById('stories-container');
    if (!container) return;

    let totalStories = boot.total || 0;
    let loadedCount = 0;
    let currentIndex = 0;
    let isGlobalMuted = true;
    let isFetching = false;
    let hasMore = true;
    let skipOffset = 0;
    let initialCaseId = boot.caseId || '';
    let initialCaseHandled = !initialCaseId;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const liveCountEl = document.getElementById('live-count');
    const positionEl = document.getElementById('story-position');
    const progressFill = document.getElementById('stories-progress-fill');
    const soundHint = document.getElementById('sound-hint');
    const loadMoreSentinel = document.getElementById('stories-load-sentinel');

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function defaultThumb() {
        return 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?q=80&w=480&auto=format&fit=crop';
    }

    function thumbUrl(url) {
        if (!url) return defaultThumb();
        if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {
            return url.replace('/upload/', '/upload/w_480,h_640,c_fill,q_auto,f_auto/');
        }
        return url;
    }

    function getSlides() {
        return container.querySelectorAll('.story-slide:not(.story-boot-loader)');
    }

    function getSlide(idx) {
        return document.getElementById('story-slide-' + idx);
    }

    function getMedia(idx) {
        return document.getElementById('media-' + idx);
    }

    function getProvider(idx) {
        const slide = getSlide(idx);
        return (slide && slide.getAttribute('data-provider')) || 'html5';
    }

    function isEmbedSlide(idx) {
        const slide = getSlide(idx);
        return slide && slide.getAttribute('data-is-embed') === 'true';
    }

    function isYTSlide(idx) {
        return getProvider(idx) === 'youtube';
    }

    function updatePositionUI() {
        if (positionEl) {
            positionEl.textContent = totalStories > 0
                ? (currentIndex + 1) + ' / ' + totalStories
                : '0 / 0';
        }
        if (liveCountEl && totalStories > 0) {
            liveCountEl.textContent = totalStories;
        }
    }

    function updateMuteUI(idx, muted) {
        const icon = document.getElementById('mute-icon-' + idx);
        const label = document.getElementById('mute-label-' + idx);
        if (icon) icon.className = muted ? 'fas fa-volume-xmark' : 'fas fa-volume-high';
        if (label) label.textContent = muted ? 'صامت' : 'صوت';
    }

    function setProgress(pct) {
        if (progressFill) progressFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }

    function showSoundHint(show) {
        if (!soundHint) return;
        soundHint.classList.toggle('hidden', !show);
    }

    function ytCmd(idx, func) {
        const frame = getMedia(idx);
        if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: '' }), '*');
        }
    }

    function buildSlideHtml(story, index) {
        const provider = story.provider || 'html5';
        const isEmbed = Boolean(story.isEmbeddable);
        const showMute = provider === 'youtube' || provider === 'html5';
        const typeLabel = story.type === 'orphan' ? 'حالة يتيم' : 'أسرة محتاجة';
        const typeIcon = story.type === 'orphan' ? 'fa-child' : 'fa-people-roof';
        const img = thumbUrl(story.image);

        return `
        <div class="story-slide"
             data-index="${index}"
             data-id="${story._id}"
             data-provider="${provider}"
             data-is-embed="${isEmbed}"
             data-media-mounted="false"
             id="story-slide-${index}">

            <div class="story-skeleton" id="skeleton-${index}"></div>

            <img src="${escapeHtml(img)}" alt="${escapeHtml(story.title)}"
                 class="story-thumb" id="thumb-${index}" loading="lazy" decoding="async">

            <div class="story-media-mount" id="media-mount-${index}"></div>

            <div class="story-tap-zones" aria-hidden="true">
                <button type="button" class="story-tap-prev" data-idx="${index}" aria-label="القصة السابقة"></button>
                <button type="button" class="story-tap-center" data-idx="${index}" aria-label="تشغيل أو إيقاف"></button>
                <button type="button" class="story-tap-next" data-idx="${index}" aria-label="القصة التالية"></button>
            </div>

            <div class="story-gradient-top"></div>
            <div class="story-gradient"></div>

            <div class="story-actions">
                ${showMute ? `
                <button type="button" class="action-btn mute-action" data-idx="${index}" title="الصوت">
                    <div class="action-btn-icon">
                        <i class="fas fa-volume-xmark" id="mute-icon-${index}"></i>
                    </div>
                    <span id="mute-label-${index}">صامت</span>
                </button>` : ''}
                <button type="button" class="action-btn share-action"
                    data-title="${escapeHtml(story.title)}"
                    data-path="/cases/${story._id}" title="مشاركة">
                    <div class="action-btn-icon"><i class="fas fa-share-nodes"></i></div>
                    <span>مشاركة</span>
                </button>
            </div>

            <div class="story-info">
                <div class="story-badges-row">
                    <div class="story-type-badge">
                        <i class="fas ${typeIcon}"></i> ${typeLabel}
                    </div>
                    ${story.isUrgent ? `
                    <div class="story-urgent-badge">
                        <i class="fas fa-fire-flame-curved"></i> بحاجة عاجلة
                    </div>` : ''}
                </div>
                <h2 class="story-title-text">${escapeHtml(story.title)}</h2>
                ${story.description ? `<p class="story-desc-text">${escapeHtml(story.description)}</p>` : ''}
                ${story.supporterCount > 0 ? `
                <div class="story-supporters">
                    <span class="story-supporters-text">
                        <strong>${story.supporterCount}+</strong> متبرع دعم هذه الحالة
                    </span>
                </div>` : ''}
                <a href="/cases/${story._id}" class="story-cta-btn">
                    <i class="fas fa-hand-holding-heart"></i>
                    ابدأ الكفالة / تبرع الآن
                </a>
            </div>

            ${index === 0 ? `
            <div class="scroll-hint" id="scroll-hint">
                <i class="fas fa-chevron-up"></i>
                <span>اسحب للأعلى</span>
            </div>` : ''}
        </div>`;
    }

    function mountMedia(idx, story) {
        const slide = getSlide(idx);
        const mount = document.getElementById('media-mount-' + idx);
        if (!slide || !mount || slide.getAttribute('data-media-mounted') === 'true') return;

        const provider = story.provider || 'html5';
        if (story.isEmbeddable && story.embedUrl) {
            const iframe = document.createElement('iframe');
            iframe.className = 'story-media embed-frame ' + provider + '-frame';
            iframe.id = 'media-' + idx;
            iframe.dataset.src = story.embedUrl;
            iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
            iframe.setAttribute('title', story.title || 'story');
            iframe.setAttribute('loading', 'lazy');
            mount.appendChild(iframe);
        } else if (story.playableUrl) {
            const video = document.createElement('video');
            video.className = 'story-media html5-vid';
            video.id = 'media-' + idx;
            video.dataset.src = story.playableUrl;
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
            video.setAttribute('loop', '');
            video.setAttribute('muted', '');
            video.setAttribute('preload', 'none');
            video.setAttribute('controlsList', 'nodownload');
            mount.appendChild(video);
        }

        slide.setAttribute('data-media-mounted', 'true');
        slide._storyData = story;
    }

    function loadMediaSrc(idx) {
        const media = getMedia(idx);
        if (!media || media.getAttribute('src')) return;
        const src = media.dataset.src;
        if (src) media.setAttribute('src', src);
    }

    function unloadMediaSrc(idx) {
        const media = getMedia(idx);
        if (!media) return;
        if (isYTSlide(idx)) {
            ytCmd(idx, 'pauseVideo');
            ytCmd(idx, 'mute');
        } else if (media.tagName === 'VIDEO') {
            media.pause();
            if (isIOS) {
                media.removeAttribute('src');
                media.load();
            }
        } else {
            media.removeAttribute('src');
        }
        media.classList.remove('playing');
    }

    function syncMediaWindow(centerIdx) {
        getSlides().forEach((slide) => {
            const idx = parseInt(slide.getAttribute('data-index'), 10);
            const distance = Math.abs(idx - centerIdx);
            const story = slide._storyData;

            if (distance <= 1 && story) {
                mountMedia(idx, story);
                if (distance === 1) loadMediaSrc(idx);
            } else if (distance > 2) {
                unloadMediaSrc(idx);
            }
        });
    }

    function bindSlideEvents(slideEl) {
        const idx = parseInt(slideEl.getAttribute('data-index'), 10);
        const thumb = document.getElementById('thumb-' + idx);
        const skeleton = document.getElementById('skeleton-' + idx);

        if (thumb) {
            const hideSk = () => {
                if (skeleton) {
                    skeleton.style.opacity = '0';
                    setTimeout(() => skeleton.remove(), 400);
                }
            };
            if (thumb.complete) hideSk();
            else thumb.addEventListener('load', hideSk, { once: true });
        }

        slideEl.querySelector('.mute-action')?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleStoryMute(idx);
        });

        slideEl.querySelector('.share-action')?.addEventListener('click', function (e) {
            e.stopPropagation();
            shareStory(this.getAttribute('data-title'), this.getAttribute('data-path'));
        });

        slideEl.querySelector('.story-tap-prev')?.addEventListener('click', (e) => {
            e.stopPropagation();
            goToSlide(idx - 1);
        });

        slideEl.querySelector('.story-tap-next')?.addEventListener('click', (e) => {
            e.stopPropagation();
            goToSlide(idx + 1);
        });

        slideEl.querySelector('.story-tap-center')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isGlobalMuted && (isYTSlide(idx) || getProvider(idx) === 'html5')) {
                toggleStoryMute(idx);
            }
        });
    }

    function appendStories(stories) {
        const bootLoader = container.querySelector('.story-boot-loader');
        if (bootLoader) bootLoader.remove();

        const startIndex = loadedCount;
        const fragment = document.createDocumentFragment();
        const wrapper = document.createElement('div');

        stories.forEach((story, i) => {
            const index = startIndex + i;
            wrapper.innerHTML = buildSlideHtml(story, index);
            const slide = wrapper.firstElementChild;
            slide._storyData = story;
            fragment.appendChild(slide);
        });

        if (loadMoreSentinel) {
            container.insertBefore(fragment, loadMoreSentinel);
        } else {
            container.appendChild(fragment);
        }

        for (let i = startIndex; i < startIndex + stories.length; i++) {
            const slide = getSlide(i);
            if (slide) bindSlideEvents(slide);
        }

        loadedCount += stories.length;
        updatePositionUI();
        observeSlides();

        if (!hasStartedPlayback && stories.length > 0) {
            hasStartedPlayback = true;
            setTimeout(() => playStory(0), 300);
        }
    }

    async function fetchStories() {
        if (isFetching || !hasMore) return;
        isFetching = true;
        if (loadMoreSentinel) loadMoreSentinel.classList.add('visible');

        try {
            const params = new URLSearchParams({
                skip: String(skipOffset),
                limit: String(PAGE_SIZE)
            });
            if (!initialCaseHandled && initialCaseId) {
                params.set('caseId', initialCaseId);
            }

            const res = await fetch('/api/stories/feed?' + params.toString());
            const data = await res.json();

            totalStories = data.total || totalStories;
            hasMore = Boolean(data.hasMore);
            skipOffset = (data.skip || skipOffset) + (data.stories || []).length;
            initialCaseHandled = true;

            if (data.stories && data.stories.length > 0) {
                appendStories(data.stories);
            } else if (loadedCount === 0) {
                showEmptyState();
            }
        } catch (err) {
            console.error(err);
            if (loadedCount === 0) showEmptyState();
        } finally {
            isFetching = false;
            if (loadMoreSentinel) loadMoreSentinel.classList.remove('visible');
        }
    }

    function showEmptyState() {
        container.innerHTML = `
        <div class="stories-empty">
            <i class="fas fa-film"></i>
            <h2>لا توجد قصص متاحة حالياً</h2>
            <p>لم يتم إضافة قصص فيديو لأي حالة بعد.</p>
            <a href="/" class="stories-empty-btn"><i class="fas fa-home"></i> العودة للرئيسية</a>
        </div>`;
    }

    function goToSlide(idx) {
        const slides = getSlides();
        if (idx < 0 || idx >= slides.length) return;
        slides[idx].scrollIntoView({ behavior: 'smooth' });
    }

    function muteStory(idx, muted) {
        const media = getMedia(idx);
        if (!media) return;
        if (isYTSlide(idx)) ytCmd(idx, muted ? 'mute' : 'unMute');
        else if (media.tagName === 'VIDEO') media.muted = muted;
        updateMuteUI(idx, muted);
    }

    function toggleStoryMute(idx) {
        isGlobalMuted = !isGlobalMuted;
        muteStory(idx, isGlobalMuted);
        showSoundHint(false);
    }

    function shareStory(title, path) {
        const url = window.location.origin + path;
        if (navigator.share) navigator.share({ title, url }).catch(() => {});
        else navigator.clipboard.writeText(url).then(() => alert('تم نسخ رابط الحالة!'));
    }

    function bindProgress(media, idx) {
        if (!media || media.tagName !== 'VIDEO') {
            setProgress(0);
            if (progressFill) progressFill.classList.add('indeterminate');
            return;
        }
        if (progressFill) progressFill.classList.remove('indeterminate');
        media.ontimeupdate = () => {
            if (idx !== currentIndex) return;
            const pct = media.duration ? (media.currentTime / media.duration) * 100 : 0;
            setProgress(pct);
        };
    }

    function playStory(idx) {
        const media = getMedia(idx);
        const thumb = document.getElementById('thumb-' + idx);
        const hint = document.getElementById('scroll-hint');
        const slide = getSlide(idx);
        if (hint) hint.style.opacity = '0';

        syncMediaWindow(idx);
        loadMediaSrc(idx);

        if (media) {
            media.classList.add('playing');
            bindProgress(media, idx);

            if (isEmbedSlide(idx)) {
                if (progressFill) progressFill.classList.add('indeterminate');
                if (isYTSlide(idx)) {
                    setTimeout(() => {
                        ytCmd(idx, 'playVideo');
                        muteStory(idx, isGlobalMuted);
                        setTimeout(() => thumb && thumb.classList.add('hidden'), 500);
                    }, 400);
                } else {
                    const baseSrc = media.dataset.src;
                    if (baseSrc) {
                        media.src = baseSrc + (baseSrc.includes('?') ? '&' : '?') + '_t=' + Date.now();
                    }
                    setTimeout(() => thumb && thumb.classList.add('hidden'), 700);
                }
            } else if (media.tagName === 'VIDEO') {
                media.muted = true;
                isGlobalMuted = true;
                updateMuteUI(idx, true);
                showSoundHint(true);
                media.play().then(() => {
                    thumb && thumb.classList.add('hidden');
                }).catch(() => {
                    media.muted = true;
                    media.play().catch(() => {});
                    thumb && thumb.classList.add('hidden');
                });
            }
        } else if (slide && slide._storyData) {
            mountMedia(idx, slide._storyData);
            loadMediaSrc(idx);
            setTimeout(() => playStory(idx), 100);
            return;
        }

        updatePositionUI();
        if (idx >= loadedCount - 2) fetchStories();
    }

    function pauseStory(idx) {
        unloadMediaSrc(idx);
        const thumb = document.getElementById('thumb-' + idx);
        if (thumb) thumb.classList.remove('hidden');
    }

    let hasStartedPlayback = false;
    const observedSlides = new WeakSet();

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            const idx = parseInt(entry.target.getAttribute('data-index'), 10);
            if (entry.isIntersecting && entry.intersectionRatio >= 0.75) {
                getSlides().forEach((s) => {
                    const i = parseInt(s.getAttribute('data-index'), 10);
                    if (i !== idx) pauseStory(i);
                });
                currentIndex = idx;
                setTimeout(() => playStory(idx), 80);
            } else if (!entry.isIntersecting) {
                pauseStory(idx);
            }
        });
    }, { threshold: [0.75], root: container });

    function observeSlide(slide) {
        if (!slide || observedSlides.has(slide)) return;
        observedSlides.add(slide);
        observer.observe(slide);
    }

    function observeSlides() {
        getSlides().forEach(observeSlide);
    }

    if (loadMoreSentinel) {
        const loadObserver = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting) && loadedCount > 0 && hasMore) fetchStories();
        }, { root: container, rootMargin: '300px' });
        loadObserver.observe(loadMoreSentinel);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') goToSlide(currentIndex + 1);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') goToSlide(currentIndex - 1);
        else if (e.key === 'm' || e.key === 'M') toggleStoryMute(currentIndex);
    });

    document.querySelectorAll('.header-logo-story').forEach((img) => {
        img.addEventListener('error', function () { this.style.display = 'none'; });
    });

    if (totalStories === 0) {
        showEmptyState();
    } else {
        fetchStories();
    }
})();
