const getLimitMessage = (remainingFree, isPremiumTool) => {
  if (isPremiumTool) {
    return `⭐ *Premium Tool*

This tool is only available to Premium subscribers.

💰 *Upgrade for just ₦1,000/month* to unlock:
- 18 powerful tools
- Unlimited daily usage
- Priority support

Type *PREMIUM* to subscribe now!`;
  }

  if (remainingFree === 0) {
    return `⚠️ *Daily Limit Reached*

You've used all 9 free tools for today.
Your limit resets at *midnight* 🕛

💡 *Want unlimited access?*
Upgrade to Premium for just ₦1,000/month!

Type *PREMIUM* to subscribe or come back tomorrow.`;
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