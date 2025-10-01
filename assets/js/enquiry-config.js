(function () {
  if (typeof window === 'undefined') {
    return;
  }

  window.dateAndMonthRegexFormateArray = zf_SetDateAndMonthRegexBasedOnDateFormate('dd-MM-yyyy');
  window.zf_DateRegex = new RegExp(window.dateAndMonthRegexFormateArray[0]);
  window.zf_MonthYearRegex = new RegExp(window.dateAndMonthRegexFormateArray[1]);
  window.zf_MandArray = ['Name_First', 'Name_Last', 'Dropdown', 'PhoneNumber_countrycode', 'Email'];
  window.zf_FieldArray = [
    'Name_First',
    'Name_Last',
    'SingleLine',
    'Dropdown',
    'PhoneNumber_countrycode',
    'Email',
    'Number',
    'SingleLine3',
    'SingleLine1',
    'MultiLine',
    'SingleLine2'
  ];
  window.isSalesIQIntegrationEnabled = false;
  window.salesIQFieldsArray = [];
})();
