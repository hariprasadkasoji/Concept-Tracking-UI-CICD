import { CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);

  const token = sessionStorage.getItem('authToken');
  const roleId = sessionStorage.getItem('roleId');
  const uid = sessionStorage.getItem('userId');
  if (token && roleId && uid) {
    return true;
  }

  console.warn('No valid session, redirecting to login');
  router.navigate(['/login']);
  return false;
};