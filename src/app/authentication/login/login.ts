import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ToastrService } from 'ngx-toastr';
import { Authservice } from '../authservice';
import { Service } from '../../dashboard/service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  loading = false;
  loginForm!: FormGroup;
  submitted: boolean = false;
  isLogin: boolean = false;
  loginErrorMessage: any;
  clients: any;

  constructor(
    private service: Service,
    private fb: FormBuilder,
    private auth_service: Authservice,
    private toastr: ToastrService
  ) {}

  ngOnInit() {
    this.loginForm = this.fb.group({
       client: ['', Validators.required]
    });
    
    this.loginForm = this.fb.group({
      client: ['']
    });
  }


  login() {
  this.submitted = true;
  if (this.loginForm.invalid || this.isLogin) {
    return;
  }
  this.isLogin = true;
  const loginUrl = this.auth_service.getLoginUrl();
  console.log('Redirecting to:', loginUrl);
  window.location.href = loginUrl;
}
}