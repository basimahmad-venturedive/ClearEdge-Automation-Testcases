/**
 * Schema validator for login API responses.
 */
export const loginSuccessSchema = {
  required: ['accessToken'],
  optional: ['refreshToken', 'expiresIn', 'tokenType', 'user'],
};

export const loginErrorSchema = {
  required: ['message'],
  optional: ['code', 'statusCode', 'errors'],
};

export const validateSchema = (body, schema) => {
  const missing = schema.required.filter((field) => body[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`Schema validation failed. Missing required fields: ${missing.join(', ')}`);
  }
  return true;
};

export const validateLoginSuccess = (body) => validateSchema(body, loginSuccessSchema);
export const validateLoginError = (body) => validateSchema(body, loginErrorSchema);
