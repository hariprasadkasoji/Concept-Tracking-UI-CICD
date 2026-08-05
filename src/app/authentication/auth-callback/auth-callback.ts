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
  constructor(private route: ActivatedRoute, private router: Router,private toastr: ToastrService) {}

 ngOnInit(): void {

  this.route.queryParams.subscribe(params => {

  console.log(params, "callback params");
  const token = params['token'];
  const roleId = Number(params['role_id']);
  const clientname = params['client_name'];
  const uid = params['uid'];
  const name = params['name'];
  const roleName = params['roleName'];
  console.log(token, roleId,uid,roleName);
  if (token) {
    // Store token & info
    sessionStorage.setItem('authToken', token);
    sessionStorage.setItem('roleId', roleId.toString());
    sessionStorage.setItem('userId', uid || '');
    sessionStorage.setItem('roleName', roleName || '');

    // sessionStorage.setItem('client', clientname|| '');
    sessionStorage.setItem('userName', name || '');
    this.router.navigate(['/dashboard'], { replaceUrl: true });
  } 
  else {
    console.error('No access token found in callback URL');
     this.toastr.error('Login Failed !!','Error');
    this.router.navigate(['unauthorized'], { replaceUrl: true });
  }
  });
  }

  
}
