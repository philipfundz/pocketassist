const getLimitMessage = (remainingFree, isPremiumTool) => {
  if (isPremiumTool) {
    return `━━━━━━━━━━━━━━━━━━
⭐ *Premium Feature*
━━━━━━━━━━━━━━━━━━

This tool is available to Premium subscribers only.

*Upgrade to Premium* for ₦1,000/month and get:
- All 18 tools unlocked
- Higher daily limits
- Priority processing

Type *PREMIUM* to subscribe.`;
  }

  if (remainingFree === 0) {
    return `━━━━━━━━━━━━━━━━━━
⚠️ *Daily Limit Reached*
━━━━━━━━━━━━━━━━━━

You've used all 9 free actions for today.
Your limit resets at *midnight* 🕛

*Want more?* Upgrade to Premium for ₦1,000/month — no daily cap.

Type *PREMIUM* to upgrade, or check back tomorrow.`;
  }

  return null;
};

const guardMessage = (access, isPremiumTool = false) => {
  if (access.isPremium) return null;
  if (isPremiumTool) return getLimitMessage(0, true);
  if (!access.hasFreeAccess) return getLimitMessage(0, false);
  return null;
};

module.exports = { guardMessage, getLimitMessage };