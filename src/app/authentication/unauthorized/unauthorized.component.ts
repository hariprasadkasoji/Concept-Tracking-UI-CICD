import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
    selector: 'app-unauthorized',
      standalone: true,
    imports: [],
    templateUrl: './unauthorized.component.html',
    styleUrl: './unauthorized.component.css'
})
export class UnauthorizedComponent {
    private router = inject(Router);
  goHome() {
      this.router.navigate(['/Login']);
  }
}
