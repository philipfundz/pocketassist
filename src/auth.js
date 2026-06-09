const { getOrCreateUser, checkAndResetDaily } = require('./database');

const FREE_DAILY_LIMIT = 9;

// Main auth check — call this before every tool use
const checkAccess = async (phone) => {
  let user = await getOrCreateUser(phone);
  user = await checkAndResetDaily(user);

  return {
    user,
    isPremium: user.is_premium,
    dailyCount: user.daily_count,
    hasFreeAccess: user.daily_count < FREE_DAILY_LIMIT,
    remainingFree: Math.max(0, FREE_DAILY_LIMIT - user.daily_count)
  };
};

// Check if user can use a tool
const canUseTools = async (phone, isPremiumTool = false) => {
  const access = await checkAccess(phone);

  if (access.isPremium) {
    return { allowed: true, access };
  }

  if (isPremiumTool) {
    return {
      allowed: false,
      reason: 'premium',
      access
    };
  }

  if (!access.hasFreeAccess) {
    return {
      allowed: false,
      reason: 'limit',
      access
    };
  }

  return { allowed: true, access };
};

module.exports = { checkAccess, canUseTools };