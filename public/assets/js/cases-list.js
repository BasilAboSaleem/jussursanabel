(function CasesListApp() {
    const boot = window.__CASES_BOOT__;
    if (!boot) return;

    const grid = document.getElementById('casesGrid');
    const loadMoreBtn = document.getElementById('casesLoadMoreBtn');
    const loadMoreWrap = document.getElementById('casesLoadMoreWrap');
    if (!grid || !loadMoreBtn) return;

    let currentPage = boot.page || 1;
    let isFetching = false;

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function arrowIcon() {
        return boot.langDir === 'rtl' ? 'left' : 'right';
    }

    function typeLabel(type) {
        return type === 'orphan' ? boot.labels.orphan : boot.labels.family;
    }

    function typeIcon(type) {
        return type === 'orphan' ? 'fa-child' : 'fa-users';
    }

    function badgeClass(type) {
        return type === 'orphan' ? 'badge-gold' : 'badge-teal';
    }

    function buildCard(item, index) {
        const verifiedHtml = item.isFieldVerified
            ? `<div class="verified-badge" title="${escapeHtml(boot.labels.verifiedTooltip)}">
                    <i class="fas fa-check-circle"></i> ${escapeHtml(boot.labels.verifiedText)}
               </div>`
            : '';

        const satisfiedHtml = item.isSatisfied
            ? `<div class="satisfied-overlay">
                    <span class="badge" style="background: var(--secondary); color: white; border: none; padding: 10px 20px; font-weight: 900; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);">
                        <i class="fas fa-heart-circle-check"></i> ${escapeHtml(boot.labels.satisfiedText)}
                    </span>
               </div>`
            : '';

        const storyHtml = item.hasStory
            ? `<a href="${escapeHtml(item.storyUrl)}" class="story-video-badge" title="${escapeHtml(boot.labels.storyBadge)}">
                    <i class="fas fa-circle-play"></i> ${escapeHtml(boot.labels.storyBadge)}
               </a>`
            : '';

        const areaHtml = item.area
            ? `<span style="font-size: 0.75rem; color: var(--secondary); font-weight: 700; background: rgba(16, 185, 129, 0.1); padding: 2px 8px; border-radius: 5px;">
                    <i class="fas fa-location-dot"></i> ${escapeHtml(item.area)}
               </span>`
            : '';

        const targetText = item.targetAmount
            ? `$${item.targetAmount}`
            : escapeHtml(boot.labels.targetOpen);

        const fundingPercent = item.targetAmount > 0
            ? Math.min((item.raisedAmount / item.targetAmount) * 100, 100)
            : 0;

        const storyBtnHtml = item.hasStory
            ? `<a href="${escapeHtml(item.storyUrl)}" class="btn-lux btn-sm" style="width: 100%; justify-content: center; border-radius: 16px; padding: 12px 20px; font-weight: 800; margin-bottom: 10px; background: rgba(2,6,23,0.06); color: var(--primary); text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">
                    <i class="fas fa-circle-play"></i> ${escapeHtml(boot.labels.watchStory)}
               </a>`
            : '';

        return `
            <div class="luxury-card case-card h-100 reveal-on-scroll active" data-type="${escapeHtml(item.type)}" style="transition-delay: ${index * 0.05}s">
                <div class="card-image-wrapper">
                    <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="case-image" loading="lazy" decoding="async" width="480" height="360">
                    <div class="image-overlay"></div>
                    <div class="badge ${badgeClass(item.type)} case-badge">
                        <i class="fas ${typeIcon(item.type)}"></i>
                        ${escapeHtml(typeLabel(item.type))}
                    </div>
                    ${verifiedHtml}
                    ${storyHtml}
                    ${satisfiedHtml}
                </div>
                <div class="card-body-content" style="position: relative;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; gap: 8px;">
                        <h3 class="font-cairo case-title" style="margin: 0;">${escapeHtml(item.title)}</h3>
                        ${areaHtml}
                    </div>
                    <p class="case-description">${escapeHtml(item.description)}</p>
                    <div class="card-footer-stats">
                        <div class="progress-track">
                            <div class="progress-fill" style="width: ${fundingPercent}%;"></div>
                        </div>
                        <div class="stats-labels">
                            <span class="raised-text">${escapeHtml(boot.labels.raisedText)} $${item.raisedAmount}</span>
                            <span class="target-text">${escapeHtml(boot.labels.targetText)} ${targetText}</span>
                        </div>
                        ${storyBtnHtml}
                        <a href="/cases/${item._id}" class="btn-lux btn-lux-primary btn-sm btn-full-width" style="background: var(--grad-green); color: #fff; box-shadow: 0 10px 20px rgba(16, 185, 129, 0.2);">
                            ${escapeHtml(boot.labels.detailsBtn)} <i class="fas fa-arrow-${arrowIcon()}"></i>
                        </a>
                    </div>
                </div>
            </div>
        `;
    }

    function buildFeedUrl(page) {
        const params = new URLSearchParams();
        if (boot.type && boot.type !== 'all') params.set('type', boot.type);
        if (boot.verified) params.set('verified', '1');
        if (boot.sort && boot.sort !== 'newest') params.set('sort', boot.sort);
        if (boot.limit) params.set('limit', String(boot.limit));
        params.set('page', String(page));
        return `/cases/feed?${params.toString()}`;
    }

    async function loadMore() {
        if (isFetching || currentPage >= boot.totalPages) return;

        isFetching = true;
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${escapeHtml(boot.labels.loading)}`;

        try {
            const nextPage = currentPage + 1;
            const response = await fetch(buildFeedUrl(nextPage), {
                headers: { Accept: 'application/json' }
            });

            if (!response.ok) throw new Error('feed failed');

            const data = await response.json();
            const fragment = document.createDocumentFragment();
            const temp = document.createElement('div');
            temp.innerHTML = data.cases.map((item, index) => buildCard(item, index)).join('');
            while (temp.firstChild) {
                fragment.appendChild(temp.firstChild);
            }
            grid.appendChild(fragment);

            currentPage = data.pagination.page;
            boot.totalPages = data.pagination.totalPages;

            const params = new URLSearchParams(window.location.search);
            params.set('page', String(currentPage));
            const nextUrl = `${window.location.pathname}?${params.toString()}`;
            window.history.replaceState({}, '', nextUrl);

            if (!data.pagination.hasMore && loadMoreWrap) {
                loadMoreWrap.style.display = 'none';
            }
        } catch (err) {
            console.error(err);
            loadMoreBtn.innerHTML = `<i class="fas fa-rotate-right"></i> ${escapeHtml(boot.labels.loadMore)}`;
        } finally {
            isFetching = false;
            loadMoreBtn.disabled = false;
            if (currentPage < boot.totalPages) {
                loadMoreBtn.innerHTML = `<i class="fas fa-chevron-down"></i> ${escapeHtml(boot.labels.loadMore)}`;
            }
        }
    }

    if (boot.totalPages > 1 && currentPage < boot.totalPages) {
        loadMoreBtn.addEventListener('click', loadMore);
    } else if (loadMoreWrap) {
        loadMoreWrap.style.display = 'none';
    }
})();
