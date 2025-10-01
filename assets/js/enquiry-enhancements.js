(function () {
  if (typeof window === 'undefined') {
    return;
  }

  var didSubmit = false;

  function digitsOnly(value) {
    return value.replace(/\D/g, '');
  }

  function focusElement(element) {
    if (!element || typeof element.focus !== 'function') {
      return;
    }
    try {
      element.focus({ preventScroll: true });
    } catch (err) {
      element.focus();
    }
  }

  function updateDropdownValidity(selectEl) {
    if (!selectEl) {
      return;
    }
    if (selectEl.value === '-Select-') {
      selectEl.setCustomValidity('Please choose an event type.');
    } else {
      selectEl.setCustomValidity('');
    }
  }

  function hideGroupError(group) {
    if (group.wrapper) {
      group.wrapper.classList.remove('has-error');
    }
    if (group.error) {
      group.error.textContent = '';
      group.error.style.display = 'none';
    }
    group.inputs.forEach(function (input) {
      if (input) {
        input.removeAttribute('aria-invalid');
      }
    });
  }

  function showGroupError(group) {
    var message = typeof group.getMessage === 'function' ? group.getMessage() : group.message;
    if (group.wrapper) {
      group.wrapper.classList.add('has-error');
    }
    if (group.error) {
      group.error.textContent = message || '';
      group.error.style.display = 'block';
    }
    group.inputs.forEach(function (input) {
      if (input) {
        input.setAttribute('aria-invalid', 'true');
      }
    });
  }

  function validateGroup(group, options) {
    var opts = options || {};
    if (opts.force) {
      group.dirty = true;
    }
    var isValid = group.check();
    if (group.dirty) {
      if (isValid) {
        hideGroupError(group);
      } else {
        showGroupError(group);
      }
    } else if (!group.dirty) {
      hideGroupError(group);
    }
    return isValid;
  }

  function createFieldGroups(form) {
    var groups = [];
    var firstName = form.elements['Name_First'];
    var lastName = form.elements['Name_Last'];
    var dropdown = form.elements['Dropdown'];
    var phone = form.elements['PhoneNumber_countrycode'];
    var email = form.elements['Email'];

    if (firstName) {
      firstName.required = true;
    }
    if (lastName) {
      lastName.required = true;
    }
    if (dropdown) {
      dropdown.required = true;
      updateDropdownValidity(dropdown);
    }
    if (phone) {
      phone.required = true;
      phone.setAttribute('inputmode', 'numeric');
      phone.setAttribute('pattern', '\\d{10}');
    }
    if (email) {
      email.required = true;
    }

    groups.push({
      key: 'Name',
      inputs: [firstName, lastName].filter(Boolean),
      wrapper: form.querySelector('.enquiry-field--name'),
      error: document.getElementById('Name_error'),
      message: 'Please enter your name.',
      focusTarget: firstName || lastName,
      dirty: false,
      check: function () {
        return this.inputs.every(function (input) {
          return input && input.value.trim().length > 0;
        });
      }
    });

    groups.push({
      key: 'Dropdown',
      inputs: [dropdown].filter(Boolean),
      wrapper: form.querySelector('.enquiry-field--event'),
      error: document.getElementById('Dropdown_error'),
      message: 'Please choose an event type.',
      focusTarget: dropdown,
      dirty: false,
      check: function () {
        return this.inputs.every(function (input) {
          return input && input.value !== '-Select-';
        });
      }
    });

    groups.push({
      key: 'PhoneNumber',
      inputs: [phone].filter(Boolean),
      wrapper: form.querySelector('.enquiry-field--phone'),
      error: document.getElementById('PhoneNumber_error'),
      message: 'Enter a 10-digit contact number.',
      focusTarget: phone,
      dirty: false,
      check: function () {
        return this.inputs.every(function (input) {
          return input && digitsOnly(input.value).length === 10;
        });
      }
    });

    groups.push({
      key: 'Email',
      inputs: [email].filter(Boolean),
      wrapper: form.querySelector('.enquiry-field--email'),
      error: document.getElementById('Email_error'),
      message: 'Enter a valid email address.',
      getMessage: function () {
        var input = this.inputs[0];
        if (!input) {
          return 'Enter a valid email address.';
        }
        var value = input.value.trim();
        if (!value.length) {
          return 'Please enter your email address.';
        }
        if (!input.checkValidity()) {
          return 'Enter a valid email address.';
        }
        return 'Enter a valid email address.';
      },
      focusTarget: email,
      dirty: false,
      check: function () {
        return this.inputs.every(function (input) {
          if (!input) {
            return true;
          }
          var value = input.value.trim();
          return value.length > 0 && input.checkValidity();
        });
      }
    });

    return groups;
  }

  function runZohoValidation() {
    var triggered = [];
    var focusCandidate = null;
    var originalShowError = window.zf_ShowErrorMsg;
    var originalFocus = HTMLElement.prototype.focus;

    window.zf_ShowErrorMsg = function (name) {
      triggered.push(name);
    };

    HTMLElement.prototype.focus = function () {
      if (!focusCandidate) {
        focusCandidate = this;
      }
      return originalFocus.apply(this, arguments);
    };

    if (typeof window.enquirySyncDateTimeParts === 'function') {
      window.enquirySyncDateTimeParts();
    }

    var mandatoryOk = typeof window.zf_CheckMandatory === 'function' ? window.zf_CheckMandatory() : true;
    var validOk = false;

    if (mandatoryOk) {
      validOk = typeof window.zf_ValidCheck === 'function' ? window.zf_ValidCheck() : true;
      if (validOk && window.isSalesIQIntegrationEnabled && typeof window.zf_addDataToSalesIQ === 'function') {
        window.zf_addDataToSalesIQ();
      }
    }

    window.zf_ShowErrorMsg = originalShowError;
    HTMLElement.prototype.focus = originalFocus;

    return {
      ok: mandatoryOk && validOk,
      triggered: triggered,
      focusTarget: focusCandidate
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (window.__enquiryEnhancementsBound) {
      return;
    }

    var form = document.getElementById('form');
    if (!form) {
      return;
    }

    var iframe = document.getElementById('enquiry-submit-frame');
    if (!iframe) {
      return;
    }

    window.__enquiryEnhancementsBound = true;
    didSubmit = false;

    var submitButton = form.querySelector('.zf-submitColor');
    var successUrl = form.getAttribute('data-success-url') || '/';

    var submitting = false;
    var defaultSubmitLabel = submitButton ? submitButton.textContent.trim() : '';
    var submittingLabel = 'Submitting…';

    var fieldGroups = createFieldGroups(form);
    var groupMap = {};
    fieldGroups.forEach(function (group) {
      group.inputs.forEach(function (input) {
        if (input && input.tagName === 'SELECT') {
          updateDropdownValidity(input);
        }
      });
      if (group.error) {
        group.error.textContent = '';
      }
      groupMap[group.key] = group;
    });

    if (iframe) {
      var iframeTarget = iframe.getAttribute('name') || iframe.id;
      if (iframeTarget) {
        form.setAttribute('target', iframeTarget);
      }
    }

    if (submitButton) {
      submitButton.setAttribute('aria-disabled', 'true');
    }

    function updateSubmitState() {
      var allValid = fieldGroups.every(function (group) {
        return group.check();
      });
      if (!submitButton) {
        return;
      }
      if (submitting) {
        submitButton.textContent = submittingLabel;
        submitButton.disabled = true;
        submitButton.setAttribute('aria-disabled', 'true');
        return;
      }
      if (allValid) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-disabled');
        submitButton.textContent = defaultSubmitLabel;
      } else {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-disabled', 'true');
        submitButton.textContent = defaultSubmitLabel;
      }
    }

    function finalizeSuccess() {
      didSubmit = false;
      submitting = false;
      form.reset();
      fieldGroups.forEach(function (group) {
        group.dirty = false;
        hideGroupError(group);
        if (group.key === 'Dropdown') {
          group.inputs.forEach(function (input) {
            if (input && input.tagName === 'SELECT') {
              updateDropdownValidity(input);
            }
          });
        }
      });
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-disabled', 'true');
        submitButton.textContent = defaultSubmitLabel;
      }
      updateSubmitState();
      if (successUrl) {
        window.location.href = successUrl;
      }
    }

    iframe.addEventListener('load', function () {
      if (!didSubmit) {
        return;
      }
      finalizeSuccess();
    });

    fieldGroups.forEach(function (group) {
      group.inputs.forEach(function (input) {
        if (!input) {
          return;
        }
        var listener = function () {
          group.dirty = true;
          if (group.key === 'Dropdown') {
            updateDropdownValidity(input);
          }
          if (group.key === 'PhoneNumber') {
            var digits = digitsOnly(input.value).slice(0, 10);
            input.value = digits;
          }
          validateGroup(group);
          updateSubmitState();
        };
        var blurListener = function () {
          group.dirty = true;
          validateGroup(group, { force: true });
          updateSubmitState();
        };
        if (input.tagName === 'SELECT') {
          input.addEventListener('change', listener);
        } else {
          input.addEventListener('input', listener);
        }
        input.addEventListener('blur', blurListener);
      });
    });

    updateSubmitState();

    form.addEventListener('submit', function (event) {
      var firstInvalidGroup = null;
      var shouldPrevent = false;
      var focusTarget = null;

      fieldGroups.forEach(function (group) {
        var isValid = validateGroup(group, { force: true });
        if (!isValid) {
          shouldPrevent = true;
          if (!firstInvalidGroup) {
            firstInvalidGroup = group;
          }
        }
      });

      updateSubmitState();

      if (firstInvalidGroup) {
        focusTarget = firstInvalidGroup.focusTarget || firstInvalidGroup.inputs[0];
      }

      var zohoResult = null;

      if (!shouldPrevent) {
        document.charset = 'UTF-8';
        zohoResult = runZohoValidation();

        if (!zohoResult.ok) {
          shouldPrevent = true;
          zohoResult.triggered.forEach(function (name) {
            var key = name.split('_')[0];
            var group = groupMap[key];
            if (group) {
              group.dirty = true;
              validateGroup(group, { force: true });
            }
          });
          updateSubmitState();
          if (zohoResult.focusTarget) {
            focusTarget = zohoResult.focusTarget;
          } else if (zohoResult.triggered.length) {
            var fallbackGroup = groupMap[zohoResult.triggered[0].split('_')[0]];
            var fallbackTarget = fallbackGroup ? fallbackGroup.focusTarget || fallbackGroup.inputs[0] : null;
            focusTarget = fallbackTarget;
          }
        }
      }

      if (shouldPrevent) {
        event.preventDefault();
        submitting = false;
        didSubmit = false;
        updateSubmitState();
        if (focusTarget) {
          focusElement(focusTarget);
        }
        return;
      }

      submitting = true;
      didSubmit = true;
      if (submitButton) {
        submitButton.textContent = submittingLabel;
      }
      updateSubmitState();
      showThankYou();
    });
  });
})();
