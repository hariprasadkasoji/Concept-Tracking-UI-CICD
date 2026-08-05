import { Injectable } from '@angular/core';
import { AppConfig } from '../app.config';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root',
})
export class Authservice {

  private baseUrl: string = AppConfig.settings?.apiurl || '';

  constructor(private httpClient:HttpClient) { } 

  getLoginUrl(): string {
    console.log('Base URL from AppConfig:', this.baseUrl);
    // console.log("loginapi",`${this.baseUrl}api/login/`)
    return `${this.baseUrl}api/login/`;
  }

}
