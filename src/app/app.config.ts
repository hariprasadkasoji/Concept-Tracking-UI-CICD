import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http'; // ✅ No interceptors
import { provideToastr } from 'ngx-toastr'; // ✅ ADD THIS
import { authInterceptor } from '../auth.interceptor';

// Standalone app configuration
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),

    // Router with hash-based URLs
    provideRouter(routes, withHashLocation()),

    // Animations
    provideAnimationsAsync(),

    // HttpClient without interceptors
    provideHttpClient(
        withInterceptors([authInterceptor]),
    ), // ✅ This allows any service to inject HttpClient
    
    // Toastr notifications
     provideToastr({
      timeOut: 3000,
      positionClass: 'toast-top-right',
      preventDuplicates: true,
      closeButton: true,
      progressBar: true
    })
  ],
};


// Global AppConfig class
export class AppConfig {
  static settings: any; // can replace 'any' with proper interface

  // Load config.json before app starts
  static async loadConfig(): Promise<void> {
    try {
      const response = await fetch('assets/config.json'); // ✅ correct path
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const config = await response.json();
      AppConfig.settings = config;
      // console.log('Config loaded:', AppConfig.settings);
    } catch (error) {
      console.error('Failed to load config.json', error);
    }
  }
}
