const YOUTUBE_HOSTS = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com'
];

const TIKTOK_HOSTS = [
    'tiktok.com',
    'www.tiktok.com',
    'm.tiktok.com',
    'vm.tiktok.com',
    'vt.tiktok.com'
];

const INSTAGRAM_HOSTS = [
    'instagram.com',
    'www.instagram.com'
];

const DIRECT_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.m4v', '.mov'];
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const cloudinaryEnabled = Boolean(CLOUDINARY_CLOUD_NAME);
const TIKTOK_EXPAND_TIMEOUT_MS = 8000;
const TIKTOK_FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml'
};
const tiktokExpandCache = new Map();

function isYouTubeUrl(urlString = '') {
    try {
        const url = new URL(urlString);
        return YOUTUBE_HOSTS.includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function isTikTokUrl(urlString = '') {
    try {
        const url = new URL(urlString);
        return TIKTOK_HOSTS.includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function isInstagramUrl(urlString = '') {
    try {
        const url = new URL(urlString);
        return INSTAGRAM_HOSTS.includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function extractYouTubeId(urlString = '') {
    try {
        const url = new URL(urlString);
        const host = url.hostname.toLowerCase();

        if (!YOUTUBE_HOSTS.includes(host)) return null;

        if (host.includes('youtu.be')) {
            const id = url.pathname.split('/').filter(Boolean)[0];
            return id || null;
        }

        const v = url.searchParams.get('v');
        if (v) return v;

        const shortsMatch = url.pathname.match(/\/shorts\/([^/?#]+)/i);
        if (shortsMatch && shortsMatch[1]) return shortsMatch[1];

        const embedMatch = url.pathname.match(/\/embed\/([^/?#]+)/i);
        if (embedMatch && embedMatch[1]) return embedMatch[1];

        return null;
    } catch {
        return null;
    }
}

function extractTikTokVideoId(urlString = '') {
    try {
        const url = new URL(urlString);
        const host = url.hostname.toLowerCase();

        if (!TIKTOK_HOSTS.includes(host)) return null;

        const videoMatch = url.pathname.match(/\/video\/(\d+)/i);
        if (videoMatch && videoMatch[1]) return videoMatch[1];

        const mobileMatch = url.pathname.match(/\/v\/(\d+)/i);
        if (mobileMatch && mobileMatch[1]) return mobileMatch[1];

        for (const key of ['share_item_id', 'item_id', 'video_id']) {
            const queryId = url.searchParams.get(key);
            if (queryId && /^\d+$/.test(queryId)) return queryId;
        }

        return null;
    } catch {
        return null;
    }
}

function extractInstagramMedia(urlString = '') {
    try {
        const url = new URL(urlString);
        const host = url.hostname.toLowerCase();

        if (!INSTAGRAM_HOSTS.includes(host)) return null;

        const reelMatch = url.pathname.match(/\/reel\/([A-Za-z0-9_-]+)/i);
        if (reelMatch && reelMatch[1]) {
            return { type: 'reel', shortcode: reelMatch[1] };
        }

        const postMatch = url.pathname.match(/\/p\/([A-Za-z0-9_-]+)/i);
        if (postMatch && postMatch[1]) {
            return { type: 'p', shortcode: postMatch[1] };
        }

        const tvMatch = url.pathname.match(/\/tv\/([A-Za-z0-9_-]+)/i);
        if (tvMatch && tvMatch[1]) {
            return { type: 'tv', shortcode: tvMatch[1] };
        }

        return null;
    } catch {
        return null;
    }
}

function buildYouTubeEmbedUrl(youtubeId, { muted = 0 } = {}) {
    if (!youtubeId) return null;
    const m = muted ? 1 : 0;
    return `https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&mute=${m}&controls=0&autoplay=0&loop=1&playlist=${youtubeId}&playsinline=1&rel=0&modestbranding=1`;
}

function buildTikTokEmbedUrl(videoId) {
    if (!videoId) return null;
    return `https://www.tiktok.com/embed/v2/${videoId}?lang=ar`;
}

function buildInstagramEmbedUrl(media) {
    if (!media || !media.shortcode) return null;
    const segment = media.type === 'p' ? 'p' : media.type === 'tv' ? 'tv' : 'reel';
    return `https://www.instagram.com/${segment}/${media.shortcode}/embed`;
}

function hasDirectVideoExtension(pathname = '') {
    const cleanPath = pathname.toLowerCase().split('?')[0].split('#')[0];
    return DIRECT_VIDEO_EXTENSIONS.some(ext => cleanPath.endsWith(ext));
}

function isCloudinaryUrl(urlString = '') {
    return /res\.cloudinary\.com/i.test(urlString) && /\/upload\//i.test(urlString);
}

function normalizeCloudinaryVideoUrl(urlString = '') {
    if (!isCloudinaryUrl(urlString)) return urlString;

    const transformation = 'f_mp4,vc_h264,ac_aac,q_auto,fl_progressive';
    if (/\/upload\/[^/]+\/v\d+/i.test(urlString)) {
        return urlString.replace(/\/upload\/([^/]+)\/(v\d+)/i, `/upload/${transformation},$1/$2`);
    }
    if (/\/upload\/v\d+/i.test(urlString)) {
        return urlString.replace(/\/upload\/(v\d+)/i, `/upload/${transformation}/$1`);
    }
    if (/\/upload\/[^/]+\//i.test(urlString)) {
        return urlString.replace(/\/upload\/([^/]+)\//i, `/upload/${transformation},$1/`);
    }
    return urlString.replace('/upload/', `/upload/${transformation}/`);
}

function toCloudinaryFetchUrl(remoteUrl = '') {
    if (!CLOUDINARY_CLOUD_NAME) return remoteUrl;
    try {
        const parsed = new URL(remoteUrl);
        if (!/^https?:$/.test(parsed.protocol)) return remoteUrl;
        const encoded = encodeURIComponent(remoteUrl);
        const transformation = 'f_mp4,vc_h264,ac_aac,q_auto,fl_progressive';
        return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/fetch/${transformation}/${encoded}`;
    } catch {
        return remoteUrl;
    }
}

function resolveStoryVideo(rawUrl = '') {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { valid: false };
    }

    const trimmed = rawUrl.trim();
    if (!trimmed) return { valid: false };

    if (isYouTubeUrl(trimmed)) {
        const youtubeId = extractYouTubeId(trimmed);
        if (!youtubeId) return { valid: false };
        return {
            valid: true,
            provider: 'youtube',
            storedUrl: trimmed,
            embedUrl: buildYouTubeEmbedUrl(youtubeId, { muted: 0 })
        };
    }

    if (isTikTokUrl(trimmed)) {
        const videoId = extractTikTokVideoId(trimmed);
        if (!videoId) return { valid: false };
        return {
            valid: true,
            provider: 'tiktok',
            storedUrl: trimmed,
            embedUrl: buildTikTokEmbedUrl(videoId)
        };
    }

    if (isInstagramUrl(trimmed)) {
        const media = extractInstagramMedia(trimmed);
        if (!media) return { valid: false };
        return {
            valid: true,
            provider: 'instagram',
            storedUrl: trimmed,
            embedUrl: buildInstagramEmbedUrl(media)
        };
    }

    if (isCloudinaryUrl(trimmed)) {
        return {
            valid: true,
            provider: 'html5',
            storedUrl: normalizeCloudinaryVideoUrl(trimmed),
            embedUrl: null
        };
    }

    try {
        const parsed = new URL(trimmed);
        if (hasDirectVideoExtension(parsed.pathname)) {
            return {
                valid: true,
                provider: 'html5',
                storedUrl: toCloudinaryFetchUrl(trimmed),
                embedUrl: null
            };
        }
        return {
            valid: true,
            provider: 'html5',
            storedUrl: toCloudinaryFetchUrl(trimmed),
            embedUrl: null
        };
    } catch {
        return { valid: false };
    }
}

function getEmptyStoryVideoPresentation() {
    return {
        storyVideoPlayable: null,
        storyVideoProvider: null,
        storyVideoEmbedUrl: null,
        storyVideoIsEmbeddable: false,
        storyVideoIsYouTube: false,
        storyYouTubeEmbedUrl: null
    };
}

function needsTikTokExpansion(urlString = '') {
    if (!isTikTokUrl(urlString)) return false;
    return !extractTikTokVideoId(urlString);
}

async function expandTikTokShortUrl(urlString = '') {
    const trimmed = String(urlString || '').trim();
    if (!trimmed || !needsTikTokExpansion(trimmed)) {
        return trimmed;
    }

    if (tiktokExpandCache.has(trimmed)) {
        return tiktokExpandCache.get(trimmed);
    }

    try {
        const response = await fetch(trimmed, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(TIKTOK_EXPAND_TIMEOUT_MS),
            headers: TIKTOK_FETCH_HEADERS
        });

        const finalUrl = (response.url || trimmed).trim();
        if (finalUrl && extractTikTokVideoId(finalUrl)) {
            tiktokExpandCache.set(trimmed, finalUrl);
            return finalUrl;
        }
    } catch (err) {
        console.warn('[storyVideo] TikTok short-link expand failed:', err.message);
    }

    return null;
}

function buildStoryVideoPresentation(resolved, { youtubeMuted = 0 } = {}) {
    if (!resolved || !resolved.valid) {
        return getEmptyStoryVideoPresentation();
    }

    let embedUrl = resolved.embedUrl;
    if (resolved.provider === 'youtube') {
        const youtubeId = extractYouTubeId(resolved.storedUrl);
        embedUrl = buildYouTubeEmbedUrl(youtubeId, { muted: youtubeMuted });
    }

    const isEmbeddable = ['youtube', 'tiktok', 'instagram'].includes(resolved.provider);

    return {
        storyVideoPlayable: resolved.storedUrl,
        storyVideoProvider: resolved.provider,
        storyVideoEmbedUrl: embedUrl,
        storyVideoIsEmbeddable: isEmbeddable,
        storyVideoIsYouTube: resolved.provider === 'youtube',
        storyYouTubeEmbedUrl: resolved.provider === 'youtube' ? embedUrl : null
    };
}

async function resolveStoryVideoAsync(rawUrl = '') {
    const syncResolved = resolveStoryVideo(rawUrl);
    if (syncResolved.valid || !needsTikTokExpansion(rawUrl)) {
        return syncResolved;
    }

    const trimmed = String(rawUrl).trim();
    const expanded = await expandTikTokShortUrl(trimmed);
    if (!expanded) return syncResolved;

    const expandedResolved = resolveStoryVideo(expanded);
    if (!expandedResolved.valid) return syncResolved;

    return {
        ...expandedResolved,
        storedUrl: expanded
    };
}

function getPlayableStoryVideoUrl(rawUrl = '') {
    const resolved = resolveStoryVideo(rawUrl);
    return resolved.valid ? resolved.storedUrl : null;
}

async function getPlayableStoryVideoUrlAsync(rawUrl = '') {
    const resolved = await resolveStoryVideoAsync(rawUrl);
    return resolved.valid ? resolved.storedUrl : null;
}

function prepareStoryVideo(rawUrl = '', { youtubeMuted = 0 } = {}) {
    return buildStoryVideoPresentation(resolveStoryVideo(rawUrl), { youtubeMuted });
}

async function prepareStoryVideoAsync(rawUrl = '', { youtubeMuted = 0 } = {}) {
    return buildStoryVideoPresentation(await resolveStoryVideoAsync(rawUrl), { youtubeMuted });
}

module.exports = {
    getPlayableStoryVideoUrl,
    getPlayableStoryVideoUrlAsync,
    resolveStoryVideo,
    resolveStoryVideoAsync,
    prepareStoryVideo,
    prepareStoryVideoAsync,
    isYouTubeUrl,
    isTikTokUrl,
    isInstagramUrl,
    extractYouTubeId,
    extractTikTokVideoId,
    extractInstagramMedia,
    buildYouTubeEmbedUrl,
    buildTikTokEmbedUrl,
    buildInstagramEmbedUrl,
    cloudinaryEnabled
};
