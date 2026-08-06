import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';

@Component({
  selector: 'app-auth-callback',
  imports: [],
  templateUrl: './auth-callback.html',
  styleUrl: './auth-callback.css',
})
export class AuthCallback implements OnInit {
  constructor(private route: ActivatedRoute, private router: Router, private toastr: ToastrService) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      const uid = params['uid'];
      const name = params['name'];
      const roleId = params['role_id'];
      const roleName = params['roleName'];

      // Example: backend sends comma-separated role IDs and names
      const roleIds = params['role_ids']?.split(',') ?? [];
      const roleNames = params['role_names']?.split(',') ?? [];

      if (token) {
        sessionStorage.setItem('authToken', token);
        sessionStorage.setItem('userId', uid || '');
        sessionStorage.setItem('userName', name || '');

        if (roleIds.length > 1) {
          // Store roles for the selection page
          sessionStorage.setItem('roles', JSON.stringify(
            roleIds.map((id: string, index: number) => ({
              roleId: id,
              roleName: roleNames[index]
            }))
          ));

          this.router.navigate(['/auth/select-role'], {
            replaceUrl: true
          });
        } else {
          sessionStorage.setItem('roleId', roleId || '');
          sessionStorage.setItem('roleName', roleName || '');

          // Single-role login: route admins straight to the admin page,
          // everyone else to the regular dashboard.
          const isAdmin = (roleName || '').toLowerCase() === 'admin';

          this.router.navigate([isAdmin ? '/admin' : '/dashboard'], {
            replaceUrl: true
          });
        }
      } else {
        this.toastr.error('Login Failed !!', 'Error');
        this.router.navigate(['/unauthorized'], {
          replaceUrl: true
        });
      }
    });
  }
}