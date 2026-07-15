const Setting = require('../models/Setting');
const { parseForbiddenWords, mergeForbiddenWords, validateCaseTextFields } = require('./contentFilter');

/** Bump when guide/templates change so existing installs receive updates. */
const REGISTRATION_CONTENT_VERSION = 7;

const STORY_TEMPLATE_SECTIONS = `١ — التعريف بالمتحدث: من يتحدث وما صلته بالأسرة؟
٢ — تكوين الأسرة: عدد الأفراد وأعمار الأطفال إن وُجدوا.
٣ — الحياة قبل الأحداث: كيف كانت حياة الأسرة أو الأطفال قبل الفقدان أو الظروف الصعبة.
٤ — ما الذي حصل: ما الحدث الذي غيّر وضعهم (فقدان معيل، نزوح، تدمير منزل، إلخ).
٥ — أثر الحدث: كيف انعكس ذلك على الأسرة والأطفال.
٦ — الظروف الحالية: الصعوبات اليومية التي يواجهونها الآن.
٧ — أكثر ما يفتقدونه: الشيء الذي تفتقده الأسرة أو الأطفال أكثر من غيره.
٨ — موقف مؤثر: حدث أو موقف بسيط ومؤثر خلال الفترة الماضية.
٩ — الاحتياجات: ما تحتاجه الأسرة (طعام، شراب، كفالة تعليم، إيجار، علاج، إلخ).
١٠ — الخاتمة: رسالة كريمة لطلب الدعم بلا مبالغة ولا ابتذال.`;

const CASE_REGISTRATION_KEYS = {
    registration_guide_ar: {
        description: 'دليل تسجيل الحالة (عربي)',
        default: `دليل المشاركة في سرد قصة الحالة — نَمير

هذا الدليل يوضّح آلية المشاركة من طرفكم كأسرة مستفيدة، ويساعد فريق المراجعة على إعادة الصياغة والفلترة بسرعة ودقة. يُفضَّل قراءته كاملاً قبل التعبئة، ثم استخدام «نموذج القصة المستوفي» وملؤه بأسلوبكم.

━━━ البيانات المطلوبة ━━━
• عنوان تعريفي للحالة (10–80 حرفاً) — واضح ومحايد.
• وصف قصير للمتبرعين (40–350 حرفاً) — ملخص موضوعي دون تفاصيل شخصية حساسة.
• القصة الكاملة (200–1200 كلمة تقريباً) — وفق البنود العشرة أدناه.
• الموقع، نوع الحالة، الاحتياجات، والصور (1–3). الفيديو اختياري (YouTube Shorts أو TikTok).
• بيانات الهيكل العائلي كما في النموذج (أسماء، أعمار، إلخ).

━━━ هيكل القصة الكاملة (إلزامي من حيث الترتيب المنطقي) ━━━
${STORY_TEMPLATE_SECTIONS}

━━━ الكلمات والألفاظ غير المقبولة ━━━
يُرفض تلقائياً أي نص يتضمّن:
• ألفاظ الشهادة أو ما يشابهها.
• محتوى تحريضي أو عنيف أو يدعو إلى الكراهية أو الانقسام.
• السبّ والإهانة والعنصرية والمبالغة المبتذلة.
• معلومات كاذبة أو تحريضية أو مسيئة للكرامة.

عند المطابقة يُظهر النظام الكلمة الممنوعة ويمنع الإرسال حتى التصحيح.

━━━ معايير الصور ━━━
• من 1 إلى 3 صور فقط، واضحة وحديثة قدر الإمكان.
• تُفضَّل صور تعبّر عن الواقع المعيشي دون إحراج (طعام، سكن، دراسة، أدوية...).
• تجنّبوا إظهار وجوه الأطفال أو بيانات هوية حساسة إن أمكن.
• لا صور عنيفة أو مسيئة أو منسوخة من الإنترنت بلا إذن.

━━━ معايير الفيديو (اختياري — ليس إلزامياً) ━━━
• الفيديو اختياري تماماً؛ يمكنكم تقديم الطلب دون أي رابط فيديو.
• المقبول: رابط YouTube Shorts (ستوري شورت) لا يتجاوز دقيقة واحدة، أو رابط مقطع TikTok قصير.
• يجب أن يخص المقطع حالتكم وأسرتكم فقط — لا مقاطع عامة أو منقولة عن غيركم.
• يُفضَّل أن يعرض واقعاً من حياتكم اليومية أو يكمّل القصة المكتوبة بأسلوب بسيط ومحترم.
• لا محتوى تحريضي أو مسيء أو مخالف للقوانين.

━━━ أسلوب الكتابة ━━━
• اكتبوا بصوتكم بسيطاً وواقعياً — كأنكم تشرحون لجار تثقون به.
• لا مبالغة عاطفية ولا استجداء مبتذل؛ الكرامة أولاً.
• ركّزوا على الحقائق والاحتياجات الفعلية القابلة للتحقق ميدانياً.

━━━ بعد الإرسال ━━━
يُراجع الطلب إدارياً وميدانياً وإعلامياً قبل النشر. قد يتواصل معكم الفريق لاستكمال أو تنقيح الصياغة.`
    },
    registration_guide_en: {
        description: 'Case registration guide (English)',
        default: `Case story participation guide — Nameer

This guide explains how your family participates in telling your story and helps our review team filter and rewrite content efficiently. Read it fully, then use the “full story template” and fill it in your own words.

━━━ Required data ━━━
• Case title (10–80 characters) — clear and neutral.
• Short donor-facing description (40–350 characters).
• Full story (about 200–1,200 words) — following the 10 sections below.
• Location, case type, needs, and 1–3 photos. Video is optional (YouTube Shorts or TikTok).
• Family structure details as requested in the form.

━━━ Full story structure (logical order required) ━━━
1 — Speaker: Who is narrating and their relationship to the family.
2 — Family composition: Number of members and children's ages if any.
3 — Life before events: Daily life before loss or hardship.
4 — What happened: The event that changed their situation.
5 — Impact: How it affected the family and children.
6 — Current conditions: Daily difficulties they face now.
7 — What they miss most: What the family or children long for most.
8 — A meaningful moment: One simple, impactful event from recent months.
9 — Needs: Food, water, education sponsorship, rent, medical care, etc.
10 — Closing: A dignified, modest request for support — no exaggeration.

━━━ Prohibited wording ━━━
Submissions are blocked if they include martyrdom-related terms, incitement or violence, hate speech, insults, or degrading exaggeration. The system shows the matched word and blocks submit until corrected.

━━━ Photo standards ━━━
• 1–3 clear, recent photos where possible.
• Prefer dignified images of living conditions; avoid children's faces and ID documents when possible.
• No violent, offensive, or misleading stock images.

━━━ Video standards (optional — not required) ━━━
• Video is fully optional; you may submit without any video link.
• Accepted: YouTube Shorts (up to 1 minute) or a short TikTok clip.
• Clips must relate to your family and case only — no generic or reused third-party content.
• Prefer simple, dignified footage that reflects your daily reality or complements the written story.
• No inflammatory, offensive, or unlawful content.

━━━ Writing style ━━━
• Simple, factual, dignified tone — no melodrama or begging.
• Focus on verifiable needs and facts.

━━━ After submission ━━━
Your request goes through admin, field, and media review before publication.`
    },
    case_template_orphan_ar: {
        description: 'قالب قصة حالة يتيم',
        default: `[١ — التعريف بالمتحدث]
أنا [الاسم الكامل]، [وصي الأيتام / الأم / القريب...]، وأروي هذه القصة باسم أسرتنا التي أنهكتها الأحداث الصعبة.

[٢ — تكوين الأسرة]
تتكوّن أسرتنا من (...) أفراد، منهم (...) أيتام. أعمار الأطفال: [الاسم — العمر]، [الاسم — العمر]، [...].

[٣ — الحياة قبل الأحداث]
قبل ما حصل، كانت حياتنا [...صف بسيط: المدرسة، العمل، البيت، العادات اليومية...].

[٤ — ما الذي حصل؟]
في [...الفترة تقريباً...]، فقد أطفالنا معيلهم / تغيّر وضعنا بسبب [...الحدث باختصار واقعي: وفاة الأب، نزوح، تدمير منزل...].

[٥ — أثر الحدث عليهم]
انعكس ذلك على الأطفال في [...التعليم / النوم / الخوف / الصحة / العلاقات...].

[٦ — الظروف الحالية والصعوبات]
اليوم نعيش في [...] ونواجه: [...قلة دخل، إيجار، مواصلات مدرسية، علاج، ملابس، طعام...].

[٧ — أكثر ما يفتقدونه]
أكثر ما يفتقده الأطفال والأسرة هو [...].

[٨ — موقف أو حدث مؤثر]
أذكر موقفاً واحداً [...حدث بسيط ومؤثر من واقع حياتنا...].

[٩ — الاحتياجات]
نحتاج إلى: [...طعام / شراب / كفالة تعليم / إيجار / علاج / مستلزمات مدرسية / ...].

[١٠ — الخاتمة]
نسأل الله أن ييسّر لأطفالنا خيراً، ونرجو من أصحاب القلوب الرحيمة مساندة أسرتنا بما يحفظ كرامتنا.`
    },
    case_template_family_ar: {
        description: 'قالب قصة حالة أسرة',
        default: `[١ — التعريف بالمتحدث]
أنا [الاسم الكامل]، [ربّ الأسرة / الأم / الوصي...]، وأروي هذه القصة باسم أسرتنا التي أنهكتها الأحداث الصعبة.

[٢ — تكوين الأسرة]
أسرتنا مكوّنة من (...) أفراد. الأطفال وهم: [الاسم — العمر]، [...]. البالغون: [...].

[٣ — الحياة قبل الأحداث]
قبل الأحداث الأخيرة، كانت حياتنا [...وصف واقعي للعمل والسكن والتعليم والحياة اليومية...].

[٤ — ما الذي حصل؟]
حدث [...فقدان مصدر الدخل / نزوح / تضرر المنزل / مرض مفاجئ / ...] في [...الفترة...]، فتغيّر وضعنا بالكامل.

[٥ — أثر الحدث]
أثّر ذلك علينا في [...الجانب النفسي / المعيشي / التعليمي / الصحي...].

[٦ — الظروف الحالية والصعوبات]
نقطن حالياً في [...] ونواجه صعوبات يومية مثل [...].

[٧ — أكثر ما تفتقده الأسرة]
أكثر ما نفتقده كأسرة هو [...].

[٨ — موقف أو حدث مؤثر]
من المواقف التي لا تُنسى [...قصة قصيرة محددة من واقع حياتنا...].

[٩ — الاحتياجات]
احتياجاتنا الأساسية: [...أكل / شرب / كفالة / تعليم / علاج / إيجار / تدفئة / ...].

[١٠ — الخاتمة]
نسأل الله أن ييسّر لنا ولأبنائنا خيراً، ونرجو من أصحاب القلوب الرحيمة مساندة أسرتنا بما يحفظ كرامتنا.`
    },
    case_template_desc_ar: {
        description: 'قالب الوصف القصير للحالة',
        default: `في [الموقع]، [من هم؟ جملة واحدة تُظهر إنسانيتهم — أمّ وحدها، أطفال بلا مأوى، أسرة فقدت معيلها...]. [ماذا يتمنون أو يخافون فقده؟ حلم صغير، دفء، مدرسة، دواء...]. يدكم في [الاحتياج] قد تعني لهم أكثر مما تتخيلون.`
    },
    forbidden_words: {
        description: 'قائمة الكلمات الممنوعة في نصوص الحالة (فاصلة أو سطر لكل كلمة)',
        default: 'كلب,حمار,غبي,أحمق,لعنة,لعن,قذر,حقير,تافه,كذاب,كذب,احتيال,نصب,سرقة,قتل,إرهاب,تحريض,كراهية,عنصرية,إهانة,سب,شتم,شهيد,شهداء,شهيدة,استشهاد,استشهادي,إرهابي,ارهابي,تأييد الإرهاب,دعم الإرهاب,نصرة الإرهاب,تنظيم إرهابي,martyr,martyrs'
    }
};

async function ensureSetting(key) {
    const meta = CASE_REGISTRATION_KEYS[key];
    if (!meta) return null;

    let doc = await Setting.findOne({ key });
    if (!doc) {
        doc = await Setting.create({
            key,
            value: meta.default,
            description: meta.description
        });
    }
    return doc;
}

async function syncRegistrationContentDefaults() {
    const versionDoc = await Setting.findOne({ key: 'case_registration_content_version' });
    const current = versionDoc ? Number(versionDoc.value) : 0;
    if (current >= REGISTRATION_CONTENT_VERSION) return;

    const contentKeys = [
        'registration_guide_ar',
        'registration_guide_en',
        'case_template_orphan_ar',
        'case_template_family_ar',
        'case_template_desc_ar'
    ];

    for (const key of contentKeys) {
        const meta = CASE_REGISTRATION_KEYS[key];
        await Setting.findOneAndUpdate(
            { key },
            {
                value: meta.default,
                description: meta.description,
                updatedAt: new Date()
            },
            { upsert: true }
        );
    }

    await Setting.findOneAndUpdate(
        { key: 'case_registration_content_version' },
        {
            value: REGISTRATION_CONTENT_VERSION,
            description: 'إصدار دليل وقوالب تسجيل الحالات',
            updatedAt: new Date()
        },
        { upsert: true }
    );
}

async function loadCaseRegistrationSettings({ ensureDefaults = true } = {}) {
    const keys = Object.keys(CASE_REGISTRATION_KEYS);
    const docs = {};

    if (ensureDefaults) {
        await syncRegistrationContentDefaults();
        for (const key of keys) {
            docs[key] = await ensureSetting(key);
        }
    } else {
        const found = await Setting.find({ key: { $in: keys } });
        for (const doc of found) {
            docs[doc.key] = doc;
        }
    }

    const forbiddenRaw = docs.forbidden_words
        ? String(docs.forbidden_words.value || '')
        : CASE_REGISTRATION_KEYS.forbidden_words.default;

    return {
        registrationGuideAr: docs.registration_guide_ar
            ? String(docs.registration_guide_ar.value)
            : CASE_REGISTRATION_KEYS.registration_guide_ar.default,
        registrationGuideEn: docs.registration_guide_en
            ? String(docs.registration_guide_en.value)
            : CASE_REGISTRATION_KEYS.registration_guide_en.default,
        caseTemplateOrphanAr: docs.case_template_orphan_ar
            ? String(docs.case_template_orphan_ar.value)
            : CASE_REGISTRATION_KEYS.case_template_orphan_ar.default,
        caseTemplateFamilyAr: docs.case_template_family_ar
            ? String(docs.case_template_family_ar.value)
            : CASE_REGISTRATION_KEYS.case_template_family_ar.default,
        caseTemplateDescAr: docs.case_template_desc_ar
            ? String(docs.case_template_desc_ar.value)
            : CASE_REGISTRATION_KEYS.case_template_desc_ar.default,
        forbiddenWordsRaw: forbiddenRaw,
        forbiddenWords: mergeForbiddenWords(forbiddenRaw)
    };
}

async function validateCaseContentForRequest(req, res, { title, description, storyAr }, redirectTo) {
    const settings = await loadCaseRegistrationSettings({ ensureDefaults: false });
    const validation = validateCaseTextFields({
        title,
        description,
        storyAr,
        forbiddenWords: settings.forbiddenWords
    });

    if (!validation.ok) {
        const { field, word } = validation.matches[0];
        const fieldLabel = res.__(`register_case_field_${field}`);
        req.flash('error', res.__('flash_forbidden_word_in_field', { field: fieldLabel, word }));
        res.redirect(redirectTo);
        return false;
    }

    return true;
}

module.exports = {
    CASE_REGISTRATION_KEYS,
    REGISTRATION_CONTENT_VERSION,
    ensureSetting,
    syncRegistrationContentDefaults,
    loadCaseRegistrationSettings,
    validateCaseContentForRequest
};
