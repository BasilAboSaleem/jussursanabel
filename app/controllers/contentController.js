const Setting = require('../models/Setting');
const { loadCaseRegistrationSettings } = require('../utils/caseRegistrationSettings');
const {
    loadSiteContentSettings,
    saveSiteContentSettings,
    parseSiteContentFromBody,
    SITE_CONTENT_SECTIONS
} = require('../utils/siteContentSettings');
const { invalidatePublicSiteCaches } = require('../middlewares/cache');

async function loadContentSettings() {
    let caseNeedsConfig = await Setting.findOne({ key: 'case_needs' });
    if (!caseNeedsConfig) {
        caseNeedsConfig = await Setting.create({
            key: 'case_needs',
            value: 'مساعدة مالية,إيواء,علاج صحي,كفالة,أخرى',
            description: 'خيارات الاحتياج المتاحة للمستفيدين عند تسجيل الحالة (مفصولة بفاصلة)'
        });
    }

    const registrationSettings = await loadCaseRegistrationSettings();
    const siteContent = await loadSiteContentSettings();

    return {
        case_needs: caseNeedsConfig.value,
        registration_guide_ar: registrationSettings.registrationGuideAr,
        registration_guide_en: registrationSettings.registrationGuideEn,
        case_story_examples_ar: registrationSettings.caseStoryExamplesAr,
        case_template_desc_ar: registrationSettings.caseTemplateDescAr,
        forbidden_words: registrationSettings.forbiddenWordsRaw,
        site_content: siteContent
    };
}

exports.getContentManagement = async (req, res) => {
    try {
        const content = await loadContentSettings();
        res.render('pages/admin/content-management', {
            title: res.__('admin_sidebar_content_management'),
            content,
            siteContentSections: SITE_CONTENT_SECTIONS
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.updateContentManagement = async (req, res) => {
    try {
        const {
            case_needs,
            registration_guide_ar,
            registration_guide_en,
            case_story_examples_ar,
            case_template_desc_ar,
            forbidden_words
        } = req.body;

        if (case_needs !== undefined) {
            await Setting.findOneAndUpdate(
                { key: 'case_needs' },
                { value: case_needs, updatedAt: new Date() },
                { upsert: true }
            );
        }

        const registrationFields = [
            ['registration_guide_ar', registration_guide_ar],
            ['registration_guide_en', registration_guide_en],
            ['case_story_examples_ar', case_story_examples_ar],
            ['case_template_desc_ar', case_template_desc_ar],
            ['forbidden_words', forbidden_words]
        ];

        for (const [key, value] of registrationFields) {
            if (value !== undefined) {
                await Setting.findOneAndUpdate(
                    { key },
                    { value: String(value), updatedAt: new Date() },
                    { upsert: true }
                );
            }
        }

        const siteUpdates = parseSiteContentFromBody(req.body);
        if (siteUpdates && Object.keys(siteUpdates).length) {
            await saveSiteContentSettings(siteUpdates);
            await invalidatePublicSiteCaches();
        }

        const { logActivity } = require('../utils/logger');
        await logActivity(
            req.user._id,
            'content_management_update',
            'ContentManagement',
            null,
            'تحديث إعدادات إدارة المحتوى: الصفحات العامة، دليل التسجيل، النماذج، الاحتياجات، والكلمات الممنوعة'
        );

        req.flash('success', res.__('flash_content_updated'));
        res.redirect('/admin/content-management');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_content_error'));
        res.redirect('/admin/content-management');
    }
};
