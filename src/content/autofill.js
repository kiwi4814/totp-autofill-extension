(() => {
  if (globalThis.__localTotpAutofillInstalled) return;
  globalThis.__localTotpAutofillInstalled = true;

  const DISALLOWED_TYPES = new Set(['hidden', 'checkbox', 'radio', 'submit', 'button', 'file']);
  const OTP_HINT = /otp|totp|2fa|mfa|two.?factor|verification|authenticator|code|验证码|动态码|校验码/;

  function visible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function labelText(input) {
    return input.labels ? [...input.labels].map((label) => label.textContent).join(' ') : '';
  }

  function fieldText(input) {
    return [
      input.name,
      input.id,
      input.placeholder,
      input.autocomplete,
      input.getAttribute('aria-label'),
      labelText(input),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function maxLengthOf(input) {
    const maxLength = Number(input.getAttribute('maxlength') || 0);
    return Number.isFinite(maxLength) ? maxLength : 0;
  }

  function candidateScore(input) {
    if (input.disabled || input.readOnly || !visible(input)) return -1;
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (DISALLOWED_TYPES.has(type)) return -1;

    const text = fieldText(input);
    const maxLength = maxLengthOf(input);
    const hasStrongOtpHint = input.autocomplete === 'one-time-code'
      || OTP_HINT.test(text)
      || maxLength === 6
      || maxLength === 8;
    if (type === 'password' && !hasStrongOtpHint) return -1;

    let score = 0;
    if (input.autocomplete === 'one-time-code') score += 100;
    if (OTP_HINT.test(text)) score += 60;
    if (['tel', 'text', 'number', 'password'].includes(type)) score += 15;
    if (maxLength === 6 || maxLength === 8) score += 20;
    if (/^\d{0,8}$/.test(input.value || '')) score += 5;
    return score;
  }

  function fillableInputs() {
    return [...document.querySelectorAll('input, textarea')];
  }

  function singleCharacterOtpInputs() {
    return fillableInputs().filter((input) => {
      if (input.disabled || input.readOnly || !visible(input)) return false;
      const type = (input.getAttribute('type') || 'text').toLowerCase();
      if (DISALLOWED_TYPES.has(type)) return false;
      return maxLengthOf(input) === 1 || Number(input.getAttribute('size') || 0) === 1;
    });
  }

  function findOtpInput() {
    return fillableInputs()
      .map((input) => ({ input, score: candidateScore(input) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.input || null;
  }

  function setNativeValue(element, code) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(element, code);
  }

  function fillValue(element, code) {
    element.focus();
    setNativeValue(element, code);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: code }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillSplitCode(code) {
    const chars = [...String(code || '')];
    if (chars.length < 4 || chars.length > 8) return false;
    const inputs = singleCharacterOtpInputs();
    if (inputs.length < chars.length) return false;
    inputs.slice(0, chars.length).forEach((input, index) => fillValue(input, chars[index]));
    return true;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'FILL_TOTP_CODE') return false;
    const code = String(message.code || '');
    if (fillSplitCode(code)) {
      sendResponse({ ok: true, mode: 'split' });
      return false;
    }
    const input = findOtpInput();
    if (!input) {
      sendResponse({ ok: false, error: '没有找到可填充的验证码输入框' });
      return false;
    }
    fillValue(input, code);
    sendResponse({ ok: true, mode: 'single' });
    return false;
  });
})();
