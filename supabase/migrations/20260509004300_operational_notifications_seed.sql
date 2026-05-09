insert into public.operational_notifications (
    notification_type,
    title_ar,
    title_en,
    message_ar,
    message_en,
    priority,
    sound_enabled,
    vibrate_enabled,
    is_active
)
select * from (
    values
    ('START_HINT', 'ترحيب', 'Welcome', 'تم تسجيل دخولك بنجاح في نظام اللجنة الطبية العسكرية', 'You have successfully logged into the Military Medical Committee system', 'normal', false, false, true),
    ('NEAR_TURN', 'اقتراب الدور', 'Near Turn', 'اقترب دورك في {clinicName}. موقعك الحالي: {position}', 'Your turn is approaching at {clinicName}. Current position: {position}', 'high', true, false, true),
    ('YOUR_TURN', 'حان دورك', 'Your Turn', 'حان دورك في {clinicName}. رقمك: {number}. توجه للعيادة فوراً', 'It is now your turn at {clinicName}. Your number is {number}. Please proceed immediately', 'urgent', true, true, true),
    ('STEP_DONE_NEXT', 'انتهاء الخطوة', 'Step Done', 'تم إنهاء {currentClinic}. انتقل الآن إلى {nextClinic}', 'Completed {currentClinic}. Please proceed to {nextClinic}', 'high', true, false, true),
    ('QUEUE_UPDATE', 'تحديث الطابور', 'Queue Update', 'تم تحديث موقعك في الطابور في {clinicName}', 'Your queue position has been updated at {clinicName}', 'low', false, false, true),
    ('PIN_GENERATED', 'PIN جديد', 'New PIN', 'تم إنشاء PIN لـ {clinicName}: {pin}', 'A new PIN was generated for {clinicName}: {pin}', 'high', true, false, true),
    ('RESET_DONE', 'إعادة تعيين', 'Reset Done', 'تم إعادة تعيين النظام بنجاح', 'The system was reset successfully', 'normal', false, false, true),
    ('CLINIC_OPENED', 'فتح عيادة', 'Clinic Opened', 'تم فتح {clinicName}', 'Opened {clinicName}', 'normal', false, false, true),
    ('CLINIC_CLOSED', 'إغلاق عيادة', 'Clinic Closed', 'تم إغلاق {clinicName}', 'Closed {clinicName}', 'normal', false, false, true)
) as seed(notification_type, title_ar, title_en, message_ar, message_en, priority, sound_enabled, vibrate_enabled, is_active)
where not exists (
    select 1
    from public.operational_notifications o
    where o.notification_type = seed.notification_type
);

alter publication supabase_realtime add table if not exists public.operational_notifications;
