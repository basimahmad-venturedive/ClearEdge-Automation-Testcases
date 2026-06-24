/**
 * Date utility for test data and reporting.
 */
export const formatDate = (date = new Date(), format = 'YYYY-MM-DD') => {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  const tokens = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (match) => tokens[match]);
};

export const timestampForRun = () => formatDate(new Date(), 'YYYY-MM-DD HH:mm');

export const addDays = (days, from = new Date()) => {
  const result = new Date(from);
  result.setDate(result.getDate() + days);
  return result;
};

export const isoNow = () => new Date().toISOString();
