import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule
  ],
  templateUrl: './layout.html',
  styleUrls: ['./layout.css']
})
export class LayoutComponent implements OnInit {

  private router = inject(Router);

  searchQuery: string = '';
  userInitials: string = '';

  // Left-panel collapse toggle — hidden by default, opted into by whichever
  // page (e.g. Concept Create) actually renders a collapsible left panel.
  @Input() showPanelToggle: boolean = false;
  @Input() panelCollapsed: boolean = false;
  @Output() panelCollapsedChange = new EventEmitter<boolean>();

  togglePanel(): void {
    this.panelCollapsed = !this.panelCollapsed;
    this.panelCollapsedChange.emit(this.panelCollapsed);
  }

  ngOnInit(): void {
    const username = sessionStorage.getItem('userName') || '';
    this.userInitials = this.getInitials(username);
  }

  getInitials(name: string): string {
    return name
      .trim()
      .split(' ')
      .filter(word => word.length > 0)
      .map(word => word[0].toUpperCase())
      .slice(0, 2)
      .join('');
  }

  onSearch(): void {
    console.log('Search:', this.searchQuery);
  }

  onNotificationClick(): void {
    console.log('Notifications clicked');
  }

  onLogout(): void {
    sessionStorage.clear();
    console.log('Logout clicked');
    this.router.navigate(['/logout']);
  }
}