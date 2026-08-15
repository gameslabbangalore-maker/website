(function () {
  'use strict';

  var NBSP_THIN = /\u202f/g;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PHONE_RE = /^(?:\+?91|0)?[6-9]\d{9}$/;
  var MAX_QTY = 10;

  function rupees(paise) {
    var value = (Number(paise) || 0) / 100;
    return '₹' + value.toLocaleString('en-IN', {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  function formatWhen(iso, timeZone) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    var day = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: timeZone
    }).format(date);
    var time = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: timeZone
    }).format(date).replace(NBSP_THIN, ' ');
    return day + ' · ' + time.toUpperCase();
  }

  function fetchOccurrence(api, id) {
    return fetch(api + '/api/occurrences/' + encodeURIComponent(id), { cache: 'no-store' })
      .then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('lookup failed: ' + res.status);
        return res.json();
      })
      .then(function (data) { return (data && data.occurrence) || null; });
  }

  function mount(form, options) {
    if (!form || form.__glBookMounted) return null;
    form.__glBookMounted = true;

    var opts = options || {};
    var api = String(opts.api || '').replace(/\/+$/, '');
    var timezone = opts.timezone || 'Asia/Kolkata';
    var ticketPath = opts.ticketPath || '/ticket/';
    var occurrence = opts.occurrence || null;
    var submitting = false;
    var touched = false;

    var field = function (name) { return form.querySelector('[data-gl-field="' + name + '"]'); };
    var els = {
      name: field('name'),
      email: field('email'),
      phone: field('phone'),
      qty: field('qty'),
      unitPrice: form.querySelector('[data-gl-unit-price]'),
      seats: form.querySelector('[data-gl-seats]'),
      total: form.querySelector('[data-gl-total]'),
      pay: form.querySelector('[data-gl-pay]'),
      payLabel: form.querySelector('[data-gl-pay-label]'),
      formError: form.querySelector('[data-gl-form-error]'),
      cancel: form.querySelector('[data-gl-cancel]')
    };

    function announceResize() {
      if (typeof opts.onResize === 'function') opts.onResize();
    }

    function clearErrors() {
      var nodes = form.querySelectorAll('[data-gl-error]');
      for (var i = 0; i < nodes.length; i += 1) {
        nodes[i].textContent = '';
        nodes[i].hidden = true;
      }
      var inputs = form.querySelectorAll('[data-gl-field]');
      for (var j = 0; j < inputs.length; j += 1) inputs[j].removeAttribute('aria-invalid');
      if (els.formError) { els.formError.textContent = ''; els.formError.hidden = true; }
      announceResize();
    }

    function setFieldError(name, message) {
      var node = form.querySelector('[data-gl-error="' + name + '"]');
      if (node) { node.textContent = message; node.hidden = false; }
      var input = field(name);
      if (input) input.setAttribute('aria-invalid', 'true');
      announceResize();
    }

    function setFormError(message) {
      if (!els.formError) return;
      els.formError.textContent = message;
      els.formError.hidden = !message;
      announceResize();
    }

    function setBusy(busy, label) {
      submitting = busy;
      if (els.pay) els.pay.disabled = busy;
      if (els.payLabel) els.payLabel.textContent = label || defaultPayLabel();
    }

    function maxSelectable() {
      if (!occurrence) return 1;
      return Math.max(1, Math.min(Number(occurrence.available) || 1, MAX_QTY));
    }

    function currentQty() {
      var raw = parseInt(els.qty && els.qty.value, 10);
      if (!isFinite(raw) || raw < 1) raw = 1;
      return Math.min(raw, maxSelectable());
    }

    function defaultPayLabel() {
      return 'Proceed to payment';
    }

    function renderSeats() {
      if (!els.seats) return;
      var left = occurrence ? Math.max(0, Number(occurrence.available) || 0) : 0;
      if (!occurrence || left <= 0) {
        els.seats.textContent = '';
        els.seats.hidden = true;
        return;
      }
      var capacity = Number(occurrence.capacity) || 0;
      els.seats.textContent = left === 1
        ? 'Only 1 ticket left'
        : left + (capacity ? ' of ' + capacity : '') + ' tickets left';
      els.seats.hidden = false;
      els.seats.classList.toggle('book-seats--low', left <= 6);
    }

    function renderTotal() {
      if (!occurrence) return;
      var qty = currentQty();
      if (els.qty) {
        els.qty.value = String(qty);
        els.qty.max = String(maxSelectable());
      }
      if (els.total) els.total.textContent = rupees(occurrence.price_paise * qty);
      if (els.unitPrice) {
        els.unitPrice.textContent = rupees(occurrence.price_paise) + ' per person';
        els.unitPrice.hidden = occurrence.price_paise <= 0;
      }
      if (els.payLabel && !submitting) els.payLabel.textContent = defaultPayLabel();
      renderSeats();
    }

    /**
     * Start every booking from a blank slate. Bookings are frequently made for
     * someone else, so a remembered name/email/phone is a liability. The
     * deferred pass catches Chrome, which autofills after first paint.
     */
    function blankIdentityFields() {
      if (touched) return;
      ['name', 'email', 'phone'].forEach(function (key) {
        if (els[key]) els[key].value = '';
      });
      if (els.qty) els.qty.value = '1';
    }

    function scheduleBlank() {
      blankIdentityFields();
      setTimeout(function () { blankIdentityFields(); renderTotal(); }, 0);
      setTimeout(blankIdentityFields, 300);
    }

    function values() {
      return {
        occurrence_id: occurrence ? occurrence.id : '',
        name: ((els.name && els.name.value) || '').trim().replace(/\s+/g, ' '),
        email: ((els.email && els.email.value) || '').trim(),
        phone: ((els.phone && els.phone.value) || '').trim(),
        qty: currentQty()
      };
    }

    function validateLocal(v) {
      var count = 0;
      if (v.name.length < 2) { setFieldError('name', 'Enter your full name.'); count += 1; }
      if (!EMAIL_RE.test(v.email)) { setFieldError('email', 'Enter a valid email address.'); count += 1; }
      if (!PHONE_RE.test(v.phone.replace(/[\s()-]/g, ''))) {
        setFieldError('phone', 'Enter a valid 10-digit mobile number.'); count += 1;
      }
      return count === 0;
    }

    function goToTicket(session) {
      try {
        sessionStorage.setItem('gl_booking', JSON.stringify({
          id: session.booking_id, token: session.access_token
        }));
      } catch (err) { /* private mode — the URL still carries it */ }

      window.location.href = ticketPath
        + '?b=' + encodeURIComponent(session.booking_id)
        + '&t=' + encodeURIComponent(session.access_token);
    }

    function openCheckout(session) {
      if (!window.Razorpay) {
        setBusy(false);
        setFormError('The payment library could not load. Disable any ad blocker for this page and retry.');
        return;
      }

      var checkout = {
        key: session.key_id,
        order_id: session.order_id,
        amount: session.amount_paise,
        currency: session.currency || 'INR',
        name: 'Games Lab',
        description: (session.event && session.event.title) || 'Event ticket',
        image: 'https://ik.imagekit.io/gameslab/Games_Lab_Logo.png',
        prefill: session.prefill || {},
        // We already collected and validated these, so show them filled in and
        // locked. This is also what puts the customer's name on the Razorpay
        // payment record instead of leaving it blank.
        readonly: { name: true, email: true, contact: true },
        notes: {
          booking_id: session.booking_id,
          name: (session.prefill && session.prefill.name) || '',
          tickets: String((session.event && session.event.qty) || '')
        },
        theme: { color: '#0b6ea8' },

        handler: function (response) {
          if (api) {
            fetch(api + '/api/confirm-hint', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              })
            }).catch(function () { /* advisory only */ });
          }
          goToTicket(session);
        },

        modal: {
          ondismiss: function () {
            setBusy(false);
            setFormError('Payment was cancelled. Your seats are held for a few more minutes — you can try again.');
          }
        }
      };

      try {
        var rzp = new window.Razorpay(checkout);
        rzp.on('payment.failed', function (response) {
          var reason = (response && response.error && response.error.description) || 'Payment failed.';
          setBusy(false, 'Retry payment');
          setFormError(reason + ' You have not been charged — try another method.');
        });
        rzp.open();
      } catch (err) {
        setBusy(false);
        setFormError('Could not open the payment window. Please refresh and try again.');
      }
    }

    function handleConflict(body) {
      if (body.occurrence) occurrence = body.occurrence;
      var left = Number(body.available) || 0;
      setBusy(false);

      if (left <= 0) {
        setFormError('The last seats went while you were filling this in. Sorry!');
        if (typeof opts.onSoldOut === 'function') opts.onSoldOut(occurrence);
        return;
      }
      renderTotal();
      setFormError('Only ' + left + ' seat' + (left === 1 ? '' : 's') + ' left — adjust the quantity and try again.');
    }

    function submit(event) {
      if (event) event.preventDefault();
      if (submitting || !occurrence) return;

      clearErrors();
      var v = values();
      if (!validateLocal(v)) return;

      setBusy(true, 'Starting payment…');

      fetch(api + '/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v)
      })
        .then(function (res) {
          return res.json()
            .catch(function () { return {}; })
            .then(function (body) { return { status: res.status, body: body }; });
        })
        .then(function (result) {
          var body = result.body || {};

          if (result.status === 422 && body.fields) {
            Object.keys(body.fields).forEach(function (name) {
              setFieldError(name, body.fields[name]);
            });
            setBusy(false);
            return;
          }
          if (result.status === 409) { handleConflict(body); return; }
          if (result.status === 429) {
            setBusy(false);
            setFormError('You already have seats held for this event. Finish or cancel that payment first.');
            return;
          }
          if (result.status !== 200 || !body.order_id) {
            setBusy(false);
            setFormError('We could not start the payment just now. Please try again in a moment.');
            return;
          }

          setBusy(true, 'Opening payment…');
          openCheckout(body);
        })
        .catch(function () {
          setBusy(false);
          setFormError('Network problem — check your connection and try again.');
        });
    }

    function onStepClick(event) {
      var delta = parseInt(event.currentTarget.getAttribute('data-gl-step'), 10) || 0;
      var next = currentQty() + delta;
      if (next < 1) next = 1;
      if (next > maxSelectable()) next = maxSelectable();
      if (els.qty) els.qty.value = String(next);
      renderTotal();
    }

    var steppers = form.querySelectorAll('[data-gl-step]');
    for (var s = 0; s < steppers.length; s += 1) {
      steppers[s].addEventListener('click', onStepClick);
    }
    if (els.qty) {
      els.qty.addEventListener('input', renderTotal);
      els.qty.addEventListener('change', renderTotal);
    }
    ['name', 'email', 'phone'].forEach(function (key) {
      if (!els[key]) return;
      els[key].addEventListener('input', function () { touched = true; });
      els[key].addEventListener('focus', function () { touched = true; });
    });
    form.addEventListener('submit', submit);

    scheduleBlank();
    window.addEventListener('pageshow', function (event) {
      // A bfcache restore (browser Back) hands the form back with its old
      // values; treat that as a fresh booking too.
      if (!event.persisted || submitting) return;
      touched = false;
      scheduleBlank();
      renderTotal();
    });

    if (els.cancel) {
      if (typeof opts.onCancel === 'function') {
        els.cancel.hidden = false;
        els.cancel.addEventListener('click', function () { opts.onCancel(); });
      } else {
        els.cancel.hidden = true;
      }
    }

    renderTotal();

    return {
      focus: function () { if (els.name) els.name.focus(); },
      setOccurrence: function (occ) { occurrence = occ; renderTotal(); }
    };
  }

  window.GLBooking = {
    mount: mount,
    rupees: rupees,
    formatWhen: formatWhen,
    fetchOccurrence: fetchOccurrence
  };
})();
