const path = require('path');
const fs = require('fs');
const Setting = require('../models/Setting');

const SITE_CONTENT_SETTING_KEY = 'site_content';

const arLocale = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../locales/ar.json'), 'utf8')
);
const enLocale = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../locales/en.json'), 'utf8')
);

function localeDefault(key) {
    return {
        ar: arLocale[key] != null ? String(arLocale[key]) : '',
        en: enLocale[key] != null ? String(enLocale[key]) : ''
    };
}

const SCALAR_DEFAULTS = {
    hero_title_en: 'Nameer',
    contact_email: 'pal-gaza@senabilcharity.org',
    contact_whatsapp: '+970593377319',
    social_facebook: 'https://www.facebook.com/senabilcharity?mibextid=wwXIfr&rdid=JHsWhvYJXH3ZokBr&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F1AraaUdVRC%2F%3Fmibextid%3DwwXIfr#',
    social_instagram: 'https://www.instagram.com/senabilcharity?utm_source=ig_web_button_share_sheet&igsh=MWhrZmxzNnNtdjY3cQ%3D%3D',
    social_youtube: 'https://www.youtube.com/@senabilcharity?themeRefresh=1',
    social_whatsapp: 'https://wa.me/970593377319',
    social_twitter: 'https://x.com/senabilcharity?t=LzwyuxUTObXuD2N1EgKrSg&s=08',
    social_tiktok: 'https://www.tiktok.com/@senabilcharity?_t=ZS-8yrWv3qp8QS&_r=1',
    transparency_stat_value_1: '100',
    transparency_stat_value_2: '1400',
    transparency_stat_value_3: '24',
    transparency_stat_value_4: '98'
};

const SITE_CONTENT_SECTIONS = [
    {
        id: 'branding',
        labelAr: 'الهوية والعلامة',
        labelEn: 'Branding',
        icon: 'fa-signature',
        theme: 'green',
        fields: [
            { key: 'hero_title', type: 'bilingual', labelAr: 'اسم المنصة', labelEn: 'Platform name' },
            { key: 'hero_title_en', type: 'scalar', labelAr: 'الاسم بالإنجليزية (تحت العنوان)', labelEn: 'English name subtitle' },
            { key: 'brand_affiliation_short', type: 'bilingual', labelAr: 'التابعية المختصرة', labelEn: 'Short affiliation' },
            { key: 'hero_affiliation', type: 'bilingual', labelAr: 'سطر التابعية', labelEn: 'Affiliation line' },
            { key: 'hero_tagline', type: 'bilingual', labelAr: 'الشعار', labelEn: 'Tagline' },
            { key: 'hero_desc', type: 'bilingual', labelAr: 'وصف المنصة', labelEn: 'Platform description', rows: 3 }
        ]
    },
    {
        id: 'navbar',
        labelAr: 'شريط التنقل',
        labelEn: 'Navigation',
        icon: 'fa-bars',
        theme: 'navy',
        fields: [
            { key: 'home', type: 'bilingual', labelAr: 'الرئيسية', labelEn: 'Home' },
            { key: 'about_us', type: 'bilingual', labelAr: 'عن نمير', labelEn: 'About' },
            { key: 'cases', type: 'bilingual', labelAr: 'الفرص', labelEn: 'Cases' },
            { key: 'navbar_transparency', type: 'bilingual', labelAr: 'الشفافية', labelEn: 'Transparency' },
            { key: 'navbar_contact', type: 'bilingual', labelAr: 'تواصل', labelEn: 'Contact' },
            { key: 'navbar_faq', type: 'bilingual', labelAr: 'الأسئلة الشائعة', labelEn: 'FAQ' },
            { key: 'navbar_login', type: 'bilingual', labelAr: 'دخول', labelEn: 'Login' },
            { key: 'navbar_register', type: 'bilingual', labelAr: 'تسجيل', labelEn: 'Register' }
        ]
    },
    {
        id: 'homepage',
        labelAr: 'الصفحة الرئيسية',
        labelEn: 'Homepage',
        icon: 'fa-house',
        theme: 'green',
        fields: [
            { key: 'btn_start_sponsorship', type: 'bilingual', labelAr: 'زر ابدأ الكفالة', labelEn: 'Start sponsorship CTA' },
            { key: 'stats_cases', type: 'bilingual', labelAr: 'إحصائية الحالات', labelEn: 'Cases stat label' },
            { key: 'stats_donations', type: 'bilingual', labelAr: 'إحصائية المتبرعين', labelEn: 'Donors stat label' },
            { key: 'stats_transparency', type: 'bilingual', labelAr: 'إحصائية الشفافية', labelEn: 'Transparency stat label' },
            { key: 'hero_emblem_donor', type: 'bilingual', labelAr: 'شارة المتبرع', labelEn: 'Donor emblem' },
            { key: 'hero_emblem_verify', type: 'bilingual', labelAr: 'شارة التحقق', labelEn: 'Verify emblem' },
            { key: 'hero_emblem_family', type: 'bilingual', labelAr: 'شارة الأسرة', labelEn: 'Family emblem' },
            { key: 'index_urgent_cases_badge', type: 'bilingual', labelAr: 'شارة الفرص العاجلة', labelEn: 'Urgent cases badge' },
            { key: 'index_urgent_cases_title', type: 'bilingual', labelAr: 'عنوان الفرص العاجلة', labelEn: 'Urgent cases title' },
            { key: 'index_all_cases', type: 'bilingual', labelAr: 'تصفح كل الفرص', labelEn: 'Browse all cases' },
            { key: 'index_watch_stories', type: 'bilingual', labelAr: 'شاهد القصص', labelEn: 'Watch stories' },
            { key: 'index_vision_title', type: 'bilingual', labelAr: 'عنوان الرؤية', labelEn: 'Vision title' },
            { key: 'index_vision_desc', type: 'bilingual', labelAr: 'وصف الرؤية', labelEn: 'Vision description', rows: 3 },
            { key: 'index_features_badge', type: 'bilingual', labelAr: 'شارة المميزات', labelEn: 'Features badge' },
            { key: 'index_features_title', type: 'bilingual', labelAr: 'عنوان المميزات', labelEn: 'Features title' },
            { key: 'index_feature_1_title', type: 'bilingual', labelAr: 'ميزة 1 — عنوان', labelEn: 'Feature 1 title' },
            { key: 'index_feature_1_desc', type: 'bilingual', labelAr: 'ميزة 1 — وصف', labelEn: 'Feature 1 description' },
            { key: 'index_feature_2_title', type: 'bilingual', labelAr: 'ميزة 2 — عنوان', labelEn: 'Feature 2 title' },
            { key: 'index_feature_2_desc', type: 'bilingual', labelAr: 'ميزة 2 — وصف', labelEn: 'Feature 2 description' },
            { key: 'index_feature_3_title', type: 'bilingual', labelAr: 'ميزة 3 — عنوان', labelEn: 'Feature 3 title' },
            { key: 'index_feature_3_desc', type: 'bilingual', labelAr: 'ميزة 3 — وصف', labelEn: 'Feature 3 description', rows: 2 },
            { key: 'index_how_it_works_badge', type: 'bilingual', labelAr: 'شارة كيف نعمل', labelEn: 'How it works badge' },
            { key: 'index_how_it_works_title', type: 'bilingual', labelAr: 'عنوان كيف نعمل', labelEn: 'How it works title' },
            { key: 'index_how_it_works_subtitle', type: 'bilingual', labelAr: 'وصف كيف نعمل', labelEn: 'How it works subtitle' },
            { key: 'index_step_1_title', type: 'bilingual', labelAr: 'الخطوة 1 — عنوان', labelEn: 'Step 1 title' },
            { key: 'index_step_1_desc', type: 'bilingual', labelAr: 'الخطوة 1 — وصف', labelEn: 'Step 1 description' },
            { key: 'index_step_2_title', type: 'bilingual', labelAr: 'الخطوة 2 — عنوان', labelEn: 'Step 2 title' },
            { key: 'index_step_2_desc', type: 'bilingual', labelAr: 'الخطوة 2 — وصف', labelEn: 'Step 2 description' },
            { key: 'index_step_3_title', type: 'bilingual', labelAr: 'الخطوة 3 — عنوان', labelEn: 'Step 3 title' },
            { key: 'index_step_3_desc', type: 'bilingual', labelAr: 'الخطوة 3 — وصف', labelEn: 'Step 3 description' },
            { key: 'index_testimonials_badge', type: 'bilingual', labelAr: 'شارة الشهادات', labelEn: 'Testimonials badge' },
            { key: 'index_testimonials_title', type: 'bilingual', labelAr: 'عنوان الشهادات', labelEn: 'Testimonials title' },
            { key: 'index_footer_cta_title', type: 'bilingual', labelAr: 'عنوان الدعوة الختامية', labelEn: 'Footer CTA title' },
            { key: 'index_footer_cta_desc', type: 'bilingual', labelAr: 'وصف الدعوة الختامية', labelEn: 'Footer CTA description', rows: 2 }
        ]
    },
    {
        id: 'about',
        labelAr: 'صفحة عن نمير',
        labelEn: 'About page',
        icon: 'fa-circle-info',
        theme: 'navy',
        fields: [
            { key: 'about_hero_badge', type: 'bilingual', labelAr: 'شارة البطل', labelEn: 'Hero badge' },
            { key: 'about_hero_title', type: 'bilingual', labelAr: 'عنوان البطل', labelEn: 'Hero title' },
            { key: 'about_hero_desc', type: 'bilingual', labelAr: 'وصف البطل', labelEn: 'Hero description', rows: 3 },
            { key: 'about_story_badge', type: 'bilingual', labelAr: 'شارة القصة', labelEn: 'Story badge' },
            { key: 'about_story_title', type: 'bilingual', labelAr: 'عنوان القصة', labelEn: 'Story title' },
            { key: 'about_story_p1', type: 'bilingual', labelAr: 'القصة — فقرة 1', labelEn: 'Story paragraph 1', rows: 3 },
            { key: 'about_story_p2', type: 'bilingual', labelAr: 'القصة — فقرة 2', labelEn: 'Story paragraph 2', rows: 3 },
            { key: 'about_vision_title', type: 'bilingual', labelAr: 'عنوان الرؤية', labelEn: 'Vision title' },
            { key: 'about_vision_desc', type: 'bilingual', labelAr: 'وصف الرؤية', labelEn: 'Vision description', rows: 2 },
            { key: 'about_mission_title', type: 'bilingual', labelAr: 'عنوان الرسالة', labelEn: 'Mission title' },
            { key: 'about_mission_desc', type: 'bilingual', labelAr: 'وصف الرسالة', labelEn: 'Mission description', rows: 2 },
            { key: 'about_goals_badge', type: 'bilingual', labelAr: 'شارة الأهداف', labelEn: 'Goals badge' },
            { key: 'about_goals_title', type: 'bilingual', labelAr: 'عنوان الأهداف', labelEn: 'Goals title' },
            { key: 'about_goal_1_title', type: 'bilingual', labelAr: 'هدف 1 — عنوان', labelEn: 'Goal 1 title' },
            { key: 'about_goal_1_desc', type: 'bilingual', labelAr: 'هدف 1 — وصف', labelEn: 'Goal 1 description' },
            { key: 'about_goal_2_title', type: 'bilingual', labelAr: 'هدف 2 — عنوان', labelEn: 'Goal 2 title' },
            { key: 'about_goal_2_desc', type: 'bilingual', labelAr: 'هدف 2 — وصف', labelEn: 'Goal 2 description' },
            { key: 'about_goal_3_title', type: 'bilingual', labelAr: 'هدف 3 — عنوان', labelEn: 'Goal 3 title' },
            { key: 'about_goal_3_desc', type: 'bilingual', labelAr: 'هدف 3 — وصف', labelEn: 'Goal 3 description' },
            { key: 'about_why_badge', type: 'bilingual', labelAr: 'شارة لماذا نمير', labelEn: 'Why badge' },
            { key: 'about_why_title', type: 'bilingual', labelAr: 'عنوان لماذا نمير', labelEn: 'Why title' },
            { key: 'about_why_1', type: 'bilingual', labelAr: 'سبب 1', labelEn: 'Reason 1' },
            { key: 'about_why_2', type: 'bilingual', labelAr: 'سبب 2', labelEn: 'Reason 2' },
            { key: 'about_why_3', type: 'bilingual', labelAr: 'سبب 3', labelEn: 'Reason 3' },
            { key: 'about_why_4', type: 'bilingual', labelAr: 'سبب 4', labelEn: 'Reason 4' },
            { key: 'about_values_badge', type: 'bilingual', labelAr: 'شارة القيم', labelEn: 'Values badge' },
            { key: 'about_values_title', type: 'bilingual', labelAr: 'عنوان القيم', labelEn: 'Values title' },
            { key: 'about_value_1_title', type: 'bilingual', labelAr: 'قيمة 1 — عنوان', labelEn: 'Value 1 title' },
            { key: 'about_value_1_desc', type: 'bilingual', labelAr: 'قيمة 1 — وصف', labelEn: 'Value 1 description' },
            { key: 'about_value_2_title', type: 'bilingual', labelAr: 'قيمة 2 — عنوان', labelEn: 'Value 2 title' },
            { key: 'about_value_2_desc', type: 'bilingual', labelAr: 'قيمة 2 — وصف', labelEn: 'Value 2 description' },
            { key: 'about_value_3_title', type: 'bilingual', labelAr: 'قيمة 3 — عنوان', labelEn: 'Value 3 title' },
            { key: 'about_value_3_desc', type: 'bilingual', labelAr: 'قيمة 3 — وصف', labelEn: 'Value 3 description' },
            { key: 'about_value_4_title', type: 'bilingual', labelAr: 'قيمة 4 — عنوان', labelEn: 'Value 4 title' },
            { key: 'about_value_4_desc', type: 'bilingual', labelAr: 'قيمة 4 — وصف', labelEn: 'Value 4 description' },
            { key: 'about_cta_title', type: 'bilingual', labelAr: 'عنوان الدعوة', labelEn: 'CTA title' },
            { key: 'about_cta_desc', type: 'bilingual', labelAr: 'وصف الدعوة', labelEn: 'CTA description', rows: 2 },
            { key: 'about_cta_btn_start', type: 'bilingual', labelAr: 'زر ابدأ', labelEn: 'Start button' },
            { key: 'about_cta_btn_contact', type: 'bilingual', labelAr: 'زر تواصل', labelEn: 'Contact button' }
        ]
    },
    {
        id: 'faq',
        labelAr: 'الأسئلة الشائعة',
        labelEn: 'FAQ',
        icon: 'fa-circle-question',
        theme: 'purple',
        fields: [
            { key: 'faq_title', type: 'bilingual', labelAr: 'عنوان القسم', labelEn: 'Section title' },
            { key: 'faq_subtitle', type: 'bilingual', labelAr: 'وصف القسم', labelEn: 'Section subtitle' },
            { key: 'faq_q1', type: 'bilingual', labelAr: 'سؤال 1', labelEn: 'Question 1' },
            { key: 'faq_a1', type: 'bilingual', labelAr: 'جواب 1', labelEn: 'Answer 1', rows: 2 },
            { key: 'faq_q2', type: 'bilingual', labelAr: 'سؤال 2', labelEn: 'Question 2' },
            { key: 'faq_a2', type: 'bilingual', labelAr: 'جواب 2', labelEn: 'Answer 2', rows: 2 },
            { key: 'faq_q3', type: 'bilingual', labelAr: 'سؤال 3', labelEn: 'Question 3' },
            { key: 'faq_a3', type: 'bilingual', labelAr: 'جواب 3', labelEn: 'Answer 3', rows: 2 },
            { key: 'faq_q4', type: 'bilingual', labelAr: 'سؤال 4', labelEn: 'Question 4' },
            { key: 'faq_a4', type: 'bilingual', labelAr: 'جواب 4', labelEn: 'Answer 4', rows: 2 }
        ]
    },
    {
        id: 'contact',
        labelAr: 'صفحة التواصل',
        labelEn: 'Contact page',
        icon: 'fa-envelope',
        theme: 'green',
        fields: [
            { key: 'contact_hero_badge', type: 'bilingual', labelAr: 'شارة البطل', labelEn: 'Hero badge' },
            { key: 'contact_hero_title', type: 'bilingual', labelAr: 'عنوان البطل', labelEn: 'Hero title' },
            { key: 'contact_hero_desc', type: 'bilingual', labelAr: 'وصف البطل', labelEn: 'Hero description', rows: 3 },
            { key: 'contact_channels_badge', type: 'bilingual', labelAr: 'شارة القنوات', labelEn: 'Channels badge' },
            { key: 'contact_channels_title', type: 'bilingual', labelAr: 'عنوان القنوات', labelEn: 'Channels title' },
            { key: 'contact_channels_desc', type: 'bilingual', labelAr: 'وصف القنوات', labelEn: 'Channels description', rows: 2 },
            { key: 'contact_whatsapp_title', type: 'bilingual', labelAr: 'عنوان واتساب', labelEn: 'WhatsApp title' },
            { key: 'contact_whatsapp_desc', type: 'bilingual', labelAr: 'وصف واتساب', labelEn: 'WhatsApp description' },
            { key: 'contact_email_title', type: 'bilingual', labelAr: 'عنوان البريد', labelEn: 'Email title' },
            { key: 'contact_office_title', type: 'bilingual', labelAr: 'عنوان المكتب', labelEn: 'Office title' },
            { key: 'contact_office_desc', type: 'bilingual', labelAr: 'عنوان المكتب — تفاصيل', labelEn: 'Office address' },
            { key: 'contact_form_title', type: 'bilingual', labelAr: 'عنوان النموذج', labelEn: 'Form title' },
            { key: 'contact_form_desc', type: 'bilingual', labelAr: 'وصف النموذج', labelEn: 'Form description' },
            { key: 'contact_map_title', type: 'bilingual', labelAr: 'عنوان الخريطة', labelEn: 'Map title' },
            { key: 'contact_map_desc', type: 'bilingual', labelAr: 'وصف الخريطة', labelEn: 'Map description', rows: 2 }
        ]
    },
    {
        id: 'transparency',
        labelAr: 'صفحة الشفافية',
        labelEn: 'Transparency page',
        icon: 'fa-chart-line',
        theme: 'navy',
        fields: [
            { key: 'transparency_hero_badge', type: 'bilingual', labelAr: 'شارة البطل', labelEn: 'Hero badge' },
            { key: 'transparency_hero_title', type: 'bilingual', labelAr: 'عنوان البطل', labelEn: 'Hero title' },
            { key: 'transparency_hero_desc', type: 'bilingual', labelAr: 'وصف البطل', labelEn: 'Hero description', rows: 3 },
            { key: 'transparency_stat_1', type: 'bilingual', labelAr: 'إحصائية 1 — تسمية', labelEn: 'Stat 1 label' },
            { key: 'transparency_stat_value_1', type: 'scalar', labelAr: 'إحصائية 1 — قيمة', labelEn: 'Stat 1 value' },
            { key: 'transparency_stat_2', type: 'bilingual', labelAr: 'إحصائية 2 — تسمية', labelEn: 'Stat 2 label' },
            { key: 'transparency_stat_value_2', type: 'scalar', labelAr: 'إحصائية 2 — قيمة', labelEn: 'Stat 2 value' },
            { key: 'transparency_stat_3', type: 'bilingual', labelAr: 'إحصائية 3 — تسمية', labelEn: 'Stat 3 label' },
            { key: 'transparency_stat_value_3', type: 'scalar', labelAr: 'إحصائية 3 — قيمة', labelEn: 'Stat 3 value' },
            { key: 'transparency_stat_4', type: 'bilingual', labelAr: 'إحصائية 4 — تسمية', labelEn: 'Stat 4 label' },
            { key: 'transparency_stat_value_4', type: 'scalar', labelAr: 'إحصائية 4 — قيمة', labelEn: 'Stat 4 value' },
            { key: 'transparency_journey_badge', type: 'bilingual', labelAr: 'شارة الرحلة', labelEn: 'Journey badge' },
            { key: 'transparency_journey_title', type: 'bilingual', labelAr: 'عنوان الرحلة', labelEn: 'Journey title' },
            { key: 'transparency_journey_desc', type: 'bilingual', labelAr: 'وصف الرحلة', labelEn: 'Journey description', rows: 2 },
            { key: 'transparency_step_1_title', type: 'bilingual', labelAr: 'خطوة 1 — عنوان', labelEn: 'Step 1 title' },
            { key: 'transparency_step_1_desc', type: 'bilingual', labelAr: 'خطوة 1 — وصف', labelEn: 'Step 1 description', rows: 2 },
            { key: 'transparency_step_2_title', type: 'bilingual', labelAr: 'خطوة 2 — عنوان', labelEn: 'Step 2 title' },
            { key: 'transparency_step_2_desc', type: 'bilingual', labelAr: 'خطوة 2 — وصف', labelEn: 'Step 2 description', rows: 2 },
            { key: 'transparency_step_3_title', type: 'bilingual', labelAr: 'خطوة 3 — عنوان', labelEn: 'Step 3 title' },
            { key: 'transparency_step_3_desc', type: 'bilingual', labelAr: 'خطوة 3 — وصف', labelEn: 'Step 3 description', rows: 2 },
            { key: 'transparency_reports_badge', type: 'bilingual', labelAr: 'شارة التقارير', labelEn: 'Reports badge' },
            { key: 'transparency_reports_title', type: 'bilingual', labelAr: 'عنوان التقارير', labelEn: 'Reports title' },
            { key: 'transparency_report_1_title', type: 'bilingual', labelAr: 'تقرير 1 — عنوان', labelEn: 'Report 1 title' },
            { key: 'transparency_report_1_desc', type: 'bilingual', labelAr: 'تقرير 1 — وصف', labelEn: 'Report 1 description', rows: 2 },
            { key: 'transparency_report_2_title', type: 'bilingual', labelAr: 'تقرير 2 — عنوان', labelEn: 'Report 2 title' },
            { key: 'transparency_report_2_desc', type: 'bilingual', labelAr: 'تقرير 2 — وصف', labelEn: 'Report 2 description', rows: 2 },
            { key: 'transparency_report_3_title', type: 'bilingual', labelAr: 'تقرير 3 — عنوان', labelEn: 'Report 3 title' },
            { key: 'transparency_report_3_desc', type: 'bilingual', labelAr: 'تقرير 3 — وصف', labelEn: 'Report 3 description', rows: 2 },
            { key: 'transparency_trust_title', type: 'bilingual', labelAr: 'عنوان الثقة', labelEn: 'Trust title' },
            { key: 'transparency_trust_desc', type: 'bilingual', labelAr: 'وصف الثقة', labelEn: 'Trust description', rows: 3 },
            { key: 'transparency_trust_policy', type: 'bilingual', labelAr: 'سياسة الخصوصية', labelEn: 'Privacy policy line' }
        ]
    },
    {
        id: 'cases',
        labelAr: 'صفحة الفرص',
        labelEn: 'Cases page',
        icon: 'fa-hand-holding-heart',
        theme: 'purple',
        fields: [
            { key: 'cases_hero_title', type: 'bilingual', labelAr: 'عنوان البطل', labelEn: 'Hero title' },
            { key: 'cases_hero_desc', type: 'bilingual', labelAr: 'وصف البطل', labelEn: 'Hero description', rows: 3 }
        ]
    },
    {
        id: 'footer',
        labelAr: 'التذييل والتواصل',
        labelEn: 'Footer & contact',
        icon: 'fa-shoe-prints',
        theme: 'green',
        fields: [
            { key: 'footer_desc', type: 'bilingual', labelAr: 'وصف التذييل', labelEn: 'Footer description', rows: 3 },
            { key: 'footer_links_title', type: 'bilingual', labelAr: 'عنوان الروابط', labelEn: 'Links title' },
            { key: 'footer_all_cases', type: 'bilingual', labelAr: 'جميع الفرص', labelEn: 'All cases link' },
            { key: 'footer_orphan_sponsorship', type: 'bilingual', labelAr: 'كفالة الأيتام', labelEn: 'Orphan sponsorship' },
            { key: 'footer_family_support', type: 'bilingual', labelAr: 'دعم الأسر', labelEn: 'Family support' },
            { key: 'footer_contact_title', type: 'bilingual', labelAr: 'عنوان التواصل', labelEn: 'Contact title' },
            { key: 'footer_location', type: 'bilingual', labelAr: 'الموقع', labelEn: 'Location' },
            { key: 'footer_working_hours_title', type: 'bilingual', labelAr: 'عنوان ساعات العمل', labelEn: 'Working hours title' },
            { key: 'footer_working_hours_val', type: 'bilingual', labelAr: 'ساعات العمل', labelEn: 'Working hours value' },
            { key: 'contact_email', type: 'scalar', labelAr: 'البريد الإلكتروني', labelEn: 'Email address' },
            { key: 'contact_whatsapp', type: 'scalar', labelAr: 'رقم واتساب', labelEn: 'WhatsApp number' },
            { key: 'social_facebook', type: 'scalar', labelAr: 'رابط فيسبوك', labelEn: 'Facebook URL' },
            { key: 'social_instagram', type: 'scalar', labelAr: 'رابط إنستغرام', labelEn: 'Instagram URL' },
            { key: 'social_youtube', type: 'scalar', labelAr: 'رابط يوتيوب', labelEn: 'YouTube URL' },
            { key: 'social_whatsapp', type: 'scalar', labelAr: 'رابط واتساب', labelEn: 'WhatsApp URL' },
            { key: 'social_twitter', type: 'scalar', labelAr: 'رابط X', labelEn: 'X/Twitter URL' },
            { key: 'social_tiktok', type: 'scalar', labelAr: 'رابط تيك توك', labelEn: 'TikTok URL' }
        ]
    },
    {
        id: 'seo',
        labelAr: 'تحسين محركات البحث',
        labelEn: 'SEO',
        icon: 'fa-magnifying-glass',
        theme: 'navy',
        fields: [
            { key: 'meta_default_description', type: 'bilingual', labelAr: 'وصف الموقع (meta)', labelEn: 'Meta description', rows: 2 },
            { key: 'meta_default_keywords', type: 'bilingual', labelAr: 'الكلمات المفتاحية', labelEn: 'Meta keywords', rows: 2 }
        ]
    }
];

function buildDefaultSiteContent() {
    const defaults = {};
    for (const section of SITE_CONTENT_SECTIONS) {
        for (const field of section.fields) {
            if (field.type === 'bilingual') {
                defaults[field.key] = localeDefault(field.key);
            } else if (field.type === 'scalar') {
                defaults[field.key] = SCALAR_DEFAULTS[field.key] != null
                    ? String(SCALAR_DEFAULTS[field.key])
                    : '';
            }
        }
    }
    return defaults;
}

let memoryCache = null;
let memoryCacheAt = 0;
const MEMORY_TTL_MS = 30_000;

function mergeWithDefaults(stored) {
    const defaults = buildDefaultSiteContent();
    const merged = { ...defaults };
    if (!stored || typeof stored !== 'object') return merged;

    for (const [key, value] of Object.entries(stored)) {
        if (defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
            merged[key] = {
                ar: value?.ar != null ? String(value.ar) : defaults[key].ar,
                en: value?.en != null ? String(value.en) : defaults[key].en
            };
        } else if (value != null) {
            merged[key] = String(value);
        }
    }
    return merged;
}

function resolveSiteText(content, key, locale, translateFn) {
    const item = content?.[key];
    if (item != null) {
        if (typeof item === 'object' && (item.ar !== undefined || item.en !== undefined)) {
            const value = item[locale] || item.ar || item.en;
            if (value != null && String(value).trim() !== '') return String(value);
        } else if (typeof item === 'string' && item.trim() !== '') {
            return item;
        } else if (typeof item === 'number') {
            return String(item);
        }
    }
    return typeof translateFn === 'function' ? translateFn(key) : '';
}

function parseSiteContentFromBody(body) {
    const raw = body?.site_content;
    if (!raw || typeof raw !== 'object') return null;

    const updates = {};
    for (const section of SITE_CONTENT_SECTIONS) {
        for (const field of section.fields) {
            const entry = raw[field.key];
            if (entry === undefined) continue;

            if (field.type === 'bilingual') {
                updates[field.key] = {
                    ar: entry?.ar != null ? String(entry.ar) : '',
                    en: entry?.en != null ? String(entry.en) : ''
                };
            } else {
                updates[field.key] = entry != null ? String(entry) : '';
            }
        }
    }
    return updates;
}

async function loadSiteContentSettings({ bypassCache = false } = {}) {
    const now = Date.now();
    if (!bypassCache && memoryCache && now - memoryCacheAt < MEMORY_TTL_MS) {
        return memoryCache;
    }

    let doc = await Setting.findOne({ key: SITE_CONTENT_SETTING_KEY });
    if (!doc) {
        const defaults = buildDefaultSiteContent();
        doc = await Setting.create({
            key: SITE_CONTENT_SETTING_KEY,
            value: defaults,
            description: 'محتوى الصفحات العامة للمنصة (نصوص ثنائية اللغة وبيانات التواصل)'
        });
    }

    const merged = mergeWithDefaults(doc.value);
    memoryCache = merged;
    memoryCacheAt = now;
    return merged;
}

async function saveSiteContentSettings(updates) {
    const current = await loadSiteContentSettings({ bypassCache: true });
    const next = mergeWithDefaults({ ...current, ...updates });

    await Setting.findOneAndUpdate(
        { key: SITE_CONTENT_SETTING_KEY },
        { value: next, updatedAt: new Date() },
        { upsert: true }
    );

    memoryCache = next;
    memoryCacheAt = Date.now();
    return next;
}

function clearSiteContentCache() {
    memoryCache = null;
    memoryCacheAt = 0;
}

function getAllSiteTextKeys() {
    const keys = [];
    for (const section of SITE_CONTENT_SECTIONS) {
        for (const field of section.fields) {
            keys.push(field.key);
        }
    }
    return keys;
}

module.exports = {
    SITE_CONTENT_SETTING_KEY,
    SITE_CONTENT_SECTIONS,
    buildDefaultSiteContent,
    loadSiteContentSettings,
    saveSiteContentSettings,
    parseSiteContentFromBody,
    resolveSiteText,
    clearSiteContentCache,
    getAllSiteTextKeys
};
