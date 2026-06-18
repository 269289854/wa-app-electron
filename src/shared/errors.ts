export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid_state') || normalized.includes('sign-in session is no longer valid') || normalized.includes('please start over to continue')) {
    return 'OpenAI 登录已过期，请在插件打开的 OpenAI 页面重新登录后再继续';
  }
  if (message.includes('OpenAI 已超过请求手机号次数') || normalized.includes('too many phone verification requests') || normalized.includes('rate_limit_exceeded')) {
    return 'OpenAI 已超过请求手机号次数，请稍后再试或关闭 OpenAI 手机号检查';
  }
  if (normalized.includes('reason=blocked') || normalized.includes('number is blocked')) return '号码被 WhatsApp 拒绝或封禁，当前协议链路无法发起验证码。';
  if (normalized.includes('too_recent') || normalized.includes('too_many') || normalized.includes('cooling down') || normalized.includes('rate_limited')) return '请求过于频繁，正在冷却中，请稍后再试。';
  if (normalized.includes('no_routes') || normalized.includes('route_unavailable')) return '暂无可用验证码通道，请换 SMS/语音或稍后再试。';
  if (normalized.includes('smsbower has no numbers')) return 'SMSBower 当前无法按这个国家/价格下单：平台返回 NO_NUMBERS。请检查国家参数是否为 SMSBower 国家 ID，或提高最高价格/更换国家后再试。';
  if (normalized.includes('smsbower balance is insufficient')) return 'SMSBower 余额不足，平台返回 NO_BALANCE。';
  return message;
}
