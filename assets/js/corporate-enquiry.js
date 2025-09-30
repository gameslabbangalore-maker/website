(function(){
  if (typeof window.zf_ValidateAndSubmit === 'function') {
    return;
  }
  window.zf_ValidateAndSubmit = function(){
    return true;
  };
})();
