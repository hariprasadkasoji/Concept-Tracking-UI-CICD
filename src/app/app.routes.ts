import { Routes } from '@angular/router';
import { authGuard } from './authentication/guards/auth-guard';

export const routes: Routes = [

  // default route -> login
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  // login route
  {
    path: 'login',
    loadComponent: () =>
      import('./authentication/login/login').then(m => m.Login)
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./authentication/auth-callback/auth-callback').then(m => m.AuthCallback)
  },
  // NEW - multi-role login handoff, no authGuard: the user isn't fully
  // authenticated yet, only holds a short-lived pending_token.
  {
    path: 'auth/select-role',
    loadComponent: () =>
      import('./authentication/select-role/select-role').then(m => m.SelectRole)
  },
  {
    path: 'unauthorized',
    loadComponent: () =>
   import('./authentication/unauthorized/unauthorized.component').then(m => m.UnauthorizedComponent)
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./administration/users/user').then(m => m.User)
  },
  {
    path: 'masterdataconfig',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./administration/masterdataconfig/masterdataconfig').then(m => m.Masterdataconfig)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard/dashboard/dashboard').then(m => m.DashboardComponent)
  },
  {
    path: 'concept-create/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./dashboard/create-concept/concept-create/concept-create').then(m => m.ConceptCreateComponent)
  },
  {
    path: 'concept-create',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/create-concept/concept-create/concept-create').then(m => m.ConceptCreateComponent)
  },

  // wildcard -> login
  { path: '**', redirectTo: 'login' },
];