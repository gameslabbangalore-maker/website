(function () {
  'use strict';

  var CONFIG = window.__TICKETING__ || {};
  var API = String(CONFIG.apiBase || '').replace(/\/+$/, '');
  var TZ = CONFIG.timezone || 'Asia/Kolkata';

  var SCHEDULE = [1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 8000,
                  8000, 8000, 8000, 10000, 10000];

  var views = {
    pending: document.getElementById('ticketPending'),
    confirmed: document.getElementById('ticketConfirmed'),
    failed: document.getElementById('ticketFailed'),
    missing: document.getElementById('ticketMissing'),
    slow: document.getElementById('ticketSlow')
  };

  var attempt = 0;
  var timer = null;

  function showOnly(name) {
    Object.keys(views).forEach(function (key) {
      if (views[key]) views[key].hidden = key !== name;
    });
  }

  function rupees(paise) {
    var value = (Number(paise) || 0) / 100;
    return '₹' + value.toLocaleString('en-IN', {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  function formatWhen(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    var day = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ
    }).format(date);
    var time = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ
    }).format(date).replace(/\u202f/g, ' ');
    return day + ' · ' + time.toUpperCase();
  }

  function text(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value == null ? '—' : String(value);
  }

  function icsHref(event) {
    var start = new Date(event.starts_at);
    if (isNaN(start.getTime())) return '';
    var end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var stamp = function (d) {
      return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
             pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
    };
    var location = event.venue_map_url
      ? event.venue_name + ' (' + event.venue_map_url + ')'
      : event.venue_name;

    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Games Lab//Tickets//EN', 'BEGIN:VEVENT',
      'DTSTAMP:' + stamp(new Date()),
      'DTSTART:' + stamp(start),
      'DTEND:' + stamp(end),
      'SUMMARY:' + (event.title || 'Games Lab'),
      'LOCATION:' + String(location || '').replace(/,/g, '\\,'),
      'DESCRIPTION:' + window.location.href,
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return 'data:text/calendar;charset=utf8,' + encodeURIComponent(lines.join('\r\n'));
  }

  function renderConfirmed(data) {
    var booking = data.booking || {};
    var event = data.event || {};
    var tickets = data.tickets || [];

    text('ticketEvent', event.title || 'Games Lab event');
    text('ticketWhen', formatWhen(event.starts_at) || 'To be announced');
    text('ticketWhere', event.venue_name || 'To be Announced');
    text('ticketName', booking.name);
    text('ticketQty', booking.qty);
    text('ticketPaid', rupees(booking.amount_paise));

    var list = document.getElementById('ticketCodes');
    if (list) {
      list.innerHTML = '';
      tickets.forEach(function (ticket, index) {
        var li = document.createElement('li');
        li.className = 'ticket-code';

        var label = document.createElement('span');
        label.className = 'ticket-code-seat';
        label.textContent = tickets.length > 1
          ? 'TICKET ID ' + (index + 1) + ' OF ' + tickets.length
          : 'TICKET ID';
        li.appendChild(label);

        if (API) {
          var qr = document.createElement('img');
          qr.className = 'ticket-qr';
          qr.width = 190;
          qr.height = 190;
          qr.alt = 'QR code for ticket ' + ticket.code;
          qr.src = API + '/api/qr?s=8&d=' + encodeURIComponent(ticket.code);
          li.appendChild(qr);
        }

        var value = document.createElement('span');
        value.className = 'ticket-code-value';
        value.textContent = ticket.code;
        li.appendChild(value);

        list.appendChild(li);
      });
    }

    var directions = document.getElementById('ticketDirections');
    if (directions && event.venue_map_url) {
      directions.href = event.venue_map_url;
      directions.hidden = false;
    }

    var addCal = document.getElementById('ticketAddCal');
    if (addCal) {
      var href = icsHref(event);
      if (href) {
        addCal.href = href;
        addCal.setAttribute('download', 'games-lab-event.ics');
        addCal.hidden = false;
      }
    }

    var note = document.getElementById('ticketEmailNote');
    if (note) {
      note.textContent = booking.email
        ? 'A copy is on its way to ' + booking.email + '.'
        : '';
    }

    showOnly('confirmed');
  }

  function renderFailed(status) {
    var title = document.getElementById('ticketFailedTitle');
    var body = document.getElementById('ticketFailedBody');

    if (status === 'expired') {
      if (title) title.textContent = 'Your seat hold expired';
      if (body) body.textContent = 'The payment wasn’t completed in time, so the seats went back on sale. You have not been charged.';
    } else if (status === 'refunded') {
      if (title) title.textContent = 'This booking was refunded';
      if (body) body.textContent = 'The amount has been returned to your original payment method.';
    } else {
      if (title) title.textContent = 'Payment didn’t go through';
      if (body) body.textContent = 'You have not been charged. You’re welcome to try again — seats are released back immediately.';
    }
    showOnly('failed');
  }

  function renderSlow(bookingRef) {
    var link = document.getElementById('ticketSlowLink');
    if (link) link.textContent = window.location.href;
    showOnly('slow');

    var recheck = document.getElementById('ticketRecheck');
    if (recheck) {
      recheck.onclick = function () {
        attempt = 0;
        showOnly('pending');
        poll(bookingRef);
      };
    }
  }

  function poll(ref) {
    if (timer) { clearTimeout(timer); timer = null; }

    fetch(API + '/api/bookings/' + encodeURIComponent(ref.id) + '?token=' + encodeURIComponent(ref.token), {
      cache: 'no-store'
    })
      .then(function (res) {
        if (res.status === 404 || res.status === 401) return { gone: true };
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data) throw new Error('empty');
        if (data.gone) { showOnly('missing'); return; }

        var status = data.booking && data.booking.status;

        if (status === 'paid') {
          if ((data.tickets || []).length) { renderConfirmed(data); }
          else { scheduleNext(ref); }
          return;
        }

        if (status === 'failed' || status === 'expired' || status === 'refunded') {
          renderFailed(status);
          return;
        }

        scheduleNext(ref);
      })
      .catch(function () { scheduleNext(ref); });
  }

  function scheduleNext(ref) {
    if (attempt >= SCHEDULE.length) { renderSlow(ref); return; }
    var delay = SCHEDULE[attempt];
    attempt += 1;
    timer = setTimeout(function () { poll(ref); }, delay);
  }

  function readRef() {
    var params = new URLSearchParams(window.location.search);
    var id = (params.get('b') || '').trim();
    var token = (params.get('t') || '').trim();
    if (id && token) return { id: id, token: token };

    try {
      var saved = JSON.parse(sessionStorage.getItem('gl_booking') || 'null');
      if (saved && saved.id && saved.token) return saved;
    } catch (err) { /* ignore */ }
    return null;
  }

  function start() {
    var printBtn = document.getElementById('ticketPrint');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

    if (!CONFIG.enabled || !API) { showOnly('missing'); return; }

    var ref = readRef();
    if (!ref) { showOnly('missing'); return; }

    showOnly('pending');
    poll(ref);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
