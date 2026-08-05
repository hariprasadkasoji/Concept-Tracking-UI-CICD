import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NgIf, NgFor } from '@angular/common'; // For *ngIf and *ngFor
import { FormsModule } from '@angular/forms'; // For [(ngModel)]

@Component({
  selector: 'app-root',
  standalone: true, // ✅ Mark component as standalone
  imports: [RouterOutlet, FormsModule,],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App {}
