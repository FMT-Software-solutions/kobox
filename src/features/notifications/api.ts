import { supabase } from '@/lib/supabase';

export interface NotificationPreferences {
  pushEnabled: boolean;
  smsEnabled: boolean;
  remindersEnabled: boolean;
}

const DEFAULTS: NotificationPreferences = {
  pushEnabled: true,
  smsEnabled: true,
  remindersEnabled: true,
};

/** Absent preferences mean the defaults, not "everything off". */
export async function fetchPreferences(memberId: string): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('push_enabled, sms_enabled, reminders_enabled')
    .eq('member_id', memberId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return DEFAULTS;

  return {
    pushEnabled: data.push_enabled,
    smsEnabled: data.sms_enabled,
    remindersEnabled: data.reminders_enabled,
  };
}

export async function savePreferences(input: {
  memberId: string;
  preferences: NotificationPreferences;
}) {
  const { error } = await supabase.from('notification_preferences').upsert(
    {
      member_id: input.memberId,
      push_enabled: input.preferences.pushEnabled,
      sms_enabled: input.preferences.smsEnabled,
      reminders_enabled: input.preferences.remindersEnabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'member_id' }
  );

  if (error) throw error;
}
