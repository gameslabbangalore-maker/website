(function () {
  'use strict';

  const BUTTON_ID = 'zf_button_316948';
  const MAIN_ID = 'formsLightBox_316948';
  const WRAPPER_CLASS = 'zf_lB_Wrapper_316948';
  const DIMMER_CLASS = 'zf_lB_Dimmer_316948';
  const CONTAINER_ID = 'containerDiv_316948';
  const IFRAME_WRAPPER_ID = 'U6qIOzComB_KEFFu44Sy3mp57NtCr0-1qvUt-kVjCrI_316948';
  const CLOSE_ID = 'deleteform_316948';
  const FORM_URL = 'https://forms.zohopublic.in/infogame1/form/CorporateEventEnquiry/formperma/U6qIOzComB_KEFFu44Sy3mp57NtCr0-1qvUt-kVjCrI?zf_rszfm=1';
  const FORM_PERMA = 'U6qIOzComB_KEFFu44Sy3mp57NtCr0-1qvUt-kVjCrI';

  let resizeListenerAttached = false;

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function ensureLightbox() {
    if (document.getElementById(MAIN_ID)) {
      return;
    }

    const iframeDiv = document.createElement('div');
    iframeDiv.id = IFRAME_WRAPPER_ID;
    iframeDiv.className = 'zf_main_id_316948';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.id = CLOSE_ID;
    closeButton.className = 'zf_lb_closeform_316948';
    closeButton.setAttribute('aria-label', 'Close enquiry form');

    const containerDiv = document.createElement('div');
    containerDiv.id = CONTAINER_ID;
    containerDiv.className = 'zf_lB_Container_316948';
    containerDiv.tabIndex = -1;
    containerDiv.appendChild(iframeDiv);
    containerDiv.appendChild(closeButton);

    const wrapperDiv = document.createElement('div');
    wrapperDiv.className = WRAPPER_CLASS;
    wrapperDiv.appendChild(containerDiv);

    const dimmerDiv = document.createElement('div');
    dimmerDiv.className = DIMMER_CLASS;
    dimmerDiv.setAttribute('role', 'presentation');

    const mainDiv = document.createElement('div');
    mainDiv.id = MAIN_ID;
    mainDiv.style.display = 'none';
    mainDiv.appendChild(wrapperDiv);
    mainDiv.appendChild(dimmerDiv);

    document.body.appendChild(mainDiv);

    closeButton.addEventListener('click', hideForm);
    closeButton.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        hideForm();
      }
    });

    dimmerDiv.addEventListener('click', hideForm);
  }

  function loadForm() {
    const wrapper = document.getElementById(IFRAME_WRAPPER_ID);
    if (!wrapper) {
      return;
    }

    if (wrapper.querySelector('iframe')) {
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.src = buildFormUrl(FORM_URL);
    iframe.title = 'Corporate Event Enquiry Form';
    iframe.loading = 'eager';
    iframe.setAttribute('aria-label', 'Corporate Event Enquiry Form');
    wrapper.appendChild(iframe);

    if (!resizeListenerAttached) {
      window.addEventListener('message', onFormResize, false);
      resizeListenerAttached = true;
    }
  }

  function showForm() {
    ensureLightbox();
    loadForm();

    const lightbox = document.getElementById(MAIN_ID);
    if (!lightbox) {
      return;
    }

    lightbox.style.display = 'block';
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      const container = document.getElementById(CONTAINER_ID);
      if (container) {
        container.focus();
      }
    });
  }

  function hideForm() {
    const lightbox = document.getElementById(MAIN_ID);
    if (!lightbox) {
      return;
    }

    lightbox.style.display = 'none';
    document.body.style.overflow = '';

    const wrapper = document.getElementById(IFRAME_WRAPPER_ID);
    if (!wrapper) {
      return;
    }

    const iframe = wrapper.querySelector('iframe');
    if (iframe) {
      iframe.remove();
    }
  }

  function onFormResize(event) {
    if (!event || typeof event.data !== 'string') {
      return;
    }

    const parts = event.data.split('|');
    if (parts.length < 2) {
      return;
    }

    const [perma, rawHeight, shouldScroll] = parts;
    if (!perma || perma.indexOf(FORM_PERMA) === -1) {
      return;
    }

    const iframe = document.querySelector(`#${IFRAME_WRAPPER_ID} iframe`);
    if (!iframe) {
      return;
    }

    const parsedHeight = parseInt(rawHeight, 10);
    if (Number.isNaN(parsedHeight)) {
      return;
    }

    const newHeight = `${parsedHeight + 15}px`;
    if (iframe.style.minHeight === newHeight) {
      return;
    }

    iframe.style.minHeight = newHeight;

    const container = document.getElementById(CONTAINER_ID);
    if (container) {
      container.style.height = newHeight;
    }

    if (shouldScroll === 'true') {
      setTimeout(() => {
        iframe.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 500);
    }
  }

  function buildFormUrl(baseUrl) {
    let src = baseUrl;
    try {
      if (typeof window.ZFAdvLead !== 'undefined' && typeof window.zfutm_zfAdvLead !== 'undefined') {
        for (let index = 0; index < window.ZFAdvLead.utmPNameArr.length; index += 1) {
          const param = window.ZFAdvLead.utmPNameArr[index];
          const value = window.zfutm_zfAdvLead.zfautm_gC_enc(window.ZFAdvLead.utmPNameArr[index]);
          if (typeof value !== 'undefined' && value !== '') {
            src += (src.includes('?') ? '&' : '?') + `${param}=${value}`;
          }
        }
      }

      if (typeof window.ZFLead !== 'undefined' && typeof window.zfutm_zfLead !== 'undefined') {
        for (let index = 0; index < window.ZFLead.utmPNameArr.length; index += 1) {
          const param = window.ZFLead.utmPNameArr[index];
          const value = window.zfutm_zfLead.zfutm_gC_enc(window.ZFLead.utmPNameArr[index]);
          if (typeof value !== 'undefined' && value !== '') {
            src += (src.includes('?') ? '&' : '?') + `${param}=${value}`;
          }
        }
      }
    } catch (error) {
      console.error('Error appending Zoho tracking parameters', error);
    }

    return src;
  }

  function handleEscape(event) {
    if (event.key === 'Escape') {
      const lightbox = document.getElementById(MAIN_ID);
      if (lightbox && lightbox.style.display === 'block') {
        hideForm();
      }
    }
  }

  onReady(() => {
    const button = document.getElementById(BUTTON_ID);
    if (!button) {
      return;
    }

    button.addEventListener('click', showForm);
    document.addEventListener('keydown', handleEscape);
  });
})();
