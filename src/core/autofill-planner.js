const DISALLOWED_TYPES = new Set(['hidden', 'checkbox', 'radio', 'submit', 'button', 'file']);
const OTP_HINT = /otp|totp|2fa|mfa|two.?factor|verification|authenticator|code|验证码|动态码|校验码/;

function textFor(input) {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.autocomplete,
    input.ariaLabel,
    input.labelText,
  ].filter(Boolean).join(' ').toLowerCase();
}

function maxLengthOf(input) {
  const value = Number(input.maxLength || input.maxlength || 0);
  return Number.isFinite(value) ? value : 0;
}

function isVisible(input) {
  return input.visible !== false && !input.disabled && !input.readOnly;
}

function isSingleCharacterOtpBox(input) {
  if (!isVisible(input)) return false;
  const type = String(input.type || 'text').toLowerCase();
  if (DISALLOWED_TYPES.has(type)) return false;
  return maxLengthOf(input) === 1 || Number(input.size || 0) === 1;
}

export function scoreOtpInput(input) {
  if (!isVisible(input)) return -1;
  const type = String(input.type || 'text').toLowerCase();
  if (DISALLOWED_TYPES.has(type)) return -1;

  const text = textFor(input);
  const maxLength = maxLengthOf(input);
  const hasStrongOtpHint = input.autocomplete === 'one-time-code' || OTP_HINT.test(text) || maxLength === 6 || maxLength === 8;
  if (type === 'password' && !hasStrongOtpHint) return -1;

  let score = 0;
  if (input.autocomplete === 'one-time-code') score += 100;
  if (OTP_HINT.test(text)) score += 60;
  if (['tel', 'text', 'number', 'password'].includes(type)) score += 15;
  if (maxLength === 6 || maxLength === 8) score += 20;
  if (/^\d{0,8}$/.test(input.value || '')) score += 5;
  return score;
}

export function chooseAutofillPlan(inputs, code) {
  const value = String(code || '');
  const splitCandidates = inputs
    .map((input, index) => ({ input, index }))
    .filter(({ input }) => isSingleCharacterOtpBox(input));

  if (value.length >= 4 && value.length <= 8 && splitCandidates.length >= value.length) {
    const selected = splitCandidates.slice(0, value.length);
    return {
      mode: 'split',
      indexes: selected.map((item) => item.index),
      values: [...value],
    };
  }

  const best = inputs
    .map((input, index) => ({ index, score: scoreOtpInput(input) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  return best ? { mode: 'single', index: best.index, value } : null;
}
