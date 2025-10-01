(function () {
  if (typeof window === 'undefined') {
    return;
  }

  function focusElement(el) {
    if (!el || typeof el.focus !== 'function') {
      return;
    }
    try {
      el.focus({ preventScroll: true });
    } catch (err) {
      el.focus();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var overlay = document.querySelector('.thankyou-overlay');
    if (!overlay) {
      return;
    }

    var countdownEl = overlay.querySelector('[data-countdown]');
    var link = overlay.querySelector('.thankyou-link');
    var card = overlay.querySelector('.thankyou-card');

    var redirectUrl = overlay.getAttribute('data-redirect') || '/';
    var duration = parseInt(overlay.getAttribute('data-delay'), 10);
    if (!Number.isFinite(duration) || duration <= 0) {
      duration = 5;
    }

    var remaining = duration;
    if (countdownEl) {
      countdownEl.textContent = remaining;
    }

    window.setTimeout(function () {
      focusElement(card || overlay);
    }, 60);

    var timer = window.setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(timer);
        window.location.href = redirectUrl;
        return;
      }
      if (countdownEl) {
        countdownEl.textContent = remaining;
      }
    }, 1000);

    if (link) {
      link.addEventListener('click', function () {
        if (timer) {
          window.clearInterval(timer);
        }
      });
    }
  });
})();
