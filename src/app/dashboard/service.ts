import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { AppConfig } from '../app.config';

@Injectable({
  providedIn: 'root',
})
export class Service {
  
  constructor(private http: HttpClient) {
    this.apiBaseUrl = AppConfig.settings?.apiurl || '';
  }
  
  public apiBaseUrl: string;
  
  getPdfFile(url: string): Observable<Blob> {
    const fullUrl = `${this.apiBaseUrl}${url}`;
    return this.http.post(fullUrl, {}, {
      responseType: 'blob'
    });
  }
 

  clear() {
    sessionStorage.clear();
    sessionStorage.removeItem('user_input');
    sessionStorage.removeItem('generated_sql');
  }

  // ----------------

  getdashboardConcepts(): Observable<any> {
    const url = `${this.apiBaseUrl}api/dashboard-concepts`;
    return this.http.get<any>(url);
  }

  getmasterdata(): Observable<any> {
    const url= `${this.apiBaseUrl}api/master-data`
    return this.http.get<any>(url);
  }

  /** Returns the statuses the CURRENT user's role is allowed to move a
   *  concept to, given its current status. Backed by the same
   *  status_permissions.py matrix the create-concept endpoint enforces —
   *  this is what the dropdown should be filtered against, not the raw
   *  developmentStatusOptions list from master-data. */
  getAllowedStatuses(userId: number, currentStatus: string): Observable<any> {
    const params = new HttpParams()
      .set('user_id', userId)
      .set('current_status', currentStatus || 'New');
    const url = `${this.apiBaseUrl}api/allowed-statuses`;
    return this.http.get<any>(url, { params });
  }

  createconcept(formData: FormData): Observable<any> {
    const url= `${this.apiBaseUrl}api/create-concept`
    return this.http.post<any>(url,formData);
  }

  // submitclientApproval(data: any): Observable<any> {
  //   return this.http.post(`${this.apiBaseUrl}api/submit_client_approval`, data);
  // }
  submitclientApproval(data: any, conceptId: string): Observable<any> {
  const url = `${this.apiBaseUrl}api/submit_client_approval/?${conceptId}`;
  return this.http.post<any>(url, data);
}

  submitsupportingdocuments(formData: FormData): Observable<any> {
    const url = `${this.apiBaseUrl}api/upload_supporting_docs`;
    return this.http.post<any>(url,formData);
  }

  /** Fetch a concept by ID */
  getConcept(conceptId: string): Observable<any> {
    const url = `${this.apiBaseUrl}api/concepts/${conceptId}`;
    return this.http.get<any>(url);
  }

  getLatestUpdates(): Observable<any> {
    return this.http.get<any>(`${this.apiBaseUrl}api/latest-updates`);
  }

  getConceptsByUserId(user_id: number): Observable<any> {
    const url = `${this.apiBaseUrl}api/Concept/${user_id}`;
    return this.http.get<any>(url);
  }

  /** Save / update concept core details */
  saveConcept(payload: any): Observable<any> {
    const headers = new HttpHeaders({ 'Content-Type': 'application/json' });
    return this.http.post(`${this.apiBaseUrl}api/concepts`, payload, { headers });
  }

  getuserfiles(user_id: number): Observable<any> {
    const url = `${this.apiBaseUrl}api/user-files/${user_id}`;
    return this.http.get<any>(url);
  }
  
  deleteattachment(formData: FormData): Observable<any> {
    const url = `${this.apiBaseUrl}api/delete-attachment`;
    return this.http.post<any>(url, formData);
  }
}