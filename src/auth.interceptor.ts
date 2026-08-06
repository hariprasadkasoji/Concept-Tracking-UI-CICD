import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
let isAuthErrorHandled = false
export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<any>, next: HttpHandlerFn) => {
  const router = inject(Router);
  const toastr = inject(ToastrService);
  const token = sessionStorage.getItem('authToken');

  // /api/clients: pre-existing exemption.
  // /select-role: called BEFORE any real session token exists - the user
  // is mid-login, proven only by the short-lived pending_token sent in
  // the request body, not as a Bearer header. Without this exemption the
  // "no token -> session expired" branch below fires on every multi-role
  // login and blocks it before it reaches the backend.
  const isAuthRequest = req.url.includes('/api/clients') || req.url.includes('/select-role');
  if (isAuthRequest) {
    return next(req);
  }
 if (!token) {
    if (!isAuthErrorHandled) {
      isAuthErrorHandled = true;
      toastr.warning('Your session has expired. Please log in again.');
       router.navigate(['/Login']); 
    }
    return throwError(() => new Error('No auth token found'));
  }

  const cloned = req.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`
    }
  });

  return next(cloned).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !isAuthErrorHandled) {
          isAuthErrorHandled = true;
         toastr.error('Session expired or unauthorized access.', 'Authentication Error');
        router.navigate(['/Login']);
      }
      return throwError(() => error);
    })
  );
};