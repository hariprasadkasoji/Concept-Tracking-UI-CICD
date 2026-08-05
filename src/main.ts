import 'zone.js'; // Included with Angular CLI.
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig, AppConfig } from './app/app.config';

(async () => {
  await AppConfig.loadConfig(); // ✅ load config first
  bootstrapApplication(App, appConfig);
})();
