/**
 * JSON utility for parsing and validation helpers.
 */
export const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const stringify = (obj, pretty = false) =>
  pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);

export const getNestedValue = (obj, path) =>
  path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);

export const isValidJson = (text) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};
