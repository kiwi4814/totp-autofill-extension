(() => {
  if (globalThis.__localTotpAutofillInstalled) return;
  globalThis.__localTotpAutofillInstalled = true;

  function visible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function candidateScore(input) {
    if (input.disabled || input.readOnly || !visible(input)) return -1;
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (['password', 'hidden', 'checkbox', 'radio', 'submit', 'button', 'file'].includes(type)) return -1;

    const text = [
      input.name,
      input.id,
      input.placeholder,
      input.autocomplete,
      input.getAttribute('aria-label'),
      input.labels ? [...input.labels].map((label) => label.textContent).join(' ') : '',
    ].filter(Boolean).join(' ').toLowerCase();

    let score = 0;
    if (input.autocomplete === 'one-time-code') score += 100;
    if (/otp|totp|2fa|mfa|two.?factor|verification|authenticator|code|验证码|动态码|校验码/.test(text)) score += 60;
    if (['tel', 'text', 'number'].includes(type)) score += 15;
    const maxLength = Number(input.getAttribute('maxlength') || 0);
    if (maxLength === 6 || maxLength === 8) score += 20;
    if (/^\d{0,8}$/.test(input.value || '')) score += 5;
    return score;
  }

  function findOtpInput() {
    return [...document.querySelectorAll('input, textarea')]
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'FILL_TOTP_CODE') return false;
    const input = findOtpInput();
    if (!input) {
      sendResponse({ ok: false, error: '没有找到可填充的验证码输入框' });
      return false;
    }
    fillValue(input, String(message.code || ''));
    sendResponse({ ok: true });
    return false;
  });
})();
