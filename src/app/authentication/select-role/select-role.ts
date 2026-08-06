import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Service } from '../../dashboard/service';
import { LayoutComponent, RoleOption } from '../../layout/layout/layout'; // adjust path to match actual location

@Component({
  selector: 'app-select-role',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './select-role.html',
  styleUrls: ['./select-role.css'],
})
export class SelectRole implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(Service);
  private toastr = inject(ToastrService);

  pendingToken = '';
  username = '';
  name = '';
  roles: RoleOption[] = [];
  submitting = false;
  loadError = false;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;

    this.pendingToken = params.get('pending_token') || '';
    this.username = params.get('username') || '';
    this.name = params.get('name') || '';

    const rawRoles = params.get('roles');
    try {
      this.roles = rawRoles ? JSON.parse(rawRoles) : [];
    } catch {
      this.roles = [];
    }

    if (!this.pendingToken || this.roles.length === 0) {
      this.loadError = true;
      this.toastr.error('Role selection session is invalid. Please log in again.');
    }
  }

  chooseRole(role: RoleOption): void {
    if (this.submitting) return;
    this.submitting = true;

    this.service.selectRole(this.pendingToken, role.role_id).subscribe({
      next: (res) => {
        // Same sessionStorage keys used across the app (layout.ts,
        // concept-create.ts) - authToken matches what auth.interceptor
        // reads, the rest match what the existing single-role callback
        // flow already stores.
        sessionStorage.setItem('authToken', res.access_token);
        sessionStorage.setItem('userId', String(res.id));
        sessionStorage.setItem('userName', this.name || this.username);
        sessionStorage.setItem('roleId', String(role.role_id));
        sessionStorage.setItem('roleName', role.role_name);
        // Full role list, cached so the "Switch Role" dropdown in the
        // app shell (layout.ts) has something to offer immediately -
        // layout.ts's loadRoles() will still refresh this from
        // /my-roles (scoped to this same userId) the next time the
        // dropdown is opened, in case it's changed since login.
        sessionStorage.setItem('availableRoles', JSON.stringify(this.roles));

        // Same admin routing rule as the single-role path in
        // AuthCallback — keep these two in sync if the rule changes.
        const isAdmin = (role.role_name || '').toLowerCase() === 'admin';
        this.router.navigate([isAdmin ? '/admin' : '/dashboard']);
      },
      error: (err) => {
        this.submitting = false;
        this.toastr.error(
          err?.error?.detail || 'Could not select that role. Please try again.'
        );
      },
    });
  }
}