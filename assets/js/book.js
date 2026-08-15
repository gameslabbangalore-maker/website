(function () {
  'use strict';

  var CONFIG = window.__TICKETING__ || {};
  var API = String(CONFIG.apiBase || '').replace(/\/+$/, '');
  var TZ = CONFIG.timezone || 'Asia/Kolkata';

  var els = {
    loading: document.getElementById('bookLoading'),
    unavailable: document.getElementById('bookUnavailable'),
    unavailableTitle: document.getElementById('bookUnavailableTitle'),
    unavailableBody: document.getElementById('bookUnavailableBody'),
    form: document.getElementById('bookForm'),
    title: document.getElementById('bookEventTitle'),
    when: document.getElementById('bookWhen'),
    where: document.getElementById('bookWhere'),
    price: document.getElementById('bookPrice'),
    scarcity: document.getElementById('bookScarcity'),
    directions: document.getElementById('bookDirections')
  };

  function unavailable(title, body) {
    if (els.loading) els.loading.hidden = true;
    if (els.form) els.form.hidden = true;
    if (els.unavailableTitle) els.unavailableTitle.textContent = title;
    if (els.unavailableBody) els.unavailableBody.textContent = body || '';
    if (els.unavailable) els.unavailable.hidden = false;
  }

  function resolveOccurrenceId() {
    var params = new URLSearchParams(window.location.search);
    var direct = (params.get('o') || '').trim();
    if (direct) return Promise.resolve(direct);

    var slug = (params.get('e') || '').trim().toLowerCase();
    if (!slug) return Promise.resolve('');

    return fetch(CONFIG.calendarPath + '?v=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var events = (data && data.events) || [];
        var now = Date.now();
        var match = null;
        for (var i = 0; i < events.length; i += 1) {
          var entry = events[i];
          if (!entry || entry.slug !== slug || !entry.start) continue;
          if (Date.parse(entry.end || entry.start) <= now) continue;
          if (!match || Date.parse(entry.start) < Date.parse(match.start)) match = entry;
        }
        if (!match || !match.day_key) return '';
        return slug + '-' + String(match.day_key).replace(/-/g, '');
      })
      .catch(function () { return ''; });
  }

  function renderSummary(occurrence) {
    if (els.title) els.title.textContent = occurrence.title || 'Games Lab event';
    if (els.when) {
      els.when.textContent = window.GLBooking.formatWhen(occurrence.starts_at, TZ) || 'To be announced';
    }
    if (els.where) els.where.textContent = occurrence.venue_name || 'To be Announced';
    if (els.price) {
      els.price.textContent = window.GLBooking.rupees(occurrence.price_paise) + ' per person';
    }
    if (els.directions && occurrence.venue_map_url) {
      els.directions.href = occurrence.venue_map_url;
      els.directions.hidden = false;
    }

    // The live seat count is rendered by booking-core.js inside the form, next
    // to the quantity stepper — no need to repeat it in the summary.
    var left = Math.max(0, Number(occurrence.available) || 0);
    if (els.scarcity && left > 0 && left <= 6) {
      els.scarcity.textContent = left === 1
        ? 'Last ticket — book now'
        : 'Selling fast — ' + left + ' tickets left';
      els.scarcity.hidden = false;
    }

    if (els.loading) els.loading.hidden = true;
    if (els.form) els.form.hidden = false;
  }

  function start() {
    if (!CONFIG.enabled || !API) {
      unavailable('Booking is not available yet',
        'Online booking is still being switched on. Please use the Book Now link on the event page.');
      return;
    }
    if (!window.GLBooking) {
      unavailable('Something went wrong', 'The booking script failed to load. Please refresh.');
      return;
    }

    resolveOccurrenceId()
      .then(function (id) {
        if (!id) {
          unavailable('Which event?',
            'This link is missing an event date. Pick an event from the homepage to continue.');
          return null;
        }
        return window.GLBooking.fetchOccurrence(API, id);
      })
      .then(function (occurrence) {
        if (!occurrence) {
          if (els.unavailable && !els.unavailable.hidden) return;
          unavailable('Event not found',
            'We could not find that event date. It may have already happened.');
          return;
        }
        if (occurrence.ended || occurrence.status === 'closed' || Number(occurrence.available) <= 0) {
          unavailable('Sold out',
            'We’re sold out for this date. Keep an eye out for the next one!');
          return;
        }
        if (!occurrence.on_sale) {
          unavailable('Not open for booking yet',
            'Tickets for this date are not on sale. Message us on WhatsApp and we will sort you out.');
          return;
        }

        renderSummary(occurrence);

        var formEl = document.querySelector('[data-gl-book]');
        window.GLBooking.mount(formEl, {
          api: API,
          occurrence: occurrence,
          timezone: TZ,
          ticketPath: CONFIG.ticketPath || '/ticket/',
          onSoldOut: function () {
            unavailable('Sold out', 'The last seats went while you were filling this in. Sorry!');
          }
        });
      })
      .catch(function () {
        unavailable('Something went wrong', 'We could not load this event. Please refresh and try again.');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
