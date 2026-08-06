(function () {
  'use strict';

  var CONFIG = window.__TICKETING__ || {};
  var API = String(CONFIG.apiBase || '').replace(/\/+$/, '');
  var TZ = CONFIG.timezone || 'Asia/Kolkata';
  var STORE_KEY = 'gl_admin_token';

  var els = {
    gate: document.getElementById('deskGate'),
    gateSheet: document.getElementById('deskGateSheet'),
    gateForm: document.getElementById('deskGateForm'),
    gateError: document.getElementById('deskGateError'),
    token: document.getElementById('deskToken'),
    unlock: document.getElementById('deskUnlock'),
    locked: document.getElementById('deskLocked'),
    body: document.getElementById('deskBody'),
    cards: document.getElementById('deskCards'),
    empty: document.getElementById('deskEmpty'),
    stamp: document.getElementById('deskStamp'),
    count: document.getElementById('deskCount'),
    refresh: document.getElementById('deskRefresh'),
    forget: document.getElementById('deskForget')
  };

  var token = '';

  function readToken() {
    try { return localStorage.getItem(STORE_KEY) || ''; } catch (err) { return ''; }
  }

  function writeToken(value) {
    try {
      if (value) localStorage.setItem(STORE_KEY, value);
      else localStorage.removeItem(STORE_KEY);
    } catch (err) { /* private mode — this session only */ }
  }

  function rupees(paise) {
    var value = (Number(paise) || 0) / 100;
    return '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function formatWhen(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    var day = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', day: '2-digit', month: 'short', timeZone: TZ
    }).format(date);
    var time = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ
    }).format(date).replace(/\u202f/g, ' ');
    return day + ' · ' + time.toUpperCase();
  }

  function api(path) {
    return fetch(API + path, {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (res) {
      if (res.status === 401) {
        var err = new Error('unauthorized');
        err.unauthorized = true;
        throw err;
      }
      if (!res.ok) throw new Error('request failed: ' + res.status);
      return res.json();
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function stat(value, label, extraClass) {
    var wrap = el('div', 'occ__stat' + (extraClass ? ' ' + extraClass : ''));
    wrap.appendChild(el('b', null, value));
    wrap.appendChild(el('span', null, label));
    return wrap;
  }

  function renderAttendees(occurrence, container, button) {
    button.disabled = true;
    button.textContent = 'Loading…';

    api('/api/admin/attendees?occurrence=' + encodeURIComponent(occurrence.id))
      .then(function (data) {
        container.innerHTML = '';
        var bookings = (data && data.bookings) || [];
        var live = bookings.filter(function (b) { return b.status === 'paid' || b.status === 'pending'; });

        if (!live.length) {
          container.appendChild(el('p', 'book-muted', 'Nobody has booked this date yet.'));
        } else {
          var wrap = el('div', 'att-wrap');
          var table = el('table', 'att');
          var head = el('tr');
          ['Name', 'Contact', 'Qty', 'Paid', 'Status', 'Ticket IDs'].forEach(function (label) {
            head.appendChild(el('th', null, label));
          });
          table.appendChild(head);

          live.forEach(function (booking) {
            var row = el('tr', booking.status === 'paid' ? '' : 'is-dim');
            row.appendChild(el('td', null, booking.name || '—'));

            var contact = el('td');
            contact.appendChild(el('div', null, booking.email || '—'));
            contact.appendChild(el('div', null, booking.phone || '—'));
            row.appendChild(contact);

            row.appendChild(el('td', 'num', booking.qty));
            row.appendChild(el('td', 'num', rupees(booking.amount_paise)));
            row.appendChild(el('td', null, booking.status === 'paid' ? 'Paid' : 'Holding'));

            var codes = el('td');
            (booking.codes ? String(booking.codes).split(',') : []).forEach(function (code) {
              var tag = el('code', null, code.trim());
              tag.style.marginRight = '8px';
              codes.appendChild(tag);
            });
            if (!booking.codes) codes.appendChild(document.createTextNode('—'));
            row.appendChild(codes);

            table.appendChild(row);
          });

          wrap.appendChild(table);
          container.appendChild(wrap);
        }

        container.hidden = false;
        button.disabled = false;
        button.textContent = 'Hide attendees';
        button.dataset.open = '1';
      })
      .catch(function (err) {
        button.disabled = false;
        button.textContent = 'Show attendees';
        container.innerHTML = '';
        container.appendChild(el('p', 'book-error', err.unauthorized
          ? 'Token rejected — sign out and paste it again.'
          : 'Could not load attendees. Try again.'));
        container.hidden = false;
      });
  }

  function renderOccurrence(occurrence) {
    var card = el('section', 'occ');

    var top = el('div', 'occ__top');
    var titleWrap = el('div');
    titleWrap.appendChild(el('h2', 'occ__title', occurrence.title || occurrence.event_slug));
    titleWrap.appendChild(el('div', 'occ__when',
      formatWhen(occurrence.starts_at) + ' · ' + (occurrence.venue_name || 'Venue TBA')));
    top.appendChild(titleWrap);
    top.appendChild(el('div', 'occ__when', occurrence.price_paise > 0
      ? rupees(occurrence.price_paise) + ' / ticket'
      : 'No price set'));
    card.appendChild(top);

    var capacity = Math.max(1, Number(occurrence.capacity) || 1);
    var bar = el('div', 'occ__bar');
    var sold = el('i', 'is-sold');
    sold.style.width = Math.min(100, (occurrence.sold / capacity) * 100) + '%';
    var held = el('i', 'is-held');
    held.style.width = Math.min(100, (occurrence.held / capacity) * 100) + '%';
    bar.appendChild(sold);
    bar.appendChild(held);
    card.appendChild(bar);

    var stats = el('div', 'occ__stats');
    stats.appendChild(stat(occurrence.left, 'left', 'is-left'));
    stats.appendChild(stat(occurrence.sold, 'sold'));
    if (occurrence.held) stats.appendChild(stat(occurrence.held, 'holding'));
    stats.appendChild(stat(occurrence.capacity, 'capacity'));
    stats.appendChild(stat(rupees(occurrence.revenue_paise), 'collected'));
    card.appendChild(stats);

    var flags = el('div', 'occ__flags');
    if (occurrence.price_paise <= 0) {
      flags.appendChild(el('span', 'pill pill--warn', 'No price — not sellable'));
    }
    if (occurrence.status !== 'open') {
      flags.appendChild(el('span', 'pill pill--warn', 'Status: ' + occurrence.status));
    }
    if (occurrence.on_sale) {
      flags.appendChild(el('span', 'pill', 'On sale'));
    } else if (occurrence.left <= 0 && occurrence.price_paise > 0) {
      flags.appendChild(el('span', 'pill pill--warn', 'Sold out'));
    }
    flags.appendChild(el('span', 'pill', occurrence.id));
    if (flags.childNodes.length) card.appendChild(flags);

    var attendees = el('div');
    attendees.hidden = true;

    var actions = el('div', 'occ__actions');
    var toggle = el('button', 'book-btn book-btn--ghost', 'Show attendees');
    toggle.type = 'button';
    toggle.addEventListener('click', function () {
      if (toggle.dataset.open) {
        attendees.hidden = true;
        delete toggle.dataset.open;
        toggle.textContent = 'Show attendees';
        return;
      }
      renderAttendees(occurrence, attendees, toggle);
    });
    actions.appendChild(toggle);
    card.appendChild(actions);
    card.appendChild(attendees);

    return card;
  }

  /* ------------------------------------------------------------ token gate */

  function setGateError(message) {
    if (!els.gateError) return;
    els.gateError.textContent = message || '';
    els.gateError.hidden = !message;
  }

  function setUnlockBusy(busy) {
    if (!els.unlock) return;
    els.unlock.disabled = busy;
    els.unlock.textContent = busy ? 'Checking…' : 'Unlock';
  }

  function showGate(message) {
    // Everything stays hidden until the API has accepted the token.
    if (els.body) els.body.hidden = true;
    if (els.locked) els.locked.hidden = false;
    if (els.stamp) els.stamp.textContent = '';

    if (els.gate) {
      els.gate.hidden = false;
      els.gate.setAttribute('aria-hidden', 'false');
      document.documentElement.classList.add('gate-open');
    }
    setUnlockBusy(false);
    setGateError(message);
    if (els.token) {
      els.token.value = '';
      els.token.focus();
    }
  }

  function hideGate() {
    if (!els.gate) return;
    els.gate.hidden = true;
    els.gate.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('gate-open');
    if (els.locked) els.locked.hidden = true;
    if (els.token) els.token.value = '';
    setGateError('');
    setUnlockBusy(false);
  }

  // Keep tabbing inside the dialog while it is up.
  function trapFocus(event) {
    if (!els.gate || els.gate.hidden || event.key !== 'Tab' || !els.gateSheet) return;
    var focusables = els.gateSheet.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* -------------------------------------------------------------- dashboard */

  function load(options) {
    var opts = options || {};
    if (!API) { showGate('Ticketing API is not configured for this site.'); return; }

    if (opts.fromGate) setUnlockBusy(true);
    if (els.refresh) { els.refresh.disabled = true; els.refresh.textContent = 'Refreshing…'; }

    api('/api/admin/occurrences')
      .then(function (data) {
        var list = (data && data.occurrences) || [];
        writeToken(token);
        hideGate();
        if (els.body) els.body.hidden = false;

        els.cards.innerHTML = '';
        list.forEach(function (occurrence) {
          els.cards.appendChild(renderOccurrence(occurrence));
        });

        if (els.empty) els.empty.hidden = list.length > 0;
        if (els.count) {
          var totalLeft = list.reduce(function (sum, o) { return sum + (Number(o.left) || 0); }, 0);
          els.count.textContent = list.length + ' upcoming date' + (list.length === 1 ? '' : 's')
            + ' · ' + totalLeft + ' tickets left in total';
        }
        if (els.stamp) els.stamp.textContent = 'Updated ' + formatWhen(new Date().toISOString());
      })
      .catch(function (err) {
        if (err.unauthorized) {
          writeToken('');
          token = '';
          showGate(opts.fromGate
            ? 'That token was rejected. Check it and try again.'
            : 'Your saved token is no longer valid. Paste it again.');
          return;
        }
        showGate('Could not reach the ticketing API. Check your connection and retry.');
      })
      .then(function () {
        if (els.refresh) { els.refresh.disabled = false; els.refresh.textContent = 'Refresh'; }
      });
  }

  function start() {
    if (els.gateForm) {
      els.gateForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var value = (els.token && els.token.value || '').trim();
        if (!value) { setGateError('Paste the token first.'); return; }
        // Only remembered once the API has actually accepted it.
        token = value;
        setGateError('');
        load({ fromGate: true });
      });
    }
    window.addEventListener('keydown', trapFocus);

    if (els.refresh) els.refresh.addEventListener('click', function () { load(); });
    if (els.forget) {
      els.forget.addEventListener('click', function () {
        writeToken('');
        token = '';
        showGate('');
      });
    }

    token = readToken();
    if (token) load();
    else showGate('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
