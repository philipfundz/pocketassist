const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const generatePocketId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'PA-';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
};

// Resolve phone -> account via linked_phones. Creates new account + link if none exists.
const getOrCreateUser = async (phone) => {
  const { data: link, error: linkError } = await supabase
    .from('linked_phones')
    .select('account_id')
    .eq('phone', phone)
    .single();

  if (link) {
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', link.account_id)
      .single();
    if (accountError) throw accountError;
    return { ...account, phone };
  }

  if (linkError && linkError.code !== 'PGRST116') throw linkError;

  const { data: newAccount, error: createError } = await supabase
    .from('accounts')
    .insert([{
      pocket_id: generatePocketId(),
      is_premium: false,
      daily_count: 0,
      last_reset: new Date().toISOString(),
      onboarded: false
    }])
    .select()
    .single();

  if (createError) throw createError;

  const { error: linkInsertError } = await supabase
    .from('linked_phones')
    .insert([{ phone, account_id: newAccount.id, is_primary: true }]);

  if (linkInsertError) throw linkInsertError;

  return { ...newAccount, phone };
};

// Link an additional phone to an existing account via Pocket ID
const linkPhoneToAccount = async (phone, pocketId) => {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('*')
    .eq('pocket_id', pocketId.trim().toUpperCase())
    .single();

  if (accountError || !account) {
    return { success: false, reason: 'NOT_FOUND' };
  }

  const { data: existingLink } = await supabase
    .from('linked_phones')
    .select('account_id')
    .eq('phone', phone)
    .single();

  if (existingLink && existingLink.account_id === account.id) {
    return { success: false, reason: 'ALREADY_LINKED_HERE' };
  }

  if (existingLink) {
    const { error: updateError } = await supabase
      .from('linked_phones')
      .update({ account_id: account.id, is_primary: false })
      .eq('phone', phone);
    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await supabase
      .from('linked_phones')
      .insert([{ phone, account_id: account.id, is_primary: false }]);
    if (insertError) throw insertError;
  }

  return { success: true, account };
};

const checkAndResetDaily = async (user) => {
  const lastReset = new Date(user.last_reset);
  const now = new Date();
  const isNewDay = now.toDateString() !== lastReset.toDateString();

  if (isNewDay) {
    const { data, error } = await supabase
      .from('accounts')
      .update({ daily_count: 0, last_reset: now.toISOString() })
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw error;
    return { ...data, phone: user.phone };
  }

  return user;
};

const incrementDailyCount = async (phone) => {
  const { data: link } = await supabase.from('linked_phones').select('account_id').eq('phone', phone).single();
  if (!link) return;

  const { data: account } = await supabase.from('accounts').select('daily_count').eq('id', link.account_id).single();
  await supabase.from('accounts').update({ daily_count: (account?.daily_count || 0) + 1 }).eq('id', link.account_id);
};

const setOnboarded = async (phone) => {
  const { data: link, error: linkError } = await supabase
    .from('linked_phones')
    .select('account_id')
    .eq('phone', phone)
    .single();
  if (linkError) throw linkError;

  const { error } = await supabase
    .from('accounts')
    .update({ onboarded: true })
    .eq('id', link.account_id);
  if (error) throw error;
};

const getSession = async (phone) => {
  const { data: link } = await supabase
    .from('linked_phones')
    .select('account_id')
    .eq('phone', phone)
    .single();
  if (!link) return { menu: 'main', step: null, data: {} };

  const { data: account } = await supabase
    .from('accounts')
    .select('session')
    .eq('id', link.account_id)
    .single();

  return account?.session || { menu: 'main', step: null, data: {} };
};

const setSession = async (phone, session) => {
  const { data: link } = await supabase
    .from('linked_phones')
    .select('account_id')
    .eq('phone', phone)
    .single();
  if (!link) return;

  await supabase
    .from('accounts')
    .update({ session })
    .eq('id', link.account_id);
};

const clearSession = async (phone) => {
  await setSession(phone, { menu: 'main', step: null, data: {} });
};

module.exports = {
  supabase,
  getOrCreateUser,
  linkPhoneToAccount,
  checkAndResetDaily,
  incrementDailyCount,
  setOnboarded,
  getSession,
  setSession,
  clearSession
};