import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Attaches the JWT (stored at login/role-selection time) to every outgoing
 * request. Backend endpoints now resolve identity via
 * Depends(get_current_user) instead of trusting client-supplied user_id
 * fields, so requests without this header will 401.
 *
 * Register in app.config.ts:
 *   provideHttpClient(withInterceptors([authInterceptor]))
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = sessionStorage.getItem('token');

  if (!token) {
    return next(req);
  }

  const authReq = req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });

  return next(authReq);
};