/**
 * Login API payload builder.
 */
export const buildLoginPayload = (email, password) => ({
  email,
  password,
});

export const buildRefreshPayload = (refreshToken) => ({
  refreshToken,
});
