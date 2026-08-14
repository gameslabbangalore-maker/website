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
  els.tabs = Array.prototype.slice.call(document.querySelectorAll('[data-desk-view]'));

  var token = '';
  var occurrenceGroups = { active: [], past: [], cancelled: [] };
  var currentView = 'active';

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

  function localDayKey(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    var parts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ
    }).formatToParts(date);
    function part(type) {
      var found = parts.filter(function (item) { return item.type === type; })[0];
      return found ? found.value : '';
    }
    return part('year') + '-' + part('month') + '-' + part('day');
  }

  // During a site/Worker rollout, GitHub Pages can update before the Worker.
  // Accept the former flat-array response so the desk stays usable until the
  // grouped API deployment reaches production.
  function normalizeOccurrenceGroups(value) {
    if (!Array.isArray(value)) {
      return {
        active: Array.isArray(value && value.active) ? value.active : [],
        past: Array.isArray(value && value.past) ? value.past : [],
        cancelled: Array.isArray(value && value.cancelled) ? value.cancelled : []
      };
    }

    var today = localDayKey(new Date());
    return {
      active: value.filter(function (item) {
        return item.status !== 'cancelled' && item.status !== 'hidden' && localDayKey(item.starts_at) >= today;
      }),
      past: value.filter(function (item) {
        return item.status !== 'cancelled' && item.status !== 'hidden' && localDayKey(item.starts_at) < today;
      }).reverse(),
      cancelled: value.filter(function (item) { return item.status === 'cancelled'; }).reverse()
    };
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

  function apiPost(path, payload) {
    var headers = { Authorization: 'Bearer ' + token };
    if (payload) headers['Content-Type'] = 'application/json';
    return fetch(API + path, {
      method: 'POST', cache: 'no-store',
      headers: headers,
      body: payload ? JSON.stringify(payload) : undefined
  function apiPost(path) {
    return fetch(API + path, {
      method: 'POST', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.status === 401) { var auth = new Error('unauthorized'); auth.unauthorized = true; throw auth; }
        if (!res.ok) { var err = new Error(body.error || 'request_failed'); err.code = body.error; throw err; }
        return body;
      });
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

          var mobile = el('div', 'att-mobile');
          live.forEach(function (booking, index) {
            var item = el('div', 'att-mobile__item');
            var summary = el('div', 'att-mobile__summary');
            var identity = el('div');
            identity.appendChild(el('div', 'att-mobile__name', booking.name || '—'));
            identity.appendChild(el('div', 'att-mobile__meta', booking.status === 'paid' ? 'Paid' : 'Holding'));
            summary.appendChild(identity);
            summary.appendChild(el('div', 'att-mobile__qty', booking.qty + (Number(booking.qty) === 1 ? ' ticket' : ' tickets')));

            var detailId = 'att-detail-' + occurrence.id + '-' + index;
            var expand = el('button', 'att-mobile__toggle', '+');
            expand.type = 'button'; expand.setAttribute('aria-expanded', 'false'); expand.setAttribute('aria-controls', detailId);
            expand.setAttribute('aria-label', 'Show details for ' + (booking.name || 'attendee'));
            summary.appendChild(expand); item.appendChild(summary);

            var detail = el('div', 'att-mobile__details'); detail.id = detailId; detail.hidden = true;
            function field(label, value) { detail.appendChild(el('span', 'att-mobile__label', label)); detail.appendChild(el('span', null, value || '—')); }
            field('Email', booking.email); field('Phone', booking.phone); field('Paid', rupees(booking.amount_paise));
            field('Status', booking.status); field('Ticket IDs', booking.codes ? String(booking.codes).split(',').join(', ') : '—');
            if (booking.paid_at) field('Paid at', formatWhen(booking.paid_at));
            if (booking.razorpay_payment_id) field('Payment ref', booking.razorpay_payment_id);
            if (booking.notes) field('Notes', booking.notes);
            expand.addEventListener('click', function () {
              var opening = detail.hidden; detail.hidden = !opening; expand.textContent = opening ? '−' : '+';
              expand.setAttribute('aria-expanded', opening ? 'true' : 'false');
              expand.setAttribute('aria-label', (opening ? 'Hide' : 'Show') + ' details for ' + (booking.name || 'attendee'));
            });
            item.appendChild(detail); mobile.appendChild(item);
          });
          container.appendChild(mobile);
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

  function renderOccurrence(occurrence, view) {
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
    if (view === 'active' || view === 'past' || view === 'cancelled') {
      var menu = document.createElement('details'); menu.className = 'occ__menu';
      var summary = document.createElement('summary'); summary.setAttribute('aria-label', 'More actions for ' + (occurrence.title || 'event')); summary.textContent = '⋮';
      var panel = el('div', 'occ__menu-panel');

      function runAction(path, payload, failureMessage) {
        menu.open = false;
        apiPost('/api/admin/occurrences/' + encodeURIComponent(occurrence.id) + path, payload)
          .then(function () { load(); })
          .catch(function (err) {
      var action = el('button', null, view === 'cancelled' ? 'Remove from dashboard' : (view === 'past' ? 'Mark as cancelled' : 'Cancel event'));
      action.type = 'button';
      action.addEventListener('click', function () {
        menu.open = false;
        var hiding = view === 'cancelled';
        var message = hiding
          ? 'Remove this cancelled event from the dashboard? Its booking records will remain stored. This cannot be undone here.'
          : 'Mark this event as cancelled? It must already be removed from Google Calendar. Refunds are not automatic.';
        if (!window.confirm(message)) return;
        action.disabled = true;
        apiPost('/api/admin/occurrences/' + encodeURIComponent(occurrence.id) + (hiding ? '/hide' : '/cancel'))
          .then(function () { load(); })
          .catch(function (err) {
            action.disabled = false;
            if (err.unauthorized) { writeToken(''); token = ''; showGate('Your saved token is no longer valid. Paste it again.'); return; }
            var text = err.code === 'still_in_calendar'
              ? 'This event is still present in Google Calendar. Remove it there, wait for the public feed to update, and try again.'
              : err.code === 'calendar_check_failed'
                ? 'Google Calendar could not be verified. No changes were made; please try again.'
                : err.code === 'unsafe_or_missing'
                  ? 'That capacity is below seats already sold or held, or this event has ended.'
                  : failureMessage || 'The event could not be updated. Please refresh and try again.';
            window.alert(text);
          });
      }

      function menuButton(label, handler, danger) {
        var button = el('button', danger ? 'is-danger' : null, label); button.type = 'button'; button.addEventListener('click', handler); panel.appendChild(button);
      }

      if (view === 'active') {
        if (occurrence.status === 'open') menuButton('Pause registrations', function () {
          if (window.confirm('Pause website registrations? Existing bookings and tickets remain valid.')) runAction('/pause', null, 'Registrations could not be paused.');
        });
        if (occurrence.status === 'closed') menuButton('Resume registrations', function () {
          if (window.confirm('Resume website registrations for this date?')) runAction('/resume', null, 'Registrations cannot resume because the event ended or no seats remain.');
        });
        menuButton('Edit price', function () {
          var value = window.prompt('New ticket price in rupees for this date:', String((Number(occurrence.price_paise) || 0) / 100));
          if (value !== null) runAction('/settings', { price_rupees: value }, 'Enter a valid positive price.');
        });
        menuButton('Edit capacity', function () {
          var value = window.prompt('New website ticket limit for this date:', String(occurrence.capacity || ''));
          if (value !== null) runAction('/settings', { capacity: Number(value) }, 'Enter a valid capacity that is not below sold or held seats.');
        });
      }

      var destructiveLabel = view === 'cancelled' ? 'Remove from dashboard' : (view === 'past' ? 'Mark as cancelled' : 'Cancel event');
      menuButton(destructiveLabel, function () {
        var hiding = view === 'cancelled';
        var message = hiding
          ? 'Remove this cancelled event from the dashboard? Its booking records remain stored. This cannot be undone here.'
          : 'Mark this event as cancelled? It must already be removed from Google Calendar. Refunds are not automatic.';
        if (window.confirm(message)) runAction(hiding ? '/hide' : '/cancel');
      }, true);
      menu.appendChild(summary); menu.appendChild(panel); actions.appendChild(menu);
                : 'The event could not be updated. Please refresh and try again.';
            window.alert(text);
          });
      });
      panel.appendChild(action); menu.appendChild(summary); menu.appendChild(panel); actions.appendChild(menu);
    }
    card.appendChild(actions);
    card.appendChild(attendees);

    return card;
  }

  function renderDashboard() {
    var list = occurrenceGroups[currentView] || [];
    els.cards.innerHTML = '';
    list.forEach(function (occurrence) { els.cards.appendChild(renderOccurrence(occurrence, currentView)); });
    if (els.empty) { els.empty.hidden = list.length > 0; els.empty.textContent = currentView === 'active'
      ? 'No active dates.' : currentView === 'past' ? 'No past events.' : 'No cancelled events.'; }
    els.tabs.forEach(function (tab) {
      var view = tab.dataset.deskView; var count = (occurrenceGroups[view] || []).length;
      tab.textContent = view.charAt(0).toUpperCase() + view.slice(1) + ' (' + count + ')';
      tab.setAttribute('aria-selected', view === currentView ? 'true' : 'false');
    });
    if (els.count) {
      var totalLeft = (occurrenceGroups.active || []).reduce(function (sum, o) { return sum + (Number(o.left) || 0); }, 0);
      els.count.textContent = (occurrenceGroups.active || []).length + ' active date' + ((occurrenceGroups.active || []).length === 1 ? '' : 's') + ' · ' + totalLeft + ' tickets left';
    }
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
        occurrenceGroups = normalizeOccurrenceGroups(data && data.occurrences);
        occurrenceGroups = (data && data.occurrences) || { active: [], past: [], cancelled: [] };
        writeToken(token);
        hideGate();
        if (els.body) els.body.hidden = false;

        renderDashboard();
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
    els.tabs.forEach(function (tab) { tab.addEventListener('click', function () { currentView = tab.dataset.deskView; renderDashboard(); }); });
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
