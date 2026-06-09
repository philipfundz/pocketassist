const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Get or create user
const getOrCreateUser = async (phone) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();

  if (error && error.code === 'PGRST116') {
    // User doesn't exist, create new
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert([{
        phone,
        pocket_id: generatePocketId(),
        is_premium: false,
        daily_count: 0,
        last_reset: new Date().toISOString(),
        onboarded: false
      }])
      .select()
      .single();

    if (createError) throw createError;
    return newUser;
  }

  if (error) throw error;
  return data;
};

// Generate Pocket ID
const generatePocketId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'PA-';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
};

// Reset daily count if it's a new day
const checkAndResetDaily = async (user) => {
  const lastReset = new Date(user.last_reset);
  const now = new Date();
  const isNewDay = now.toDateString() !== lastReset.toDateString();

  if (isNewDay) {
    const { data, error } = await supabase
      .from('users')
      .update({ daily_count: 0, last_reset: now.toISOString() })
      .eq('phone', user.phone)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  return user;
};

// Increment daily count
const incrementDailyCount = async (phone) => {
  const { error } = await supabase.rpc('increment_daily_count', { user_phone: phone });
  if (error) {
    // fallback manual increment
    const { data: user } = await supabase.from('users').select('daily_count').eq('phone', phone).single();
    await supabase.from('users').update({ daily_count: (user?.daily_count || 0) + 1 }).eq('phone', phone);
  }
};

// Update onboarded status
const setOnboarded = async (phone) => {
  const { error } = await supabase
    .from('users')
    .update({ onboarded: true })
    .eq('phone', phone);
  if (error) throw error;
};

module.exports = {
  supabase,
  getOrCreateUser,
  checkAndResetDaily,
  incrementDailyCount,
  setOnboarded
};