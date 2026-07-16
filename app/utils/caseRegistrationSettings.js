const Setting = require('../models/Setting');
const { parseForbiddenWords, mergeForbiddenWords, validateCaseTextFields, isLikelyCopiedFromExamples } = require('./contentFilter');

/** Bump when guide/templates change so existing installs receive updates. */
const REGISTRATION_CONTENT_VERSION = 8;

const FAMILY_DATA_SAMPLE = `نموذج بيانات أفراد الأسرة:
• المتحدث/الوصي: الاسم الكامل، تاريخ الميلاد، الحالة الصحية، وضع السكن، وضع الإقامة.
• الأب: الاسم، تاريخ الوفاة، سبب الوفاة (إن وُجد).
• الأم: الاسم، العمر، الحالة الصحية، هل على قيد الحياة؟
• لكل طفل/فرد: الاسم، العمر، الجنس، صلة القرابة، الحالة الصحية، المرحلة الدراسية (إن وُجد).`;

const FAMILY_DATA_SAMPLE_EN = `Family member data sample:
• Speaker/guardian: full name, date of birth, health status, housing status, residency status.
• Father: name, date of death, cause of death (if applicable).
• Mother: name, age, health status, whether alive.
• For each child/member: name, age, gender, relationship, health status, education level (if any).`;

const CASE_STORY_EXAMPLES_AR = `لحالة 1
العنوان (نحن 4 أخوات، وتلك هي قصتنا)
نحن أربع أخوات، وهذه هي صورتنا
مذ أن غاب عنا بابا، لم تعد حياتنا كما كانت.
كنا نحبه ويحبنا، يطمئننا، يهتم بكل تفاصيلنا، ويوفر لنا كل ما نحتاجه وأكثر، بوجوده، كنا نشعر أننا بخير دائما، اليوم
كل شيء تغير 
ماما أصبحت تتحمل كل المسؤولية وحدها، وتحاول بكل قوتها أن توفر لنا أبسط احتياجاتنا، لكن الظروف أكبر منها، احتياجاتنا تكبر معنا كل يوم 
نريد أن نعي مثل بافي الأطفال، وأن نكمل دراستنا، ونحن نشعر أن هناك من يقف إلى جانبنا وإلى جانب ماما
يمكن لشيء بسيط منكم أن يصنع فرقًا كبيرًا في حياتنا، أن يساعد ............ (تكتب اسم طفلة)، وأن يوفر ل (...............) اسم الأخت الثانية // وأن يفرح قلب صغيرتنا (...............).
نحن بانتظاركم، فلا تتركونا وحدنا وتجعلونا نعيش اليتم مرتين
……………………………………………………………………. 
الحالة 2 
العنوان (وحدنا، بلا أب أو أم). 
أنا أكبر إخوتي، وعمري 17 عامًا، في لحظة واحدة، فقدت أبي وأمي، ووجدت نفسي مسؤولًا عن أخي وأختي، لم أعد أفكر في نفسي فقط، بل أصبحت أفكر كل صباح، كيف سنكمل يومنا، كيف أحافظ عليهما وأخفف عنهما كل هذا الحزن. 
أحاول أن أكون قويًا أمامهما، رغم أنني ما زلت في عمر صغير، أحاول أن أمنحهما الأمان، وأنا أفتقده!
أخي يبلغ من العمر.......، وأختي ............، لكل منهما احتياجاته وأحلامه، وأتمنى أن أراهما يكبران في ظروف أفضل، وأن يكملا تعليمهما وأن يعيشا طفولة يستحقانها، لكن المسؤولية أكبر مني، وأكبر من قدرتي، لا وجد من يعيلنا، يتكفل باحتياجاتي واحتياجات إخوتي التي تزداد يومًا بعد يوم.
كل ما أطلبه أن نجد من يقف بجانبنا، يساعدنا على تجاوز هذه المرحلة الصعبة.
كل ما أريده هو أن أرى إخوتي بخير، يكون بصحة جيدة، ويتلقون تعليمًا جيدًا ويحصلون ولو على أدنى متطلبات الحياة.
ورغم كل شيء أشعر أن هناك دومًا فرصة جديدة. 
…………………………………………………………...
الحالة 3 
العنوان (أصعب شعور على أم عندها 6 أطفال) 
أصعب شعور ممكن تعيشه الأم هو إنه تشعر بالعجز، بالعجز تجاه أطفالها الستة!
كل يوم بصحى وأنا بفكر: كيف بدي أوفر لأولادي الأكل؟ كيف بدي أجيب إلهم الملابس، لو مرض واحد فيهم، كيف بدي أوفر علاجه؟
بحاول أكون قوية، وما أبكي قدامهم، وبحكيلهم بكرة أحسن، لكن مش عارفة من وين أبدأ؟ 
6 أطفال فقدوا أبوهم، السند والأمان في حياتهم، كبروا بسرعة، مش بالعمر، بالمسؤولية وظروف الحياة!
ما بطلب شي لنفسي، كل اللي محتاجاه حد يوقف مع أولادي، يكملوا تعليمهم، يلبسوا زي الصغار، يعيشوا أيام زي قلوبهم البيضاء مليانة دفا وأمان، تعوضهم الفقد والحرمان. 
يمكن كفالتكم، تخلي أولادي يعيشوا هالشعور. 
………………………………………………………………..
الحالة 4 
العنوان (أنس هو كل ما تبقى لي)

منذ أن فقد أنس والده، وأنا أحاول أن أكون له الأم والأب معًا.
فقدنا بيتنا في الحرب، وفقدنا كل ما نملك، وأصبحت أعيش أنا وأنس داخل خيمة، أحاول أن أصنع منها مكانًا يشعر فيه أنس بشيء من الأمان. 
ولكن الخيمة تبقى خيمة، لا تقي من حر الصيف ولا برد الشتاء. 
أنس عمره سبع سنوات، لكنه يسألني أسئلة كثيرة، (ماما، متى رح نرجع على البيت) 
ولا أعرف ماذا أجيبه!
كل ما أتمناه أن أوفر له ما يحتاجه، طعامًا يشبع جوعه، وملابس تقيه الحر والبرد، وحقيبة يعود بها إلى مدرسته، وحياة تشبه أطفالًا بعمر السبع سنوات. 
أنس لا يطلب الكثير، يفرح بأبسط الأشياء، ويملك ابتسامة حلوة، ينبغي ألا تغيب. 
.....................................................................
الحالة 5 
العنوان (أنا وأخي) 
أنا وأخي عايشين مع بعض بخيمة، الخيمة بتخوف!
لما ييجي الليل، بضل قاعد جنب أخي وما بتحرك، بخاف كتير، يمكن لأنه بابا مش موجود.
بتخيل لو كان موجود، كان بنحس بالأمان، كان يجيبلنا كل شي بدنا إياه، ونضحك سوا ونلعب معاه. 
بس هلأ كلشي راح، يعني أشياء كتيرة محروم منها، رغم إنها بسيطة وعادية.
نفسي أرجع للمدرسة، أحمل شنطة كويسة ومعي كتبي، أجيب أقلام ودفاتر
نفسي أشتري لعبة، أو حتى نفسي أنام على فراش منيح..
ما بعرف أطلب كتير، بس إنه لو وقفنا معانا وساندتونا حياتنا رح تتحسن، ورح نكون أنا وأخي مبسوطين. 
....................................................................
الحالة 6
العنوان (عمري بالوجع مش بالسنين)
أنا الحاجة تمام، كل أهل المخيم بيعرفو قصتي، يمكن أكبر وحدة موجودة، بس عمري بعده بالوجع مش بالسنين! 
عمري راح كله وأنا بربي ولادي، وأتعب حتى يكبروا ويكونوا سندي في الحياة بعد ربنا، بس الحرب أخدت مني كل شي
فجأة ما لقيت حد من ولادي عندي، ابني الأول إجاني خبره وإنو راح، وضليت أستنى ابني التاني على أمل إنهم يلاقوه، بس إجاني الخبر اللي كسرلي قلبي، وإنو ولادي الاتنين راحو وتركوني مع 3 أطفال وأمهم..
بحاول أكون إلهم الجدة والأب وأعوضهم، وهاد الحمل فوق طاقتي وقدرتي، عايشين كلنا بخيمة، وأنا مريضة بحتاج العلاج، لكن والله ما بيوجعني المرض زي ما بيوجعني العجز، أشوفهم محتاجين الأكل والشرب والملابس، ومش قادرة 
كل اللي محتاجيته الآن إنو أكون مطمنة عليهم قبل ما الله ياخد أمانته، آلاقي حد يتكفلهم ويرعاهم ويوفرهم ولو أبسط الاحتياج. 
.......................................................................
الحالة 7 
العنوان (خمسة أطفال ولا معيل لهم) 
أنا أم لخمسة أطفال أكبرهم بعمر ال........... وأصغرهم ما زال يبلغ ......... فقط
كل واحد منهم يحمل حلمًا صغيرًا، (...........)  بتضيف هنا اسم الطفل) يتمنى أن يحصل على ثياب جديدة، و(..........) لعبته صغيرة، أما (.............) فيرغب بحقيبة جميلة، أحلامهم بسيطة لكنها بالنسبة لي تفوق قدرتي.
نعيش في بيت يفتقد أدنى مقومات الحياة، وومع فقد زوجي لم يعد لي أي مصدر دخل، نعيش على بعض ما يتوفر لنا من أهل الخير، فأقسمه بينهم، لكنه لا يكفي.
أشارككم قصتي، لأن أطفالي يستحقون أن يكونوا بخير، يستحقون فرصة أفضل وحياة تليق بهم.
كفالتكم تجعلهم يحققون أحلامهم التي ما زالت ممكنة، وتشعرهم أن لا زال هناك في الحياة متسع من الأمل والفرح.`;

const CASE_REGISTRATION_KEYS = {
    registration_guide_ar: {
        description: 'دليل تسجيل الحالة (عربي)',
        default: `تعليمات إرشادية للتسجيل في منصة نمير 

قبل تعبئة الطلب، يرجى قراءة التعليمات الإرشادية التالية، فهذا يساعدكم على كتابة قصتكم بشكل صحيح، ويسهل مراجعة الطلب ونشره. 
أولًا: ما المطلوب تعبئته: 
    • عنوان مختصر عن القصة. 
    • وصف قصير يوضح طبيعة الحالة.
    • القصة كاملة.
    • تحديد الاحتياج. 
    • صور.
    • رابط القصة فيديو (اختياري). 
    • بيانات أفراد الأسرة كاملة.
${FAMILY_DATA_SAMPLE}
ثانيًا: كيف أكتب القصة: 
حاول أن تكتب قصتك بهذا الترتيب: 
    • من المتحدث، وما صلته بالأسرة. 
    • عرفنا بأسرتك وعدد أفرادها. 
    • كيف كانت حياتكم قبل الحرب. 
    • ما الذي حدث معكم، وكيف أثر عليكم.
    • ما الصعوبات والمشكلات التي تعيشونها اليوم، ولو كان هناك موقفًا مؤثرًا اذكروه. 
    • ما أكثر شيء تحتاجونه، وما نوع المساعدة التي تريدونها. 
    • اختم قصتك برسالة قصيرة إلى المتبرع.  
ثالثًا: عند كتابة قصتك:
    • اكتب بأسلوبك وبكلماتك.
    • اذكر الحقائق والواقع كما هي. 
    • تجنب المبالغة أو الاستعطاف. 
    •  تجنب الألفاظ المسيئة أو التحريضية. 
    • تجنب الألفاظ المسيئة أو التحريضية أو أي معلومات غير صحيحة.
رابعًا: الصور: 
    • أرفق من صور إلى ثلاث صور. 
    • استخدم صورًا واضحة وحديثة.
    • أن تعكس احتياج الأسرة بشكل يحفظ الكرامة. 
    • لا تستخدم صورًا من الإنترنت أو صورًا لا تخص حالتك. 
خامسًا: الفيديو (اختياري):
    • يمكنك إرفاق رابط فيديو قصير على منصة (يوتيوب/ تيك توك) لا يتعدى دقيقة تروي فيه قصتك وتوضح حالتك. 
ماذا يحدث بعد إرسال الطلب:
بعد إرسال طلب من طرفكم، يقوم فريق المنصة بمراجعته والتأكد منه المعلومات الواردة فيه، وقد يتم التواصل معكم إذا احتاجنا إلى استكمال بعض البيانات أو تعديل بعض التفاصيل قبل النشر.`
    },
    registration_guide_en: {
        description: 'Case registration guide (English)',
        default: `Guidance for registering on the Nameer platform

Before filling out the application, please read the following instructions. This helps you write your story correctly and makes review and publication easier.

First: What to fill in:
    • A short title for the story.
    • A brief description of the case.
    • The full story.
    • Stated needs.
    • Photos.
    • Story video link (optional).
    • Complete family member data.
${FAMILY_DATA_SAMPLE_EN}

Second: How to write the story:
Try to write your story in this order:
    • Who is speaking and their relationship to the family.
    • Introduce your family and number of members.
    • What life was like before the war.
    • What happened to you and how it affected you.
    • Current hardships; mention a meaningful moment if there is one.
    • What you need most and what kind of help you want.
    • End with a short message to donors.

Third: When writing your story:
    • Write in your own words and style.
    • State facts and reality as they are.
    • Avoid exaggeration or emotional manipulation.
    • Avoid offensive or inflammatory language.
    • Avoid offensive, inflammatory, or incorrect information.

Fourth: Photos:
    • Attach one to three photos.
    • Use clear, recent photos.
    • Reflect the family's need while preserving dignity.
    • Do not use internet photos or photos that are not yours.

Fifth: Video (optional):
    • You may attach a short video link on YouTube or TikTok (up to one minute) telling your story and explaining your situation.

What happens after submission:
After you submit, the platform team reviews the application and verifies the information. We may contact you to complete data or adjust details before publication.`
    },
    case_story_examples_ar: {
        description: 'نماذج قصص الحالات (عربي)',
        default: CASE_STORY_EXAMPLES_AR
    },
    case_template_desc_ar: {
        description: 'قالب الوصف القصير للحالة',
        default: `وصف قصير يوضح طبيعة الحالة في جملتين أو ثلاث: من هم؟ أين يعيشون؟ وما أبرز احتياجهم اليوم؟`
    },
    forbidden_words: {
        description: 'قائمة الكلمات الممنوعة في نصوص الحالة (فاصلة أو سطر لكل كلمة)',
        default: 'كلب,حمار,غبي,أحمق,لعنة,لعن,قذر,حقير,تافه,كذاب,كذب,احتيال,نصب,سرقة,قتل,إرهاب,تحريض,كراهية,عنصرية,إهانة,سب,شتم,شهيد,شهداء,شهيدة,استشهاد,استشهادي,إرهابي,ارهابي,تأييد الإرهاب,دعم الإرهاب,نصرة الإرهاب,تنظيم إرهابي,martyr,martyrs'
    }
};

/**
 * Splits stored examples text into an array (one entry per "الحالة N" / "لحالة N").
 */
function parseStoryExamples(raw) {
    if (!raw || !String(raw).trim()) return [];
    return String(raw)
        .split(/\n(?=ل?الحالة\s*\d+)/)
        .map((part) => part.trim())
        .filter(Boolean);
}

/**
 * Short label for UI picker, e.g. "الحالة 1 — نحن 4 أخوات..."
 */
function storyExampleLabel(exampleText, index) {
    const titleMatch = exampleText.match(/العنوان\s*\(([^)]+)\)/);
    const caseMatch = exampleText.match(/^(ل?الحالة\s*\d+)/);
    const caseNum = caseMatch ? caseMatch[1] : `الحالة ${index + 1}`;
    const title = titleMatch ? titleMatch[1].trim() : '';
    return title ? `${caseNum} — ${title}` : caseNum;
}

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
        'case_story_examples_ar',
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

    const storyExamplesRaw = docs.case_story_examples_ar
        ? String(docs.case_story_examples_ar.value)
        : CASE_REGISTRATION_KEYS.case_story_examples_ar.default;

    return {
        registrationGuideAr: docs.registration_guide_ar
            ? String(docs.registration_guide_ar.value)
            : CASE_REGISTRATION_KEYS.registration_guide_ar.default,
        registrationGuideEn: docs.registration_guide_en
            ? String(docs.registration_guide_en.value)
            : CASE_REGISTRATION_KEYS.registration_guide_en.default,
        caseStoryExamplesAr: storyExamplesRaw,
        storyExamples: parseStoryExamples(storyExamplesRaw),
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

    const examples = settings.storyExamples || [];
    if (isLikelyCopiedFromExamples(storyAr, examples)) {
        req.flash('error', res.__('flash_case_story_copied_example'));
        res.redirect(redirectTo);
        return false;
    }
    if (isLikelyCopiedFromExamples(description, examples)) {
        req.flash('error', res.__('flash_case_desc_copied_example'));
        res.redirect(redirectTo);
        return false;
    }

    return true;
}

module.exports = {
    CASE_REGISTRATION_KEYS,
    REGISTRATION_CONTENT_VERSION,
    parseStoryExamples,
    storyExampleLabel,
    ensureSetting,
    syncRegistrationContentDefaults,
    loadCaseRegistrationSettings,
    validateCaseContentForRequest
};
