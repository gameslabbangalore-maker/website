(function () {
  const doc = document;
  const modal = doc.getElementById('corporate-enquiry-modal');
  if (!modal) {
    return;
  }

  const trigger = doc.getElementById('corporate-enquiry-trigger');
  const form = doc.getElementById('corporate-enquiry-form');
  const formContainer = modal.querySelector('[data-form-container]');
  const successPanel = doc.getElementById('corporate-form-success');
  const iframeTarget = doc.getElementById('corporate-form-target');
  const dialog = modal.querySelector('.corporate-form-dialog');
  const closeControls = modal.querySelectorAll('[data-corporate-form-close]');
  const overlay = modal.querySelector('.corporate-form-overlay');

  let lastFocusedElement = null;
  let isOpen = false;
  let submissionInFlight = false;
  let initialIframeLoad = true;

  if (dialog && !dialog.hasAttribute('tabindex')) {
    dialog.setAttribute('tabindex', '-1');
  }

  const getFocusable = () => {
    if (!dialog) {
      return [];
    }
    return Array.from(
      dialog.querySelectorAll(
        'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  };

  const openModal = () => {
    if (isOpen) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('corporate-form-lock');
    modal.classList.add('is-open');
    isOpen = true;
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (formContainer) {
      formContainer.hidden = false;
    }
    if (successPanel) {
      successPanel.hidden = true;
    }

    requestAnimationFrame(() => {
      if (dialog) {
        dialog.focus({ preventScroll: true });
      }
    });
  };

  const closeModal = () => {
    if (!isOpen) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('is-open');
    document.body.classList.remove('corporate-form-lock');
    isOpen = false;
    submissionInFlight = false;

    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus({ preventScroll: true });
    }
  };

  const handleKeydown = (event) => {
    if (!isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = getFocusable();
    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleOverlayClick = (event) => {
    if (overlay && event.target === overlay) {
      closeModal();
    }
  };

  if (trigger) {
    trigger.addEventListener('click', openModal);
  }

  closeControls.forEach((button) => {
    button.addEventListener('click', closeModal);
  });

  modal.addEventListener('click', handleOverlayClick);
  document.addEventListener('keydown', handleKeydown);

  if (form) {
    form.addEventListener('submit', () => {
      submissionInFlight = true;
    });
  }

  if (iframeTarget) {
    iframeTarget.addEventListener('load', () => {
      if (initialIframeLoad) {
        initialIframeLoad = false;
        return;
      }
      if (!submissionInFlight) {
        return;
      }
      submissionInFlight = false;
      if (formContainer) {
        formContainer.hidden = true;
      }
      if (successPanel) {
        successPanel.hidden = false;
      }
      const successClose = successPanel?.querySelector('[data-corporate-form-close]');
      successClose?.focus();
    });
  }
})();

// Zoho validation helpers
window.zf_ValidateAndSubmit = function () {
  if (window.zf_CheckMandatory()) {
    if (window.zf_ValidCheck()) {
      if (window.isSalesIQIntegrationEnabled && typeof window.zf_addDataToSalesIQ === 'function') {
        window.zf_addDataToSalesIQ();
      }
      return true;
    }
    return false;
  }
  return false;
};

window.zf_CheckMandatory = function () {
  for (var i = 0; i < window.zf_MandArray.length; i++) {
    var fieldObj = document.forms.form[window.zf_MandArray[i]];
    if (fieldObj) {
      if (fieldObj.nodeName != null) {
        if (fieldObj.nodeName === 'OBJECT') {
          if (!window.zf_MandatoryCheckSignature(fieldObj)) {
            window.zf_ShowErrorMsg(window.zf_MandArray[i]);
            return false;
          }
        } else if (fieldObj.type === 'file') {
          if (((fieldObj.value).replace(/^\s+|\s+$/g, '')).length === 0) {
            fieldObj.focus();
            window.zf_ShowErrorMsg(window.zf_MandArray[i]);
            return false;
          }
        } else if (((fieldObj.value).replace(/^\s+|\s+$/g, '')).length === 0) {
          fieldObj.focus();
          window.zf_ShowErrorMsg(window.zf_MandArray[i]);
          return false;
        } else if (fieldObj.nodeName === 'SELECT') {
          if (fieldObj.options[fieldObj.selectedIndex].value === '-Select-') {
            fieldObj.focus();
            window.zf_ShowErrorMsg(window.zf_MandArray[i]);
            return false;
          }
        } else if (fieldObj.type === 'checkbox' || fieldObj.type === 'radio') {
          if (fieldObj.checked === false) {
            fieldObj.focus();
            window.zf_ShowErrorMsg(window.zf_MandArray[i]);
            return false;
          }
        }
      } else {
        var inpChoiceElems = fieldObj;
        var checkedValsCount = 0;
        for (var ii = 0; ii < inpChoiceElems.length; ii++) {
          if (inpChoiceElems[ii].checked === true) {
            checkedValsCount++;
          }
        }
        if (checkedValsCount === 0) {
          inpChoiceElems[0].focus();
          window.zf_ShowErrorMsg(window.zf_MandArray[i]);
          return false;
        }
      }
    }
  }
  return true;
};

window.zf_ValidCheck = function () {
  var isValid = true;
  for (var ind = 0; ind < window.zf_FieldArray.length; ind++) {
    var fieldObj = document.forms.form[window.zf_FieldArray[ind]];
    if (fieldObj) {
      if (fieldObj.nodeName != null) {
        var checkType = fieldObj.getAttribute('checktype');
        if (checkType === 'c2') {
          if (!window.zf_ValidateNumber(fieldObj)) {
            isValid = false;
            fieldObj.focus();
            window.zf_ShowErrorMsg(window.zf_FieldArray[ind]);
            return false;
          }
        } else if (checkType === 'c3') {
          if (!window.zf_ValidateCurrency(fieldObj) || !window.zf_ValidateDecimalLength(fieldObj, 10)) {
            isValid = false;
            fieldObj.focus();
            window.zf_ShowErrorMsg(window.zf_FieldArray[ind]);
            return false;
          }
        } else if (checkType === 'c4') {
          if (!window.zf_ValidateDateFormat(fieldObj)) {
            isValid = false;
            fieldObj.focus();
            window.zf_ShowErrorMsg(window.zf_FieldArray[ind]);
            return false;
          }
        } else if (checkType === 'c5') {
          if (!window.zf_ValidateEmailID(fieldObj)) {
            isValid = false;
            fieldObj.focus();
            window.zf_ShowErrorMsg(window.zf_FieldArray[ind]);
            return false;
          }
        } else if (checkType === 'c6') {
          if (!window.zf_ValidateLiveUrl(fieldObj)) {
            isValid = false;
            fieldObj.focus();
            window.zf_ShowErrorMsg(window.zf_FieldArray[ind]);
            return false;
          }
        } else if (checkType === 'c7') {
          if (!window.zf_ValidatePhone(fieldObj)) {
            isValid = false;
            fieldObj.focus();
            window.zf_ShowErrorMsg(window.zf_FieldArray[ind]);
            return false;
          }
        } else if (checkType === 'c8') {
          window.zf_ValidateSignature(fieldObj);
        } else if (checkType === 'c9') {
          if (!window.zf_ValidateMonthYearFormat(fieldObj)) {
            isValid = false;
            fieldObj.focus();
            window.zf_ShowErrorMsg(window.zf_FieldArray[ind]);
            return false;
          }
        }
      }
    }
  }
  return isValid;
};

window.zf_ShowErrorMsg = function (uniqName) {
  for (var errInd = 0; errInd < window.zf_FieldArray.length; errInd++) {
    var fldLinkName = window.zf_FieldArray[errInd].split('_')[0];
    var errorElem = document.getElementById(fldLinkName + '_error');
    if (errorElem) {
      errorElem.style.display = 'none';
    }
  }
  var linkName = uniqName.split('_')[0];
  var errElem = document.getElementById(linkName + '_error');
  if (errElem) {
    errElem.style.display = 'block';
  }
};

window.zf_ValidateNumber = function (elem) {
  var validChars = '-0123456789';
  var numValue = elem.value.replace(/^\s+|\s+$/g, '');
  if (numValue !== null && numValue !== '') {
    var result = true;
    if (numValue.charAt(0) === '-' && numValue.length === 1) {
      return false;
    }
    for (var i = 0; i < numValue.length && result === true; i++) {
      var strChar = numValue.charAt(i);
      if (strChar === '-' && i !== 0) {
        return false;
      }
      if (validChars.indexOf(strChar) === -1) {
        result = false;
      }
    }
    return result;
  }
  return true;
};

window.zf_ValidateDateFormat = function (inpElem) {
  var dateValue = inpElem.value.replace(/^\s+|\s+$/g, '');
  if (dateValue === '') {
    return true;
  }
  return window.zf_DateRegex.test(dateValue);
};

window.zf_ValidateCurrency = function (elem) {
  var validChars = '0123456789.';
  var numValue = elem.value.replace(/^\s+|\s+$/g, '');
  if (numValue.charAt(0) === '-') {
    numValue = numValue.substring(1, numValue.length);
  }
  if (numValue !== null && numValue !== '') {
    for (var i = 0; i < numValue.length; i++) {
      var strChar = numValue.charAt(i);
      if (validChars.indexOf(strChar) === -1) {
        return false;
      }
    }
    return true;
  }
  return true;
};

window.zf_ValidateDecimalLength = function (elem, decimalLen) {
  var numValue = elem.value;
  if (numValue.indexOf('.') >= 0) {
    var decimalLength = numValue.substring(numValue.indexOf('.') + 1).length;
    if (decimalLength > decimalLen) {
      return false;
    }
  }
  return true;
};

window.zf_ValidateEmailID = function (elem) {
  var emailValue = elem.value;
  if (emailValue !== null && emailValue !== '') {
    var emailArray = emailValue.split(',');
    for (var i = 0; i < emailArray.length; i++) {
      var emailExp = /^[\w]([\w\-.+&'\/]*)@([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,22}$/;
      if (!emailExp.test(emailArray[i].replace(/^\s+|\s+$/g, ''))) {
        return false;
      }
    }
    return true;
  }
  return true;
};

window.zf_ValidateLiveUrl = function (elem) {
  var urlValue = elem.value;
  if (urlValue !== null && typeof urlValue !== 'undefined') {
    urlValue = urlValue.replace(/^\s+|\s+$/g, '');
    if (urlValue !== '') {
      var urlregex = new RegExp(
        '^(((https|http|ftps|ftp)://[a-zA-Z\\d]+((_|-|@)[a-zA-Z\\d]+)*(\\.[a-zA-Z\\d]+((_|-|@)[a-zA-Z\\d]+)*)+(?::\\d{1,5})?)|((w|W){3}(\\.[a-zA-Z\\d]+((_|-|@)[a-zA-Z\\d]+)*){2,}(?::\\d{1,5})?)|([a-zA-Z\\d]+((_|-)[a-zA-Z\\d]+)*(\\.[a-zA-Z\\d]+((_|-)[a-zA-Z\\d]+)*)+(?::\\d{1,5})?))(/[-\\w.?,:'/\\\\+=&;%$#@()!~]*)?$',
        'i'
      );
      return urlregex.test(urlValue);
    }
  }
  return true;
};

window.zf_ValidatePhone = function (inpElem) {
  var ZFPhoneRegex = {
    PHONE_INTE_ALL_REG: /^[+]{0,1}[()0-9-. ]+$/,
    PHONE_INTE_NUMERIC_REG: /^[0-9]+$/,
    PHONE_INTE_CONT_CODE_ENABLED_REG: /^[(0-9-.][()0-9-. ]*$/,
    PHONE_USA_REG: /^[0-9]+$/,
    PHONE_CONT_CODE_REG: /^[+][0-9]{1,4}$/,
  };
  var phoneFormat = parseInt(inpElem.getAttribute('phoneFormat'), 10);
  var fieldInpVal = inpElem.value.replace(/^\s+|\s+$/g, '');
  var toReturn = true;
  if (phoneFormat === 1) {
    if (inpElem.getAttribute('valType') === 'code') {
      var codeRexp = ZFPhoneRegex.PHONE_CONT_CODE_REG;
      if (fieldInpVal !== '' && !codeRexp.test(fieldInpVal)) {
        return false;
      }
    } else {
      var IRexp = ZFPhoneRegex.PHONE_INTE_ALL_REG;
      if (inpElem.getAttribute('phoneFormatType') === '2') {
        IRexp = ZFPhoneRegex.PHONE_INTE_NUMERIC_REG;
      }
      if (fieldInpVal !== '' && !IRexp.test(fieldInpVal)) {
        toReturn = false;
        return toReturn;
      }
    }
    return toReturn;
  }
  if (phoneFormat === 2) {
    var InpMaxlength = inpElem.getAttribute('maxlength');
    var USARexp = ZFPhoneRegex.PHONE_USA_REG;
    if (fieldInpVal !== '' && USARexp.test(fieldInpVal) && fieldInpVal.length == InpMaxlength) {
      toReturn = true;
    } else if (fieldInpVal === '') {
      toReturn = true;
    } else {
      toReturn = false;
    }
    return toReturn;
  }
  return true;
};

window.zf_ValidateSignature = function (objElem) {
  var linkName = objElem.getAttribute('compname');
  var canvasElem = document.getElementById('drawingCanvas-' + linkName);
  var isValidSign = window.zf_IsSignaturePresent(objElem, linkName, canvasElem);
  var hiddenSignInputElem = document.getElementById('hiddenSignInput-' + linkName);
  if (isValidSign) {
    hiddenSignInputElem.value = canvasElem.toDataURL();
  } else {
    hiddenSignInputElem.value = '';
  }
  return isValidSign;
};

window.zf_MandatoryCheckSignature = function (objElem) {
  var linkName = objElem.getAttribute('compname');
  var canvasElem = document.getElementById('drawingCanvas-' + linkName);
  return window.zf_IsSignaturePresent(objElem, linkName, canvasElem);
};

window.zf_IsSignaturePresent = function (objElem, linkName, canvasElem) {
  var context = canvasElem.getContext('2d');
  var canvasWidth = canvasElem.width;
  var canvasHeight = canvasElem.height;
  var canvasData = context.getImageData(0, 0, canvasWidth, canvasHeight);
  var signLen = canvasData.data.length;
  var flag = false;
  for (var index = 0; index < signLen; index++) {
    if (!canvasData.data[index]) {
      flag = false;
    } else if (canvasData.data[index]) {
      flag = true;
      break;
    }
  }
  return flag;
};

window.zf_FocusNext = function (elem, event) {
  if (event.keyCode === 9 || event.keyCode === 16) {
    return;
  }
  if (event.keyCode >= 37 && event.keyCode <= 40) {
    return;
  }
  var compname = elem.getAttribute('compname');
  var inpElemName = elem.getAttribute('name');
  if (inpElemName === compname + '_countrycode') {
    if (elem.value.length === 3) {
      document.getElementsByName(compname + '_first')[0].focus();
    }
  } else if (inpElemName === compname + '_first') {
    if (elem.value.length === 3) {
      document.getElementsByName(compname + '_second')[0].focus();
    }
  }
};

window.zf_ValidateMonthYearFormat = function (inpElem) {
  var monthYearValue = inpElem.value.replace(/^\s+|\s+$/g, '');
  if (monthYearValue === '') {
    return true;
  }
  return window.zf_MonthYearRegex.test(monthYearValue);
};

window.zf_SetDateAndMonthRegexBasedOnDateFormate = function (dateFormat) {
  var dateAndMonthRegexFormateArray = [];
  var dateFormatRegExp;
  var monthYearFormatRegExp;
  if (dateFormat === 'dd-MMM-yyyy') {
    dateFormatRegExp = '^(([0][1-9])|([1-2][0-9])|([3][0-1]))[-](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-](?:(?:19|20)[0-9]{2})$';
    monthYearFormatRegExp = '^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-](?:(?:19|20)[0-9]{2})$';
  } else if (dateFormat === 'dd-MMMM-yyyy') {
    dateFormatRegExp = '^(([0][1-9])|([1-2][0-9])|([3][0-1]))[-](January|February|March|April|May|June|July|August|September|October|November|December|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)[-](?:(?:19|20)[0-9]{2})$';
    monthYearFormatRegExp = '^(January|February|March|April|May|June|July|August|September|October|November|December|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)[-](?:(?:19|20)[0-9]{2})$';
  } else if (dateFormat === 'MMMM-dd-yyyy') {
    dateFormatRegExp = '^(January|February|March|April|May|June|July|August|September|October|November|December|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)[-](([0][1-9])|([1-2][0-9])|([3][0-1]))[-](?:(?:19|20)[0-9]{2})$';
    monthYearFormatRegExp = '^(January|February|March|April|May|June|July|August|September|October|November|December|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)[-](?:(?:19|20)[0-9]{2})$';
  } else if (dateFormat === 'dd/MM/yyyy') {
    dateFormatRegExp = '^(([0][1-9])|([1-2][0-9])|([3][0-1]))[\\/]([0][1-9]|1[012])[\\/](?:(?:19|20)[0-9]{2})$';
    monthYearFormatRegExp = '^([0][1-9]|1[012])[\\/](?:(?:19|20)[0-9]{2})$';
  } else if (dateFormat === 'dd-MM-yyyy') {
    dateFormatRegExp = '^(([0][1-9])|([1-2][0-9])|([3][0-1]))[-]([0][1-9]|1[012])[-](?:(?:19|20)[0-9]{2})$';
    monthYearFormatRegExp = '^([0][1-9]|1[012])[-](?:(?:19|20)[0-9]{2})$';
  } else if (dateFormat === 'MM/dd/yyyy') {
    dateFormatRegExp = '^([0][1-9]|1[012])[\\/](([0][1-9])|([1-2][0-9])|([3][0-1]))[\\/](?:(?:19|20)[0-9]{2})$';
    monthYearFormatRegExp = '^([0][1-9]|1[012])[\\/](?:(?:19|20)[0-9]{2})$';
  } else if (dateFormat === 'yyyy-MM-dd') {
    dateFormatRegExp = '^(?:(?:19|20)[0-9]{2})[-]([0][1-9]|1[012])[-](([0][1-9])|([1-2][0-9])|([3][0-1]))$';
    monthYearFormatRegExp = '^(?:(?:19|20)[0-9]{2})[-]([0][1-9]|1[012])$';
  } else if (dateFormat === 'yyyy/MM/dd') {
    dateFormatRegExp = '^(?:(?:19|20)[0-9]{2})[\\/]([0][1-9]|1[012])[\\/](([0][1-9])|([1-2][0-9])|([3][0-1]))$';
    monthYearFormatRegExp = '^(?:(?:19|20)[0-9]{2})[\\/]([0][1-9]|1[012])$';
  } else if (dateFormat === 'dd.MM.yyyy') {
    dateFormatRegExp = '^(([0][1-9])|([1-2][0-9])|([3][0-1]))[.]([0][1-9]|1[012])[.](?:(?:19|20)[0-9]{2})$';
    monthYearFormatRegExp = '^([0][1-9]|1[012])[.](?:(?:19|20)[0-9]{2})$';
  } else if (dateFormat === 'MM-dd-yyyy') {
    dateFormatRegExp = '^([0][1-9]|1[012])[-](([0][1-9])|([1-2][0-9])|([3][0-1]))[-](?:(?:19|20)[0-9]{2})$';
    monthYearFormatRegExp = '^([0][1-9]|1[012])[-](?:(?:19|20)[0-9]{2})$';
  }
  dateAndMonthRegexFormateArray.push(dateFormatRegExp);
  dateAndMonthRegexFormateArray.push(monthYearFormatRegExp);
  return dateAndMonthRegexFormateArray;
};

window.zf_MandArray = [
  'Name_First',
  'Name_Last',
  'Dropdown',
  'PhoneNumber_countrycode',
  'Email',
];
window.zf_FieldArray = [
  'Name_First',
  'Name_Last',
  'SingleLine',
  'Dropdown',
  'PhoneNumber_countrycode',
  'Email',
  'Number',
  'DateTime_date',
  'DateTime_hours',
  'DateTime_minutes',
  'DateTime_meridiem',
  'SingleLine1',
  'MultiLine',
  'SingleLine2',
];
window.isSalesIQIntegrationEnabled = false;
window.salesIQFieldsArray = [];

var dateAndMonthRegexFormateArray = window.zf_SetDateAndMonthRegexBasedOnDateFormate('dd-MMM-yyyy');
window.zf_DateRegex = new RegExp(dateAndMonthRegexFormateArray[0]);
window.zf_MonthYearRegex = new RegExp(dateAndMonthRegexFormateArray[1]);
